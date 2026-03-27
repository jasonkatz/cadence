use anyhow::Result;
use clap::Args;

use crate::logs;

#[derive(Args)]
pub struct LogsArgs {
    /// Workflow ID
    workflow_id: String,
    /// Filter by agent (dev, reviewer, e2e, e2e-verifier)
    #[arg(short, long)]
    agent: Option<String>,
    /// Output as raw JSONL instead of formatted text
    #[arg(long)]
    raw: bool,
}

pub async fn run(args: LogsArgs) -> Result<()> {
    let entries = match &args.agent {
        Some(agent) => logs::read_agent_logs(&args.workflow_id, agent)?,
        None => logs::read_workflow_logs(&args.workflow_id)?,
    };

    if entries.is_empty() {
        println!("No logs found for workflow {}", args.workflow_id);
        return Ok(());
    }

    if args.raw {
        for entry in &entries {
            println!("{}", serde_json::to_string(entry)?);
        }
        return Ok(());
    }

    for (i, entry) in entries.iter().enumerate() {
        if i > 0 {
            println!("{}", "-".repeat(72));
        }
        println!(
            "[{}] agent={} iteration={} exit_code={} duration={:.1}s",
            entry.timestamp.format("%Y-%m-%d %H:%M:%S UTC"),
            entry.agent,
            entry.iteration,
            entry.exit_code,
            entry.duration_secs,
        );
        println!();
        println!("Prompt:");
        for line in entry.prompt.lines() {
            println!("  {}", line);
        }
        println!();
        println!("Response:");
        for line in entry.response.lines() {
            println!("  {}", line);
        }
        println!();
    }

    Ok(())
}
