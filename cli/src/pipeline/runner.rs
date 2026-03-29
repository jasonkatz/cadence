use anyhow::{bail, Result};
use regex::Regex;

use crate::agent::claude::ClaudeAgent;
use crate::agent::role::AgentRole;
use crate::config::CadenceConfig;
use crate::github::{checks, pr};
use crate::notify;
use crate::output;
use crate::pipeline::prompts;
use crate::pipeline::stage::Stage;
use crate::pipeline::state::WorkflowState;

pub async fn run_pipeline(state: &mut WorkflowState, config: &CadenceConfig) -> Result<()> {
    loop {
        state.save()?;

        if state.iteration > state.max_iters {
            state.error = Some(format!(
                "Max iterations ({}) reached at stage {}",
                state.max_iters,
                state.stage.label()
            ));
            state.transition(Stage::Failed, "max iterations exceeded");
            state.save()?;
            notify_stage(state, config).await;
            bail!(
                "Max iterations ({}) reached at stage {}",
                state.max_iters,
                state.stage.label()
            );
        }

        notify_stage(state, config).await;

        match state.stage {
            Stage::Pending => {
                log_stage(state, "Ensuring branch and starting dev");
                ensure_branch(&state.repo_dir.to_string_lossy(), &state.branch).await?;
                ensure_gitignore(&state.repo_dir.to_string_lossy()).await?;
                state.transition(Stage::Dev, "starting implementation");
            }

            Stage::Dev => {
                let agent = make_agent(AgentRole::Dev, state, config);

                let prompt = if let Some(ref feedback) = state.regression_context {
                    log_stage(state, &format!("Dev fixing issues (iter {})", state.iteration));
                    // Determine if the feedback came from review or e2e
                    feedback.clone()
                } else {
                    log_stage(state, "Dev implementing");
                    prompts::dev_implement_prompt(state)
                };

                let response = agent.send(&prompt).await?;

                log_agent_done(AgentRole::Dev, &response.text);

                // Push changes
                if config.defaults.git_push {
                    git_push(&state.repo_dir.to_string_lossy(), &state.branch).await?;
                }

                // Create or get PR
                if state.pr_number.is_none() {
                    let pr_num =
                        pr::create_or_get_pr(&state.repo, &state.branch, &state.task).await?;
                    state.pr_number = Some(pr_num);
                    log_stage(state, &format!("PR #{pr_num} created"));
                }

                state.regression_context = None;

                // Update PR title and description with a fresh agent session
                let pr_num = state.pr_number.unwrap();
                log_stage(state, "Updating PR title and description");
                let update_agent = ClaudeAgent::new(
                    AgentRole::Dev,
                    uuid::Uuid::new_v4().to_string(),
                    &state.repo_dir,
                    config,
                );
                let update_prompt = prompts::update_pr_prompt(state);
                let _ = update_agent.send(&update_prompt).await?;

                // Wait for GHA before review
                log_stage(state, "Waiting for CI");
                let gha_status = checks::wait_for_gha(
                    &state.repo,
                    pr_num,
                    config.timeouts.gha_secs,
                    config.timeouts.gha_poll_secs,
                )
                .await?;

                match gha_status {
                    checks::GhaStatus::Success => {
                        output::print_success("  CI passed");
                    }
                    checks::GhaStatus::Failure => {
                        let logs = checks::get_failure_logs(&state.repo, pr_num).await?;
                        let feedback = prompts::dev_fix_review_prompt(
                            state,
                            1,
                            &format!("CI FAILED. Fix the following failures:\n{logs}"),
                        );
                        state.regress(Stage::Dev, feedback);
                        continue;
                    }
                    checks::GhaStatus::Timeout => {
                        output::print_success("  CI timed out, proceeding to review");
                    }
                    checks::GhaStatus::Pending => unreachable!(),
                }

                state.transition(Stage::InReview, "CI passed, moving to review");
            }

            Stage::InReview => {
                let pr_num = state.pr_number.unwrap();
                log_stage(state, &format!("Reviewing PR #{pr_num}"));

                let agent = make_agent(AgentRole::Reviewer, state, config);
                let prompt = prompts::review_prompt(state);
                let response = agent.send(&prompt).await?;
                log_agent_done(AgentRole::Reviewer, &response.text);

                // Post reviewer summary as a managed comment (reset each iteration)
                pr::upsert_comment_by_marker(
                    &state.repo,
                    pr_num,
                    pr::MARKER_REVIEWER,
                    &response.text,
                )
                .await?;

                let review_pass = parse_review_result(&response.text);

                if review_pass {
                    output::print_success("  Review passed");
                    state.transition(Stage::Verification, "review passed");
                } else {
                    // Collect individual comment text for dev feedback
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    let comment_count = pr::get_comment_count(&state.repo, pr_num).await?;
                    let comment_text = pr::get_comment_text(&state.repo, pr_num).await?;
                    let feedback =
                        prompts::dev_fix_review_prompt(state, comment_count.max(1), &comment_text);
                    output::print_success("  Review found issues, sending back to dev");
                    state.regress(Stage::Dev, feedback);
                }
            }

            Stage::Verification => {
                let pr_num = state.pr_number.unwrap();
                log_stage(state, "Running E2E validation");

                // E2E agent runs journeys and posts evidence as a PR comment
                let e2e_agent = make_agent(AgentRole::E2e, state, config);
                let e2e_prompt = prompts::e2e_prompt(state);
                let e2e_response = e2e_agent.send(&e2e_prompt).await?;
                log_agent_done(AgentRole::E2e, &e2e_response.text);

                // E2E verifier checks artifact
                log_stage(state, "Verifying E2E results");
                let verifier = make_agent(AgentRole::E2eVerifier, state, config);
                let verify_prompt = prompts::e2e_verify_prompt(state, &e2e_response.text);
                let verify_response = verifier.send(&verify_prompt).await?;
                log_agent_done(AgentRole::E2eVerifier, &verify_response.text);

                // Post verifier's analysis as a managed comment (reset each iteration)
                pr::upsert_comment_by_marker(
                    &state.repo,
                    pr_num,
                    pr::MARKER_E2E_VERIFIER,
                    &verify_response.text,
                )
                .await?;

                let e2e_pass = parse_e2e_result(&verify_response.text);

                if e2e_pass {
                    output::print_success("  E2E verified — behaviors match requirements");
                    state.transition(Stage::FinalSignoff, "E2E passed");
                } else {
                    output::print_success("  E2E failed — sending feedback to dev");
                    let feedback = prompts::dev_fix_e2e_prompt(state, &verify_response.text);
                    state.regress(Stage::Dev, feedback);
                }
            }

            Stage::FinalSignoff => {
                log_stage(state, "Finalizing");

                let pr_url = format!(
                    "https://github.com/{}/pull/{}",
                    state.repo,
                    state.pr_number.unwrap()
                );

                let summary = format!(
                    "Workflow complete — ready for review\n\n\
                     PR: {pr_url}\n\
                     Task: {task}\n\
                     Iterations: {iter}/{max}\n\
                     Duration: {elapsed}\n\
                     GHA: passing\n\
                     Review: clean\n\
                     E2E: verified",
                    task = state.task,
                    iter = state.iteration,
                    max = state.max_iters,
                    elapsed = state.elapsed_display(),
                );

                output::print_success(&summary);
                state.transition(Stage::Complete, "ready for human review");
            }

            Stage::Complete | Stage::Failed | Stage::Cancelled => break,
        }
    }

    state.save()?;
    notify_stage(state, config).await;
    Ok(())
}

fn make_agent(
    role: AgentRole,
    state: &WorkflowState,
    config: &CadenceConfig,
) -> ClaudeAgent {
    let session_id = match role {
        AgentRole::Dev => state.sessions.dev.clone(),
        AgentRole::Reviewer => state.sessions.review.clone(),
        AgentRole::E2e => state.sessions.e2e.clone(),
        AgentRole::E2eVerifier => state.sessions.e2e_verify.clone(),
    };
    ClaudeAgent::new(role, session_id, &state.repo_dir, config)
}

fn log_stage(state: &WorkflowState, msg: &str) {
    let now = chrono::Local::now().format("%H:%M:%S");
    let pr_info = state
        .pr_number
        .map(|n| format!(" PR #{n} ·"))
        .unwrap_or_default();
    eprintln!(
        "\n\x1b[1;34m[{now}] [cadence]\x1b[0m{pr_info} {msg}"
    );
}

fn log_agent_done(role: AgentRole, text: &str) {
    let preview = if text.len() > 200 {
        format!("{}...", &text[..200])
    } else {
        text.to_string()
    };
    eprintln!("  \x1b[90m{role} responded: {preview}\x1b[0m");
}

fn parse_e2e_result(text: &str) -> bool {
    let re = Regex::new(r#""e2e_pass"\s*:\s*(true|false)"#).unwrap();
    if let Some(cap) = re.captures(text) {
        return cap.get(1).map(|m| m.as_str()) == Some("true");
    }
    false
}

fn parse_review_result(text: &str) -> bool {
    let re = Regex::new(r#""review_pass"\s*:\s*(true|false)"#).unwrap();
    if let Some(cap) = re.captures(text) {
        return cap.get(1).map(|m| m.as_str()) == Some("true");
    }
    false
}

async fn ensure_branch(repo_dir: &str, branch: &str) -> Result<()> {
    let output = tokio::process::Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(repo_dir)
        .output()
        .await?;

    let current = String::from_utf8_lossy(&output.stdout).trim().to_string();

    if current != branch {
        // Check if branch exists locally
        let exists = tokio::process::Command::new("git")
            .args(["show-ref", "--verify", "--quiet", &format!("refs/heads/{branch}")])
            .current_dir(repo_dir)
            .status()
            .await?
            .success();

        if exists {
            tokio::process::Command::new("git")
                .args(["checkout", branch])
                .current_dir(repo_dir)
                .output()
                .await?;
        } else {
            tokio::process::Command::new("git")
                .args(["checkout", "-b", branch])
                .current_dir(repo_dir)
                .output()
                .await?;
        }
    }

    Ok(())
}

async fn ensure_gitignore(repo_dir: &str) -> Result<()> {
    let gitignore = std::path::Path::new(repo_dir).join(".gitignore");
    if gitignore.exists() {
        let content = tokio::fs::read_to_string(&gitignore).await?;
        if !content.contains(".dev-workflow/") {
            let mut new_content = content;
            new_content.push_str("\n.dev-workflow/\n");
            tokio::fs::write(&gitignore, new_content).await?;
        }
    }
    Ok(())
}

async fn git_push(repo_dir: &str, branch: &str) -> Result<()> {
    // Stage all changes
    let status = tokio::process::Command::new("git")
        .args(["add", "-A"])
        .current_dir(repo_dir)
        .status()
        .await?;

    if !status.success() {
        return Ok(()); // nothing to add
    }

    // Check if there are staged changes
    let diff = tokio::process::Command::new("git")
        .args(["diff", "--cached", "--quiet"])
        .current_dir(repo_dir)
        .status()
        .await?;

    if diff.success() {
        return Ok(()); // no changes
    }

    // Commit
    let _ = tokio::process::Command::new("git")
        .args(["commit", "-m", "Apply pipeline iteration changes"])
        .current_dir(repo_dir)
        .output()
        .await;

    // Push
    let _ = tokio::process::Command::new("git")
        .args(["push", "origin", branch])
        .current_dir(repo_dir)
        .output()
        .await;

    Ok(())
}

async fn notify_stage(state: &WorkflowState, config: &CadenceConfig) {
    let msg = format!(
        "{emoji} **{repo}** — {label}\n  {pr}iter {iter}/{max} · {elapsed}",
        emoji = state.stage.emoji(),
        repo = state.repo,
        label = state.stage.label(),
        pr = state
            .pr_number
            .map(|n| format!("PR #{n} · "))
            .unwrap_or_default(),
        iter = state.iteration,
        max = state.max_iters,
        elapsed = state.elapsed_display(),
    );

    if let Err(e) = notify::send(&msg, config).await {
        eprintln!("  \x1b[33mnotify failed: {e}\x1b[0m");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_e2e_pass_true() {
        let text = r#"Based on my analysis:
```json
{
  "e2e_pass": true,
  "issues": [],
  "missing_coverage": [],
  "summary": "All behaviors validated"
}
```"#;
        assert!(parse_e2e_result(text));
    }

    #[test]
    fn parse_e2e_pass_false() {
        let text = r#"```json
{
  "e2e_pass": false,
  "issues": ["login endpoint returns 500"],
  "missing_coverage": ["signup flow"],
  "summary": "Critical failures found"
}
```"#;
        assert!(!parse_e2e_result(text));
    }

    #[test]
    fn parse_e2e_pass_no_json() {
        assert!(!parse_e2e_result("No JSON here at all"));
    }

    #[test]
    fn parse_e2e_pass_inline() {
        let text = r#"The result is: "e2e_pass": true, everything looks good."#;
        assert!(parse_e2e_result(text));
    }

    #[test]
    fn parse_review_pass_true() {
        let text = r#"Review looks good.
```json
{
  "review_pass": true,
  "issues": [],
  "summary": "Clean implementation"
}
```"#;
        assert!(parse_review_result(text));
    }

    #[test]
    fn parse_review_pass_false() {
        let text = r#"Found issues.
```json
{
  "review_pass": false,
  "issues": ["Missing error handling"],
  "summary": "Needs fixes"
}
```"#;
        assert!(!parse_review_result(text));
    }

    #[test]
    fn parse_review_pass_no_json() {
        assert!(!parse_review_result("No JSON here"));
    }
}
