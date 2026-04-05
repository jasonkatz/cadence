use crate::api::{ApiClient, Workflow, WorkflowCreateInput};
use crate::commands::Context;
use crate::config::Credentials;
use crate::output::{print_json, print_success};

pub async fn run(
    ctx: &Context,
    task: &str,
    repo: &str,
    branch: Option<&str>,
    requirements: Option<&str>,
    max_iters: Option<i64>,
) -> anyhow::Result<()> {
    let creds = Credentials::load()?;
    if !creds.is_valid() {
        anyhow::bail!("Not authenticated. Run 'cadence login' first.");
    }

    let client = ApiClient::new(&ctx.base_url);
    let input = WorkflowCreateInput {
        task: task.to_string(),
        repo: repo.to_string(),
        branch: branch.map(|s| s.to_string()),
        requirements: requirements.map(|s| s.to_string()),
        max_iters,
    };

    let workflow: Workflow = client.post_json("/v1/workflows", &input).await?;

    if ctx.json {
        print_json(&workflow)?;
        return Ok(());
    }

    print_success(&format!(
        "Workflow created: {} (status: {})",
        workflow.id, workflow.status
    ));

    // Stream SSE events until terminal state
    println!("Streaming progress...\n");

    let stream_path = format!("/v1/workflows/{}/events", workflow.id);
    let workflow_repo = workflow.repo.clone();
    client
        .stream_sse(&stream_path, |event_type, data| {
            match event_type {
                "step:updated" => {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                        let step_type = parsed["type"].as_str().unwrap_or("unknown");
                        let status = parsed["status"].as_str().unwrap_or("unknown");
                        println!("  {}: {}", step_type, status);
                    }
                }
                "workflow:updated" => {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                        if parsed["regression"].as_bool() == Some(true) {
                            let iteration = parsed["iteration"].as_i64().unwrap_or(0);
                            let failure = parsed["failureDetail"]
                                .as_str()
                                .unwrap_or("unknown failure");
                            println!("\n  Regression triggered — iteration {}", iteration);
                            println!("  Reason: {}", failure);
                            println!();
                        } else if let Some(pr_number) = parsed["pr_number"].as_i64() {
                            let pr_url = parsed["pr_url"]
                                .as_str()
                                .map(|s| s.to_string())
                                .unwrap_or_else(|| {
                                    format!(
                                        "https://github.com/{}/pull/{}",
                                        workflow_repo, pr_number
                                    )
                                });
                            println!("\n  PR created: {}", pr_url);
                        } else if let Some(status) = parsed["status"].as_str() {
                            println!("  workflow: {}", status);
                        }
                    }
                }
                "workflow:completed" => {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                        let status = parsed["status"].as_str().unwrap_or("unknown");
                        if let Some(pr_number) = parsed["pr_number"].as_i64() {
                            let pr_url = parsed["pr_url"]
                                .as_str()
                                .map(|s| s.to_string())
                                .unwrap_or_else(|| {
                                    format!(
                                        "https://github.com/{}/pull/{}",
                                        workflow_repo, pr_number
                                    )
                                });
                            println!("\n  PR created: {}", pr_url);
                        } else if status != "running" {
                            println!("\nWorkflow {}", status);
                        }
                        if let Some(error) = parsed["error"].as_str() {
                            println!("Error: {}", error);
                        }
                    }
                    return false; // stop streaming
                }
                _ => {}
            }
            true // continue streaming
        })
        .await?;

    Ok(())
}
