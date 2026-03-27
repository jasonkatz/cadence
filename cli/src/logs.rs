use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
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

fn logs_dir(workflow_id: &str) -> Result<PathBuf> {
    let config_dir =
        dirs::config_dir().ok_or_else(|| anyhow::anyhow!("could not find config directory"))?;
    let dir = config_dir
        .join("cadence")
        .join("logs")
        .join(workflow_id);
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn append_log(entry: &LogEntry) -> Result<()> {
    let dir = logs_dir(&entry.workflow_id)?;
    let path = dir.join(format!("{}.jsonl", entry.agent));
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)?;
    let line = serde_json::to_string(entry)?;
    writeln!(file, "{}", line)?;
    Ok(())
}

pub fn read_agent_logs(workflow_id: &str, agent: &str) -> Result<Vec<LogEntry>> {
    let config_dir =
        dirs::config_dir().ok_or_else(|| anyhow::anyhow!("could not find config directory"))?;
    let path = config_dir
        .join("cadence")
        .join("logs")
        .join(workflow_id)
        .join(format!("{}.jsonl", agent));
    if !path.exists() {
        return Ok(vec![]);
    }
    let content = fs::read_to_string(&path)?;
    let entries = content
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str::<LogEntry>(l).ok())
        .collect();
    Ok(entries)
}

pub fn read_workflow_logs(workflow_id: &str) -> Result<Vec<LogEntry>> {
    let agents = list_agents_with_logs(workflow_id)?;
    let mut all: Vec<LogEntry> = Vec::new();
    for agent in &agents {
        match read_agent_logs(workflow_id, agent) {
            Ok(entries) => all.extend(entries),
            Err(e) => eprintln!("  \x1b[33mwarn: failed to read logs for agent {agent}: {e}\x1b[0m"),
        }
    }
    all.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
    Ok(all)
}

pub fn list_agents_with_logs(workflow_id: &str) -> Result<Vec<String>> {
    let config_dir =
        dirs::config_dir().ok_or_else(|| anyhow::anyhow!("could not find config directory"))?;
    let dir = config_dir.join("cadence").join("logs").join(workflow_id);
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut agents = Vec::new();
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

#[cfg(test)]
mod tests {
    use super::*;

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
        // Given
        let id = format!("test-logs-{}", uuid::Uuid::new_v4());
        let entry = make_entry(&id, "dev", 1);

        // When
        append_log(&entry).unwrap();
        let entries = read_agent_logs(&id, "dev").unwrap();

        // Then
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].agent, "dev");
        assert_eq!(entries[0].iteration, 1);
        assert_eq!(entries[0].prompt, "test prompt");
        assert_eq!(entries[0].exit_code, 0);

        // Cleanup
        let config_dir = dirs::config_dir().unwrap();
        let dir = config_dir.join("cadence").join("logs").join(&id);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn read_workflow_logs_sorted_by_timestamp() {
        // Given
        let id = format!("test-workflow-logs-{}", uuid::Uuid::new_v4());
        let mut e1 = make_entry(&id, "dev", 1);
        let mut e2 = make_entry(&id, "reviewer", 1);
        e1.timestamp = Utc::now() - chrono::Duration::seconds(10);
        e2.timestamp = Utc::now();

        // When
        append_log(&e2).unwrap();
        append_log(&e1).unwrap();
        let entries = read_workflow_logs(&id).unwrap();

        // Then — entries are sorted oldest-first regardless of write order
        assert_eq!(entries.len(), 2);
        assert!(entries[0].timestamp <= entries[1].timestamp);

        // Cleanup
        let config_dir = dirs::config_dir().unwrap();
        let dir = config_dir.join("cadence").join("logs").join(&id);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn read_agent_logs_missing_returns_empty() {
        // Given — a workflow that has never been logged
        let id = format!("test-missing-{}", uuid::Uuid::new_v4());

        // When / Then
        let entries = read_agent_logs(&id, "dev").unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn list_agents_with_logs_returns_stems() {
        // Given
        let id = format!("test-list-agents-{}", uuid::Uuid::new_v4());
        append_log(&make_entry(&id, "dev", 1)).unwrap();
        append_log(&make_entry(&id, "reviewer", 1)).unwrap();

        // When
        let agents = list_agents_with_logs(&id).unwrap();

        // Then
        assert!(agents.contains(&"dev".to_string()));
        assert!(agents.contains(&"reviewer".to_string()));

        // Cleanup
        let config_dir = dirs::config_dir().unwrap();
        let dir = config_dir.join("cadence").join("logs").join(&id);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn list_agents_missing_workflow_returns_empty() {
        // Given — a workflow directory that doesn't exist
        let id = format!("test-no-workflow-{}", uuid::Uuid::new_v4());

        // When / Then
        let agents = list_agents_with_logs(&id).unwrap();
        assert!(agents.is_empty());
    }
}
