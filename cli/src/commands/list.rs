use anyhow::Result;

use crate::output;
use crate::pipeline::state::WorkflowState;

#[derive(Debug, clap::Args)]
pub struct ListArgs {
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
}

pub async fn run(args: ListArgs) -> Result<()> {
    let workflows = WorkflowState::list_all()?;

    if workflows.is_empty() {
        eprintln!("No workflows found");
        return Ok(());
    }

    if args.json {
        output::print_json(&workflows)?;
        return Ok(());
    }

    let headers = &["ID", "REPO", "STAGE", "ITER", "ELAPSED"];
    let rows: Vec<Vec<String>> = workflows
        .iter()
        .map(|w| {
            vec![
                w.id.clone(),
                w.repo.clone(),
                format!("{}", w.stage),
                format!("{}/{}", w.iteration, w.max_iters),
                w.elapsed_display(),
            ]
        })
        .collect();

    output::print_table(headers, rows);

    Ok(())
}
