use anyhow::Result;

use crate::agent::claude;
use crate::config::CadenceConfig;
use crate::error::CadenceError;
use crate::pipeline;
use crate::pipeline::stage::Stage;
use crate::pipeline::state::WorkflowState;

#[derive(Debug, clap::Args)]
pub struct ResumeArgs {
    /// Workflow ID to resume
    pub id: String,
}

pub async fn run(args: ResumeArgs, config: &CadenceConfig) -> Result<()> {
    claude::check_claude_available()?;
    claude::check_gh_available()?;

    let mut state = WorkflowState::load(&args.id)
        .map_err(|_| CadenceError::WorkflowNotFound { id: args.id.clone() })?;

    match state.stage {
        Stage::Complete => {
            return Err(CadenceError::WorkflowTerminal {
                id: args.id,
                status: "complete".to_string(),
            }
            .into());
        }
        Stage::Cancelled => {
            return Err(CadenceError::WorkflowTerminal {
                id: args.id,
                status: "cancelled".to_string(),
            }
            .into());
        }
        Stage::Failed => {
            // Roll back to the stage before failure
            if let Some(last) = state.history.last() {
                let resume_stage = last.from;
                eprintln!(
                    "Resuming failed workflow from stage: {}",
                    resume_stage.label()
                );
                state.stage = resume_stage;
            } else {
                state.stage = Stage::Pending;
            }
            state.error = None;
        }
        _ => {
            eprintln!("Resuming workflow at stage: {}", state.stage.label());
        }
    }

    state.pid = Some(std::process::id());

    pipeline::run_pipeline(&mut state, config).await
}
