use anyhow::Result;
use clap::Args;

use crate::logs::{read_agent_logs, read_workflow_logs, LogEntry};

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
    let entries = if let Some(ref agent) = args.agent {
        read_agent_logs(&args.workflow_id, agent)?
    } else {
        read_workflow_logs(&args.workflow_id)?
    };

    if entries.is_empty() {
        eprintln!("No logs found for workflow {}", args.workflow_id);
        return Ok(());
    }

    if args.raw {
        print_raw(&entries)?;
    } else {
        print_formatted(&entries);
    }

    Ok(())
}

fn print_raw(entries: &[LogEntry]) -> Result<()> {
    for entry in entries {
        println!("{}", serde_json::to_string(entry)?);
    }
    Ok(())
}

fn print_formatted(entries: &[LogEntry]) {
    let separator = "-".repeat(72);
    for (i, entry) in entries.iter().enumerate() {
        if i > 0 {
            println!("{separator}");
        }
        let ts = entry.timestamp.format("%Y-%m-%d %H:%M:%S UTC");
        println!(
            "[{ts}] agent={} iteration={} exit_code={} duration={:.1}s",
            entry.agent, entry.iteration, entry.exit_code, entry.duration_secs
        );
        println!();
        println!("Prompt:");
        for line in entry.prompt.lines() {
            println!("  {line}");
        }
        println!();
        println!("Response:");
        for line in entry.response.lines() {
            println!("  {line}");
        }
        println!();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn make_entry(agent: &str, iteration: u32) -> LogEntry {
        LogEntry {
            timestamp: Utc::now(),
            workflow_id: "wf-test".to_string(),
            agent: agent.to_string(),
            iteration,
            prompt: "do the thing".to_string(),
            response: "done".to_string(),
            exit_code: 0,
            duration_secs: 10.0,
        }
    }

    #[test]
    fn print_raw_produces_valid_jsonl() {
        let entries = vec![make_entry("dev", 1), make_entry("reviewer", 1)];
        // Serialize each and verify they parse back
        for entry in &entries {
            let line = serde_json::to_string(entry).unwrap();
            let parsed: LogEntry = serde_json::from_str(&line).unwrap();
            assert_eq!(parsed.agent, entry.agent);
        }
    }

    #[test]
    fn formatted_output_includes_metadata() {
        // Verify the format string compiles and runs without panic
        let entries = vec![make_entry("dev", 1)];
        // print_formatted writes to stdout — just ensure no panic
        print_formatted(&entries);
    }
}
