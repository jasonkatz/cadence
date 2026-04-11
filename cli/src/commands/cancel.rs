use crate::api::Workflow;
use crate::commands::daemon::ensure_daemon;
use crate::commands::Context;
use crate::output::{print_json, print_success};

pub async fn run(ctx: &Context, workflow_id: &str) -> anyhow::Result<()> {
    ensure_daemon(ctx).await?;
    let client = ctx.client();
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
