use crate::api::{ApiClient, Workflow};
use crate::commands::Context;
use crate::config::Credentials;
use crate::output::{print_json, print_success};

pub async fn run(ctx: &Context, workflow_id: &str) -> anyhow::Result<()> {
    let creds = Credentials::load()?;
    if !creds.is_valid() {
        anyhow::bail!("Not authenticated. Run 'cadence login' first.");
    }

    let client = ApiClient::new(&ctx.base_url);
    let workflow: Workflow = client
        .post(&format!("/v1/workflows/{}/cancel", workflow_id))
        .await?;

    if ctx.json {
        print_json(&workflow)?;
    } else {
        print_success(&format!("Workflow {} cancelled.", &workflow.id[..8.min(workflow.id.len())]));
    }

    Ok(())
}
