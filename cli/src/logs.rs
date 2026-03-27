use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize)]
pub struct LogEntry {
    pub timestamp: DateTime<Utc>,
    pub workflow_id: String,
    pub agent: String,
    pub iteration: u32,
    pub prompt: String,
    pub response: String,
    pub exit_code: i32,
    pub duration_secs: f64,
}

pub fn logs_dir(workflow_id: &str) -> Result<PathBuf> {
    let config_dir =
        dirs::config_dir().ok_or_else(|| anyhow::anyhow!("could not find config directory"))?;
    let dir = config_dir
        .join("cadence")
        .join("logs")
        .join(workflow_id);
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Append a log entry to the agent's JSONL file.
///
/// Each line is independently parseable so crashes mid-write only lose
/// the in-flight entry, not existing history.
pub fn append_log(entry: &LogEntry) -> Result<()> {
    let dir = logs_dir(&entry.workflow_id)?;
    let path = dir.join(format!("{}.jsonl", entry.agent));
    let line = serde_json::to_string(entry)?;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)?;
    writeln!(file, "{line}")?;
    Ok(())
}

pub fn read_agent_logs(workflow_id: &str, agent: &str) -> Result<Vec<LogEntry>> {
    let config_dir =
        dirs::config_dir().ok_or_else(|| anyhow::anyhow!("could not find config directory"))?;
    let path = config_dir
        .join("cadence")
        .join("logs")
        .join(workflow_id)
        .join(format!("{agent}.jsonl"));

    if !path.exists() {
        return Ok(vec![]);
    }

    let content = fs::read_to_string(&path)?;
    let entries = content
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect();
    Ok(entries)
}

pub fn list_agents_with_logs(workflow_id: &str) -> Result<Vec<String>> {
    let config_dir =
        dirs::config_dir().ok_or_else(|| anyhow::anyhow!("could not find config directory"))?;
    let dir = config_dir
        .join("cadence")
        .join("logs")
        .join(workflow_id);

    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut agents = vec![];
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().is_some_and(|e| e == "jsonl") {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                agents.push(stem.to_string());
            }
        }
    }
    agents.sort();
    Ok(agents)
}

/// Read all logs for a workflow, interleaved and sorted by timestamp.
pub fn read_workflow_logs(workflow_id: &str) -> Result<Vec<LogEntry>> {
    let agents = list_agents_with_logs(workflow_id)?;
    let mut all: Vec<LogEntry> = vec![];
    for agent in agents {
        let mut entries = read_agent_logs(workflow_id, &agent)?;
        all.append(&mut entries);
    }
    all.sort_by_key(|e| e.timestamp);
    Ok(all)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn make_entry(workflow_id: &str, agent: &str, iteration: u32) -> LogEntry {
        LogEntry {
            timestamp: Utc::now(),
            workflow_id: workflow_id.to_string(),
            agent: agent.to_string(),
            iteration,
            prompt: "test prompt".to_string(),
            response: "test response".to_string(),
            exit_code: 0,
            duration_secs: 1.5,
        }
    }

    #[test]
    fn append_and_read_agent_logs() {
        let wf_id = "test-logs-append";
        let entry = make_entry(wf_id, "dev", 1);

        append_log(&entry).unwrap();

        let entries = read_agent_logs(wf_id, "dev").unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].agent, "dev");
        assert_eq!(entries[0].iteration, 1);
        assert_eq!(entries[0].prompt, "test prompt");
        assert_eq!(entries[0].response, "test response");
        assert_eq!(entries[0].exit_code, 0);

        // Cleanup
        let dir = logs_dir(wf_id).unwrap();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_agent_logs_missing_file_returns_empty() {
        let entries = read_agent_logs("no-such-workflow-xyz", "dev").unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn list_agents_missing_dir_returns_empty() {
        let agents = list_agents_with_logs("no-such-workflow-abc").unwrap();
        assert!(agents.is_empty());
    }

    #[test]
    fn read_workflow_logs_sorted_by_timestamp() {
        let wf_id = "test-logs-sorted";

        let mut e1 = make_entry(wf_id, "dev", 1);
        let mut e2 = make_entry(wf_id, "reviewer", 1);
        // Force deterministic ordering: e1 before e2
        e1.timestamp = DateTime::from_timestamp(1_000_000, 0).unwrap();
        e2.timestamp = DateTime::from_timestamp(2_000_000, 0).unwrap();

        append_log(&e1).unwrap();
        append_log(&e2).unwrap();

        let entries = read_workflow_logs(wf_id).unwrap();
        assert_eq!(entries.len(), 2);
        assert!(entries[0].timestamp <= entries[1].timestamp);
        assert_eq!(entries[0].agent, "dev");
        assert_eq!(entries[1].agent, "reviewer");

        // Cleanup
        let dir = logs_dir(wf_id).unwrap();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn append_multiple_entries_same_agent() {
        let wf_id = "test-logs-multi";

        for i in 1u32..=3 {
            append_log(&make_entry(wf_id, "dev", i)).unwrap();
        }

        let entries = read_agent_logs(wf_id, "dev").unwrap();
        assert_eq!(entries.len(), 3);

        // Cleanup
        let dir = logs_dir(wf_id).unwrap();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn log_entry_serializes_all_fields() {
        let entry = make_entry("wf1", "e2e-verifier", 2);
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("\"agent\":\"e2e-verifier\""));
        assert!(json.contains("\"iteration\":2"));
        assert!(json.contains("\"exit_code\":0"));
        assert!(json.contains("\"duration_secs\":1.5"));
        assert!(json.contains("\"workflow_id\":\"wf1\""));
    }
}
