use anyhow::{bail, Result};
use chrono::Utc;
use std::path::PathBuf;

use crate::agent::claude;
use crate::config::CadenceConfig;
use crate::pipeline::stage::Stage;
use crate::pipeline::state::{SessionIds, WorkflowState};
use crate::pipeline;

#[derive(Debug, clap::Args)]
pub struct RunArgs {
    /// What to implement (natural language)
    #[arg(short, long)]
    pub task: String,

    /// GitHub repo (owner/repo)
    #[arg(short, long)]
    pub repo: String,

    /// Local repo directory (default: current directory)
    #[arg(long)]
    pub repo_dir: Option<PathBuf>,

    /// Feature branch name (default: dev/<id>)
    #[arg(short, long)]
    pub branch: Option<String>,

    /// Path to requirements file relative to repo
    #[arg(long)]
    pub requirements: Option<String>,

    /// Max iterations before giving up
    #[arg(long)]
    pub max_iters: Option<u32>,

    /// Model override for all agents
    #[arg(long)]
    pub model: Option<String>,

    /// Human feedback to iterate on an existing PR (skips fresh implementation)
    #[arg(long)]
    pub feedback: Option<String>,
}

pub async fn run(args: RunArgs, config: &CadenceConfig) -> Result<()> {
    claude::check_claude_available()?;
    claude::check_gh_available()?;

    let id = uuid::Uuid::new_v4().to_string()[..8].to_string();
    let repo_dir = args
        .repo_dir
        .unwrap_or_else(|| std::env::current_dir().unwrap());
    let repo_dir = repo_dir.canonicalize()?;

    if !repo_dir.join(".git").exists() {
        bail!("{} is not a git repository", repo_dir.display());
    }

    let branch = args
        .branch
        .unwrap_or_else(|| format!("dev/{id}"));

    let max_iters = args.max_iters.unwrap_or(config.defaults.max_iters);
    let now = Utc::now();

    // claude --session-id requires valid UUIDs
    let sessions = SessionIds {
        dev: uuid::Uuid::new_v4().to_string(),
        review: uuid::Uuid::new_v4().to_string(),
        e2e: uuid::Uuid::new_v4().to_string(),
        e2e_verify: uuid::Uuid::new_v4().to_string(),
    };

    let regression_context = args.feedback.map(|f| {
        crate::pipeline::prompts::dev_feedback_prompt(
            &WorkflowState {
                id: id.clone(),
                task: args.task.clone(),
                repo: args.repo.clone(),
                repo_dir: repo_dir.clone(),
                branch: branch.clone(),
                stage: Stage::Dev,
                iteration: 1,
                max_iters,
                pr_number: None,
                started_at: now,
                updated_at: now,
                sessions: sessions.clone(),
                history: vec![],
                regression_context: None,
                requirements: args.requirements.clone(),
                error: None,
                pid: None,
            },
            &f,
        )
    });

    let mut state = WorkflowState {
        id: id.clone(),
        task: args.task,
        repo: args.repo,
        repo_dir,
        branch,
        stage: Stage::Pending,
        iteration: if regression_context.is_some() { 1 } else { 0 },
        max_iters,
        pr_number: None,
        started_at: now,
        updated_at: now,
        sessions,
        history: vec![],
        regression_context,
        requirements: args.requirements,
        error: None,
        pid: Some(std::process::id()),
    };

    // Apply model override
    let config = if let Some(model) = args.model {
        let mut c = CadenceConfig::load()?;
        c.defaults.model = model;
        c
    } else {
        CadenceConfig::load()?
    };

    eprintln!("\n\x1b[1;34m╔══════════════════════════════════════╗\x1b[0m");
    eprintln!("\x1b[1;34m║  Cadence — Multi-Agent SDLC Pipeline ║\x1b[0m");
    eprintln!("\x1b[1;34m╚══════════════════════════════════════╝\x1b[0m\n");
    eprintln!("  ID:       {id}");
    eprintln!("  Task:     {}", state.task);
    eprintln!("  Repo:     {}", state.repo);
    eprintln!("  Branch:   {}", state.branch);
    eprintln!("  Max iter: {}", state.max_iters);
    eprintln!();

    pipeline::run_pipeline(&mut state, &config).await
}
