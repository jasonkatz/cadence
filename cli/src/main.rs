use clap::{Parser, Subcommand};
use std::process;

mod api;
mod commands;
mod config;
mod output;

use commands::{cancel, config as config_cmd, list, login, logout, run, status, whoami};

#[derive(Parser)]
#[command(name = "cadence")]
#[command(about = "Command-line interface for Cadence")]
#[command(version)]
struct Cli {
    /// Use localhost:8080 instead of production
    #[arg(short, long, global = true)]
    local: bool,

    /// Output structured JSON (for scripting and automation)
    #[arg(long, global = true)]
    json: bool,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Authenticate via browser (opens Auth0 device flow)
    Login,
    /// Clear stored credentials
    Logout,
    /// Display current user info
    Whoami,
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
        /// Branch name (default: cadence/<short-id>)
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

#[tokio::main]
async fn main() {
    let cli = Cli::parse();

    const API_URL: &str = match option_env!("API_URL") {
        Some(v) => v,
        None => "https://api.yourapp.com",
    };

    let base_url = if cli.local {
        "http://localhost:8080".to_string()
    } else {
        API_URL.to_string()
    };

    let ctx = commands::Context {
        base_url,
        json: cli.json,
    };

    let result = match cli.command {
        Commands::Login => login::run(&ctx).await,
        Commands::Logout => logout::run(&ctx).await,
        Commands::Whoami => whoami::run(&ctx).await,
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
    };

    if let Err(err) = result {
        output::print_error(&err.to_string());
        process::exit(1);
    }
}
