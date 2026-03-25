use anyhow::Result;

use crate::error::CadenceError;
use crate::output;
use crate::pipeline::state::WorkflowState;

#[derive(Debug, clap::Args)]
pub struct StatusArgs {
    /// Workflow ID (shows most recent if omitted)
    pub id: Option<String>,

    /// Output as JSON
    #[arg(long)]
    pub json: bool,
}

pub async fn run(args: StatusArgs) -> Result<()> {
    let state = match args.id {
        Some(id) => WorkflowState::load(&id)
            .map_err(|_| CadenceError::WorkflowNotFound { id })?,
        None => {
            let all = WorkflowState::list_all()?;
            match all.into_iter().next() {
                Some(s) => s,
                None => {
                    eprintln!("No workflows found");
                    return Ok(());
                }
            }
        }
    };

    if args.json {
        output::print_json(&state)?;
        return Ok(());
    }

    eprintln!(
        "\n{stage}  {repo}\n\
         \n\
         ID:         {id}\n\
         Task:       {task}\n\
         Branch:     {branch}\n\
         PR:         {pr}\n\
         Iteration:  {iter}/{max}\n\
         Started:    {started}\n\
         Elapsed:    {elapsed}\n\
         Error:      {error}\n",
        stage = state.stage,
        repo = state.repo,
        id = state.id,
        task = state.task,
        branch = state.branch,
        pr = state
            .pr_number
            .map(|n| format!("#{n}"))
            .unwrap_or_else(|| "—".to_string()),
        iter = state.iteration,
        max = state.max_iters,
        started = state.started_at.format("%Y-%m-%d %H:%M:%S UTC"),
        elapsed = state.elapsed_display(),
        error = state.error.as_deref().unwrap_or("—"),
    );

    if !state.history.is_empty() {
        eprintln!("History:");
        for t in &state.history {
            eprintln!(
                "  {} → {} at {} — {}",
                t.from.label(),
                t.to.label(),
                t.at.format("%H:%M:%S"),
                t.detail
            );
        }
    }

    Ok(())
}
