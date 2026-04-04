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
    } else {
        print_success(&format!(
            "Workflow created: {} (status: {})",
            workflow.id, workflow.status
        ));
    }

    Ok(())
}
