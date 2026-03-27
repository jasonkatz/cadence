use clap::{Parser, Subcommand};
use std::process;

mod agent;
mod commands;
mod config;
mod error;
mod github;
mod logs;
mod notify;
mod output;
mod pipeline;

use commands::{cancel, config_cmd, list, resume, run, status};
use commands::logs as cmd_logs;

#[derive(Parser)]
#[command(name = "cadence")]
#[command(about = "CLI orchestrator for multi-agent SDLC workflows")]
#[command(version)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Start a new workflow
    Run(run::RunArgs),
    /// Show status of a workflow
    Status(status::StatusArgs),
    /// List all workflows
    List(list::ListArgs),
    /// Resume a paused or failed workflow
    Resume(resume::ResumeArgs),
    /// Cancel a running workflow
    Cancel(cancel::CancelArgs),
    /// Manage configuration
    Config(config_cmd::ConfigArgs),
    /// View agent run logs for a workflow
    Logs(cmd_logs::LogsArgs),
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();

    let result = match cli.command {
        Commands::Run(args) => {
            let config = match config::CadenceConfig::load() {
                Ok(c) => c,
                Err(e) => {
                    output::print_error(&e.to_string());
                    process::exit(1);
                }
            };
            run::run(args, &config).await
        }
        Commands::Status(args) => status::run(args).await,
        Commands::List(args) => list::run(args).await,
        Commands::Resume(args) => {
            let config = match config::CadenceConfig::load() {
                Ok(c) => c,
                Err(e) => {
                    output::print_error(&e.to_string());
                    process::exit(1);
                }
            };
            resume::run(args, &config).await
        }
        Commands::Cancel(args) => cancel::run(args).await,
        Commands::Config(args) => config_cmd::run(args).await,
        Commands::Logs(args) => cmd_logs::run(args).await,
    };

    if let Err(err) = result {
        output::print_error(&err.to_string());
        process::exit(1);
    }
}
