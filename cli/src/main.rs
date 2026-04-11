use clap::{Parser, Subcommand};
use std::path::PathBuf;
use std::process;

mod api;
mod commands;
mod output;

use commands::{cancel, config as config_cmd, daemon, doctor, list, logs, proposal, run, status, ui};

fn default_socket_path() -> PathBuf {
    let home = dirs_home();
    home.join(".tmpo").join("tmpod.sock")
}

fn dirs_home() -> PathBuf {
    #[cfg(unix)]
    {
        std::env::var("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("/tmp"))
    }
    #[cfg(not(unix))]
    {
        std::env::var("USERPROFILE")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."))
    }
}

#[derive(Parser)]
#[command(name = "tmpo")]
#[command(about = "Command-line interface for Tmpo")]
#[command(version)]
struct Cli {
    /// Connect to a remote daemon at the given URL instead of the local socket
    #[arg(long, global = true)]
    remote: Option<String>,

    /// Output structured JSON (for scripting and automation)
    #[arg(long, global = true)]
    json: bool,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Manage configuration
    Config {
        #[command(subcommand)]
        action: ConfigAction,
    },
    /// Create a new workflow
    Run {
        /// Task description
        #[arg(short, long)]
        task: String,
        /// Target repository (owner/repo)
        #[arg(short, long)]
        repo: String,
        /// Branch name (default: tmpo/<short-id>)
        #[arg(short, long)]
        branch: Option<String>,
        /// Path to requirements file in the repo
        #[arg(long)]
        requirements: Option<String>,
        /// Maximum iterations before failure
        #[arg(long)]
        max_iters: Option<i64>,
    },
    /// List workflows
    List {
        /// Filter by status
        #[arg(short, long)]
        status: Option<String>,
    },
    /// Show workflow status and steps
    Status {
        /// Workflow ID
        workflow_id: String,
    },
    /// Cancel a workflow
    Cancel {
        /// Workflow ID
        workflow_id: String,
    },
    /// Show the proposal for a workflow
    Proposal {
        /// Workflow ID
        workflow_id: String,
    },
    /// Show run logs for a workflow
    Logs {
        /// Workflow ID
        workflow_id: String,
        /// Filter by agent role (planner, dev, reviewer, e2e, e2e_verifier)
        #[arg(short, long)]
        agent: Option<String>,
        /// Filter by iteration number
        #[arg(short, long)]
        iteration: Option<i64>,
        /// Show full prompt and response (no truncation)
        #[arg(long)]
        full: bool,
    },
    /// Manage the daemon
    Daemon {
        #[command(subcommand)]
        action: DaemonAction,
    },
    /// Open the web dashboard
    Ui {
        /// TCP port for the web UI
        #[arg(short, long, default_value = "7070")]
        port: u16,
    },
    /// Check environment health and print diagnostics
    Doctor,
}

#[derive(Subcommand)]
enum ConfigAction {
    /// Set a config value
    Set {
        /// Config key (e.g., github-token)
        key: String,
        /// Config value
        value: String,
    },
    /// Get current config
    Get,
}

#[derive(Subcommand)]
enum DaemonAction {
    /// Start the daemon in the background
    Start,
    /// Gracefully stop the daemon
    Stop,
    /// Show daemon status
    Status,
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();

    let socket_path = default_socket_path();

    let ctx = commands::Context {
        socket_path,
        remote_url: cli.remote.clone(),
        json: cli.json,
    };

    let result = match cli.command {
        Commands::Config { action } => match action {
            ConfigAction::Set { key, value } => config_cmd::run_set(&ctx, &key, &value).await,
            ConfigAction::Get => config_cmd::run_get(&ctx).await,
        },
        Commands::Run {
            task,
            repo,
            branch,
            requirements,
            max_iters,
        } => {
            run::run(
                &ctx,
                &task,
                &repo,
                branch.as_deref(),
                requirements.as_deref(),
                max_iters,
            )
            .await
        }
        Commands::List { status } => list::run(&ctx, status.as_deref()).await,
        Commands::Status { workflow_id } => status::run(&ctx, &workflow_id).await,
        Commands::Cancel { workflow_id } => cancel::run(&ctx, &workflow_id).await,
        Commands::Proposal { workflow_id } => proposal::run(&ctx, &workflow_id).await,
        Commands::Logs {
            workflow_id,
            agent,
            iteration,
            full,
        } => logs::run(&ctx, &workflow_id, agent.as_deref(), iteration, full).await,
        Commands::Daemon { action } => match action {
            DaemonAction::Start => daemon::run_start(&ctx).await,
            DaemonAction::Stop => daemon::run_stop(&ctx).await,
            DaemonAction::Status => daemon::run_status(&ctx).await,
        },
        Commands::Ui { port } => ui::run(&ctx, port).await,
        Commands::Doctor => doctor::run(&ctx).await,
    };

    if let Err(err) = result {
        output::print_error(&err.to_string());
        process::exit(1);
    }
}
