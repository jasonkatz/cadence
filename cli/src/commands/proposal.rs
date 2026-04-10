use crate::api::WorkflowDetail;
use crate::commands::daemon::ensure_daemon;
use crate::commands::Context;
use crate::output::{print_error, print_json};

pub async fn run(ctx: &Context, workflow_id: &str) -> anyhow::Result<()> {
    ensure_daemon(ctx).await?;
    let client = ctx.client();
    let detail: WorkflowDetail = client
        .get(&format!("/v1/workflows/{}", workflow_id))
        .await?;

    if ctx.json {
        print_json(&serde_json::json!({
            "workflow_id": detail.workflow.id,
            "proposal": detail.workflow.proposal,
        }))?;
        return Ok(());
    }

    match detail.workflow.proposal {
        Some(ref proposal) => {
            println!("{}", proposal);
        }
        None => {
            print_error("No proposal available yet for this workflow.");
            std::process::exit(1);
        }
    }

    Ok(())
}
