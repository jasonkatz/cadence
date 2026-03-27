use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, Write};
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

pub fn logs_dir(workflow_id: &str) -> Result<PathBuf> {
    let config_dir =
        dirs::config_dir().ok_or_else(|| anyhow::anyhow!("could not find config directory"))?;
    let dir = config_dir
        .join("cadence")
        .join("logs")
        .join(workflow_id);
    fs::create_dir_all(&dir)
        .with_context(|| format!("creating logs directory {}", dir.display()))?;
    Ok(dir)
}

pub fn append_log(entry: &LogEntry) -> Result<()> {
    let dir = logs_dir(&entry.workflow_id)?;
    let path = dir.join(format!("{}.jsonl", entry.agent));

    let line = serde_json::to_string(entry).context("serializing log entry")?;

    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .with_context(|| format!("opening log file {}", path.display()))?;

    writeln!(file, "{line}")
        .with_context(|| format!("writing to log file {}", path.display()))?;

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

    parse_jsonl_file(&path)
}

pub fn read_workflow_logs(workflow_id: &str) -> Result<Vec<LogEntry>> {
    let config_dir =
        dirs::config_dir().ok_or_else(|| anyhow::anyhow!("could not find config directory"))?;
    let dir = config_dir.join("cadence").join("logs").join(workflow_id);

    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut entries = Vec::new();
    for path in jsonl_files_in_dir(&dir)? {
        let mut file_entries = parse_jsonl_file(&path)?;
        entries.append(&mut file_entries);
    }

    entries.sort_by_key(|e| e.timestamp);
    Ok(entries)
}

#[allow(dead_code)]
pub fn list_agents_with_logs(workflow_id: &str) -> Result<Vec<String>> {
    let config_dir =
        dirs::config_dir().ok_or_else(|| anyhow::anyhow!("could not find config directory"))?;
    let dir = config_dir.join("cadence").join("logs").join(workflow_id);

    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut agents = Vec::new();
    for path in jsonl_files_in_dir(&dir)? {
        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
            agents.push(stem.to_string());
        }
    }

    agents.sort();
    Ok(agents)
}

fn jsonl_files_in_dir(dir: &PathBuf) -> Result<Vec<PathBuf>> {
    let mut paths = Vec::new();
    for entry in fs::read_dir(dir)
        .with_context(|| format!("reading log directory {}", dir.display()))?
    {
        let entry = entry?;
        let path = entry.path();
        if path.extension().is_some_and(|e| e == "jsonl") {
            paths.push(path);
        }
    }
    Ok(paths)
}

fn parse_jsonl_file(path: &PathBuf) -> Result<Vec<LogEntry>> {
    let file = fs::File::open(path)
        .with_context(|| format!("opening log file {}", path.display()))?;
    let reader = std::io::BufReader::new(file);

    let mut entries = Vec::new();
    for (line_num, line) in reader.lines().enumerate() {
        let line = line.with_context(|| format!("reading line {} of {}", line_num + 1, path.display()))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        match serde_json::from_str::<LogEntry>(trimmed) {
            Ok(entry) => entries.push(entry),
            Err(e) => eprintln!(
                "  \x1b[33mwarning: skipping malformed log line in {}: {e}\x1b[0m",
                path.display()
            ),
        }
    }
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn make_entry(workflow_id: &str, agent: &str, iteration: u32) -> LogEntry {
        LogEntry {
            timestamp: Utc::now(),
            workflow_id: workflow_id.to_string(),
            agent: agent.to_string(),
            iteration,
            prompt: "Do the thing".to_string(),
            response: "Done".to_string(),
            exit_code: 0,
            duration_secs: 10.5,
        }
    }

    #[test]
    fn log_entry_roundtrips_through_json() {
        let entry = make_entry("wf-abc", "dev", 1);
        let json = serde_json::to_string(&entry).unwrap();
        let decoded: LogEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded.workflow_id, "wf-abc");
        assert_eq!(decoded.agent, "dev");
        assert_eq!(decoded.iteration, 1);
        assert_eq!(decoded.exit_code, 0);
        assert!((decoded.duration_secs - 10.5).abs() < f64::EPSILON);
    }

    #[test]
    fn parse_jsonl_file_skips_blank_lines() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("dev.jsonl");
        let entry = make_entry("wf-abc", "dev", 1);
        let line = serde_json::to_string(&entry).unwrap();
        fs::write(&path, format!("\n{line}\n\n")).unwrap();

        let entries = parse_jsonl_file(&path).unwrap();
        assert_eq!(entries.len(), 1);
    }

    #[test]
    fn parse_jsonl_file_skips_malformed_lines() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("dev.jsonl");
        let entry = make_entry("wf-abc", "dev", 1);
        let good_line = serde_json::to_string(&entry).unwrap();
        fs::write(&path, format!("{{bad json}}\n{good_line}\n")).unwrap();

        // Should not error — just skip the bad line and emit a warning
        let entries = parse_jsonl_file(&path).unwrap();
        assert_eq!(entries.len(), 1);
    }

    #[test]
    fn read_agent_logs_returns_empty_for_missing_file() {
        // Use a non-existent workflow id
        let entries = read_agent_logs("does-not-exist-xyz", "dev").unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn read_workflow_logs_returns_empty_for_missing_dir() {
        let entries = read_workflow_logs("does-not-exist-xyz").unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn list_agents_returns_empty_for_missing_dir() {
        let agents = list_agents_with_logs("does-not-exist-xyz").unwrap();
        assert!(agents.is_empty());
    }
}
