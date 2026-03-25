use thiserror::Error;

#[derive(Debug, Error)]
pub enum CadenceError {
    #[error("Agent '{role}' failed: {message}")]
    AgentFailed { role: String, message: String },

    #[error("GHA checks timed out after {timeout_secs}s")]
    GhaTimeout { timeout_secs: u64 },

    #[error("GHA checks failed")]
    GhaFailed,

    #[error("Max iterations ({max}) reached at stage {stage}")]
    MaxIterations { max: u32, stage: String },

    #[error("Workflow not found: {id}")]
    WorkflowNotFound { id: String },

    #[error("Workflow {id} already {status}")]
    WorkflowTerminal { id: String, status: String },

    #[error("Config error: {0}")]
    Config(String),

    #[error("`claude` CLI not found — install from https://docs.anthropic.com/claude-code")]
    ClaudeNotFound,

    #[error("`gh` CLI not found — install from https://cli.github.com")]
    GhNotFound,

    #[error("Command `{cmd}` failed: {message}")]
    CommandFailed { cmd: String, message: String },
}
