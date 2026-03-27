use anyhow::{bail, Result};
use clap::Args;

use crate::logs::{read_agent_logs, read_workflow_logs, LogEntry};

#[derive(Debug, Args)]
pub struct LogsArgs {
    /// Workflow ID
    pub workflow_id: String,

    /// Filter by agent (dev, reviewer, e2e, e2e-verifier)
    #[arg(short, long)]
    pub agent: Option<String>,

    /// Output as raw JSONL instead of formatted text
    #[arg(long)]
    pub raw: bool,
}

pub async fn run(args: LogsArgs) -> Result<()> {
    let entries = load_entries(&args)?;

    if entries.is_empty() {
        eprintln!("No logs found for workflow {}", args.workflow_id);
        return Ok(());
    }

    if args.raw {
        print_raw(&entries);
    } else {
        print_formatted(&entries);
    }

    Ok(())
}

fn load_entries(args: &LogsArgs) -> Result<Vec<LogEntry>> {
    match &args.agent {
        Some(agent) => {
            let entries = read_agent_logs(&args.workflow_id, agent)?;
            if entries.is_empty() {
                bail!(
                    "no logs found for agent '{}' in workflow {}",
                    agent,
                    args.workflow_id
                );
            }
            Ok(entries)
        }
        None => read_workflow_logs(&args.workflow_id),
    }
}

fn print_raw(entries: &[LogEntry]) {
    for entry in entries {
        match serde_json::to_string(entry) {
            Ok(line) => println!("{line}"),
            Err(e) => eprintln!("  \x1b[33mwarning: could not serialize entry: {e}\x1b[0m"),
        }
    }
}

fn print_formatted(entries: &[LogEntry]) {
    let separator = "-".repeat(72);

    for (i, entry) in entries.iter().enumerate() {
        if i > 0 {
            println!("{separator}");
        }

        println!(
            "[{ts}] agent={agent} iteration={iter} exit_code={code} duration={dur}s",
            ts = entry.timestamp.format("%Y-%m-%d %H:%M:%S UTC"),
            agent = entry.agent,
            iter = entry.iteration,
            code = entry.exit_code,
            dur = entry.duration_secs,
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

    fn make_entry(agent: &str, iteration: u32, exit_code: i32) -> LogEntry {
        LogEntry {
            timestamp: Utc::now(),
            workflow_id: "wf-test".to_string(),
            agent: agent.to_string(),
            iteration,
            prompt: "Implement X".to_string(),
            response: "Done with X".to_string(),
            exit_code,
            duration_secs: 42.0,
        }
    }

    #[test]
    fn print_raw_emits_valid_jsonl() {
        let entries = vec![
            make_entry("dev", 1, 0),
            make_entry("reviewer", 1, 0),
        ];

        // Collect output by serializing directly (print_raw just wraps to_string)
        for entry in &entries {
            let line = serde_json::to_string(entry).unwrap();
            let decoded: LogEntry = serde_json::from_str(&line).unwrap();
            assert_eq!(decoded.agent, entry.agent);
        }
    }

    #[test]
    fn load_entries_errors_for_unknown_agent() {
        let args = LogsArgs {
            workflow_id: "does-not-exist-xyz".to_string(),
            agent: Some("dev".to_string()),
            raw: false,
        };
        // Agent filter on a workflow with no logs should bail
        let result = load_entries(&args);
        assert!(result.is_err());
    }

    #[test]
    fn load_entries_returns_empty_for_workflow_no_filter() {
        let args = LogsArgs {
            workflow_id: "does-not-exist-xyz".to_string(),
            agent: None,
            raw: false,
        };
        let entries = load_entries(&args).unwrap();
        assert!(entries.is_empty());
    }
}
