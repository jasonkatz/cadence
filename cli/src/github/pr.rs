use anyhow::{bail, Context, Result};
use std::process::Stdio;
use tokio::process::Command;

pub async fn create_or_get_pr(repo: &str, branch: &str, task: &str) -> Result<u64> {
    // Check for existing PR first
    if let Some(num) = get_pr_number(repo, branch).await? {
        return Ok(num);
    }

    let title = format!("feat: {}", truncate(task, 250));
    let body = format!(
        "Automated PR created by cadence pipeline.\n\n\
         **Task:** {task}\n\
         **Branch:** {branch}\n\n\
         ---\n\
         _This PR is managed by cadence. Do not merge manually._"
    );

    let output = Command::new("gh")
        .args(["pr", "create", "--repo", repo, "--head", branch, "--base", "main"])
        .arg("--title")
        .arg(&title)
        .arg("--body")
        .arg(&body)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .context("running gh pr create")?;

    let stdout = String::from_utf8_lossy(&output.stdout);

    // gh pr create outputs the PR URL, extract the number
    if let Some(num) = extract_pr_number_from_url(&stdout) {
        return Ok(num);
    }

    // Fallback: query for it
    if let Some(num) = get_pr_number(repo, branch).await? {
        return Ok(num);
    }

    bail!(
        "could not create PR: {}",
        String::from_utf8_lossy(&output.stderr)
    )
}

pub async fn get_pr_number(repo: &str, branch: &str) -> Result<Option<u64>> {
    let output = Command::new("gh")
        .args([
            "pr", "list", "--repo", repo, "--head", branch, "--json", "number", "--jq",
            ".[0].number",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .context("running gh pr list")?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() || stdout == "null" {
        return Ok(None);
    }
    Ok(stdout.parse::<u64>().ok())
}

pub async fn get_comment_count(repo: &str, pr_num: u64) -> Result<u64> {
    // Count review comments (inline)
    let review_output = Command::new("gh")
        .args([
            "api",
            &format!("repos/{repo}/pulls/{pr_num}/comments"),
            "--jq",
            "[.[] | select(.in_reply_to_id == null)] | length",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .context("counting review comments")?;

    let review_count: u64 = String::from_utf8_lossy(&review_output.stdout)
        .trim()
        .parse()
        .unwrap_or(0);

    // Count issue comments (excluding showboat/e2e)
    let issue_output = Command::new("gh")
        .args([
            "api",
            &format!("repos/{repo}/issues/{pr_num}/comments"),
            "--jq",
            r#"[.[] | select(.body | test("Showboat|E2E [Vv]alidation|showboat") | not)] | length"#,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .context("counting issue comments")?;

    let issue_count: u64 = String::from_utf8_lossy(&issue_output.stdout)
        .trim()
        .parse()
        .unwrap_or(0);

    Ok(review_count + issue_count)
}

pub async fn get_comment_text(repo: &str, pr_num: u64) -> Result<String> {
    let review_output = Command::new("gh")
        .args([
            "api",
            &format!("repos/{repo}/pulls/{pr_num}/comments"),
            "--jq",
            r#".[] | "[\(.path):\(.line // .original_line // "general")] \(.body)"#,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await?;

    let issue_output = Command::new("gh")
        .args([
            "api",
            &format!("repos/{repo}/issues/{pr_num}/comments"),
            "--jq",
            r#".[] | select(.body | test("Showboat|E2E [Vv]alidation|showboat") | not) | "[general] \(.body)"#,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await?;

    let mut text = String::from_utf8_lossy(&review_output.stdout).to_string();
    text.push_str(&String::from_utf8_lossy(&issue_output.stdout));
    Ok(text)
}

pub async fn clear_review_comments(repo: &str, pr_num: u64) -> Result<()> {
    // Delete issue comments (non-showboat)
    let issue_output = Command::new("gh")
        .args([
            "api",
            &format!("repos/{repo}/issues/{pr_num}/comments"),
            "--jq",
            r#".[] | select(.body | test("Showboat|E2E [Vv]alidation|showboat") | not) | .id"#,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await?;

    for cid in String::from_utf8_lossy(&issue_output.stdout).lines() {
        let cid = cid.trim();
        if !cid.is_empty() {
            let _ = Command::new("gh")
                .args(["api", "-X", "DELETE", &format!("repos/{repo}/issues/comments/{cid}")])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .output()
                .await;
        }
    }

    // Delete review comments
    let review_output = Command::new("gh")
        .args([
            "api",
            &format!("repos/{repo}/pulls/{pr_num}/comments"),
            "--jq",
            ".[].id",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await?;

    for cid in String::from_utf8_lossy(&review_output.stdout).lines() {
        let cid = cid.trim();
        if !cid.is_empty() {
            let _ = Command::new("gh")
                .args(["api", "-X", "DELETE", &format!("repos/{repo}/pulls/comments/{cid}")])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .output()
                .await;
        }
    }

    Ok(())
}

pub async fn post_pr_comment(repo: &str, pr_num: u64, body: &str) -> Result<()> {
    Command::new("gh")
        .args(["pr", "comment", &pr_num.to_string(), "--repo", repo, "--body", body])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .await
        .context("posting PR comment")?;
    Ok(())
}

pub async fn delete_showboat_comment(repo: &str, pr_num: u64) -> Result<()> {
    let output = Command::new("gh")
        .args([
            "api",
            &format!("repos/{repo}/issues/{pr_num}/comments"),
            "--jq",
            r#"[.[] | select(.body | test("Showboat|E2E [Vv]alidation|showboat"))] | .[0].id // empty"#,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await?;

    let cid = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !cid.is_empty() {
        let _ = Command::new("gh")
            .args(["api", "-X", "DELETE", &format!("repos/{repo}/issues/comments/{cid}")])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .await;
    }

    Ok(())
}

fn extract_pr_number_from_url(text: &str) -> Option<u64> {
    text.trim()
        .rsplit('/')
        .next()
        .and_then(|s| s.trim().parse::<u64>().ok())
}

fn truncate(s: &str, max: usize) -> &str {
    if s.len() > max {
        &s[..max]
    } else {
        s
    }
}
