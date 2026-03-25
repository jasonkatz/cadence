use anyhow::Result;

use crate::error::CadenceError;
use crate::pipeline::stage::Stage;
use crate::pipeline::state::WorkflowState;

#[derive(Debug, clap::Args)]
pub struct CancelArgs {
    /// Workflow ID to cancel
    pub id: String,
}

pub async fn run(args: CancelArgs) -> Result<()> {
    let mut state = WorkflowState::load(&args.id)
        .map_err(|_| CadenceError::WorkflowNotFound { id: args.id.clone() })?;

    if state.stage.is_terminal() {
        return Err(CadenceError::WorkflowTerminal {
            id: args.id,
            status: state.stage.label().to_lowercase(),
        }
        .into());
    }

    state.transition(Stage::Cancelled, "cancelled by user");
    state.save()?;

    eprintln!("Workflow {} cancelled", args.id);

    Ok(())
}
