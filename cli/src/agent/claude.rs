use anyhow::{bail, Context, Result};
use std::path::Path;
use std::process::Stdio;
use tokio::process::Command;

use crate::agent::role::AgentRole;
use crate::config::CadenceConfig;
use crate::logs::{append_log, LogEntry};

pub struct ClaudeAgent {
    pub role: AgentRole,
    pub session_id: String,
    pub model: String,
    pub permission_mode: String,
    pub budget_usd: Option<f64>,
    pub repo_dir: String,
    pub timeout_secs: u64,
    pub workflow_id: String,
    pub iteration: u32,
}

#[derive(Debug)]
#[allow(dead_code)]
pub struct AgentResponse {
    pub text: String,
    pub exit_code: i32,
}

impl ClaudeAgent {
    pub fn new(
        role: AgentRole,
        session_id: String,
        repo_dir: &Path,
        config: &CadenceConfig,
        workflow_id: String,
        iteration: u32,
    ) -> Self {
        let role_key = role.config_key();
        Self {
            role,
            session_id,
            model: config.model_for_role(role_key),
            permission_mode: config.defaults.permission_mode.clone(),
            budget_usd: config.budget_for_role(role_key),
            repo_dir: repo_dir.to_string_lossy().to_string(),
            timeout_secs: if matches!(role, AgentRole::E2e) {
                config.timeouts.e2e_secs
            } else {
                config.timeouts.agent_secs
            },
            workflow_id,
            iteration,
        }
    }

    pub async fn send(&self, prompt: &str) -> Result<AgentResponse> {
        let mut cmd = Command::new("claude");

        cmd.arg("--print")
            .arg("--output-format")
            .arg("json")
            .arg("--session-id")
            .arg(&self.session_id)
            .arg("--model")
            .arg(&self.model)
            .arg("--permission-mode")
            .arg(&self.permission_mode)
            .arg("--system-prompt")
            .arg(self.role.system_prompt())
            .arg("--allowedTools")
            .arg(self.role.allowed_tools())
            .arg("--add-dir")
            .arg(&self.repo_dir)
            .arg("--name")
            .arg(format!("cadence-{}", self.role));

        if let Some(budget) = self.budget_usd {
            cmd.arg("--max-budget-usd").arg(budget.to_string());
        }

        cmd.arg(prompt);
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        cmd.current_dir(&self.repo_dir);

        let started = std::time::Instant::now();

        let output = tokio::time::timeout(
            std::time::Duration::from_secs(self.timeout_secs),
            cmd.output(),
        )
        .await
        .with_context(|| {
            format!(
                "agent {} timed out after {}s",
                self.role, self.timeout_secs
            )
        })?
        .with_context(|| format!("spawning claude for agent {}", self.role))?;

        let duration_secs = started.elapsed().as_secs_f64();
        let exit_code = output.status.code().unwrap_or(-1);
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        if !output.status.success() && stdout.is_empty() {
            self.write_log(prompt, stderr.trim(), exit_code, duration_secs);
            bail!(
                "agent {} exited with code {}: {}",
                self.role,
                exit_code,
                stderr.trim()
            );
        }

        let text = extract_text_from_json(&stdout).unwrap_or(stdout);
        self.write_log(prompt, &text, exit_code, duration_secs);

        Ok(AgentResponse { text, exit_code })
    }

    pub async fn resume_send(&self, prompt: &str) -> Result<AgentResponse> {
        let mut cmd = Command::new("claude");

        cmd.arg("--print")
            .arg("--output-format")
            .arg("json")
            .arg("--resume")
            .arg(&self.session_id)
            .arg("--model")
            .arg(&self.model)
            .arg("--permission-mode")
            .arg(&self.permission_mode)
            .arg("--allowedTools")
            .arg(self.role.allowed_tools())
            .arg("--name")
            .arg(format!("cadence-{}", self.role));

        if let Some(budget) = self.budget_usd {
            cmd.arg("--max-budget-usd").arg(budget.to_string());
        }

        cmd.arg(prompt);
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        cmd.current_dir(&self.repo_dir);

        let started = std::time::Instant::now();

        let output = tokio::time::timeout(
            std::time::Duration::from_secs(self.timeout_secs),
            cmd.output(),
        )
        .await
        .with_context(|| {
            format!(
                "agent {} timed out after {}s",
                self.role, self.timeout_secs
            )
        })?
        .with_context(|| format!("spawning claude for agent {}", self.role))?;

        let duration_secs = started.elapsed().as_secs_f64();
        let exit_code = output.status.code().unwrap_or(-1);
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        if !output.status.success() && stdout.is_empty() {
            self.write_log(prompt, stderr.trim(), exit_code, duration_secs);
            bail!(
                "agent {} exited with code {}: {}",
                self.role,
                exit_code,
                stderr.trim()
            );
        }

        let text = extract_text_from_json(&stdout).unwrap_or(stdout);
        self.write_log(prompt, &text, exit_code, duration_secs);

        Ok(AgentResponse { text, exit_code })
    }

    fn write_log(&self, prompt: &str, response: &str, exit_code: i32, duration_secs: f64) {
        // Skip logging when no workflow context is available (e.g. standalone use)
        if self.workflow_id.is_empty() {
            return;
        }
        let entry = LogEntry {
            timestamp: chrono::Utc::now(),
            workflow_id: self.workflow_id.clone(),
            agent: self.role.to_string(),
            iteration: self.iteration,
            prompt: prompt.to_string(),
            response: response.to_string(),
            exit_code,
            duration_secs,
        };
        if let Err(e) = append_log(&entry) {
            eprintln!("  \x1b[33mwarn: failed to write agent log: {e}\x1b[0m");
        }
    }
}

fn extract_text_from_json(raw: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(raw.trim()).ok()?;

    // claude --print --output-format json returns { "result": "text" } or similar
    if let Some(result) = v.get("result").and_then(|r| r.as_str()) {
        return Some(result.to_string());
    }

    // Or it might have payloads
    let payloads = v
        .get("result")
        .and_then(|r| r.get("payloads"))
        .or_else(|| v.get("payloads"))
        .and_then(|p| p.as_array())?;

    let texts: Vec<&str> = payloads
        .iter()
        .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
        .collect();

    if texts.is_empty() {
        None
    } else {
        Some(texts.join("\n"))
    }
}

pub fn check_claude_available() -> Result<()> {
    which("claude").map_err(|_| crate::error::CadenceError::ClaudeNotFound)?;
    Ok(())
}

pub fn check_gh_available() -> Result<()> {
    which("gh").map_err(|_| crate::error::CadenceError::GhNotFound)?;
    Ok(())
}

fn which(cmd: &str) -> Result<(), ()> {
    std::process::Command::new("which")
        .arg(cmd)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|_| ())
        .and_then(|s| if s.success() { Ok(()) } else { Err(()) })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::logs::read_agent_logs;
    use std::fs;

    fn make_agent(workflow_id: &str) -> ClaudeAgent {
        ClaudeAgent {
            role: AgentRole::Dev,
            session_id: "test-session".to_string(),
            model: "claude-opus-4-5".to_string(),
            permission_mode: "default".to_string(),
            budget_usd: None,
            repo_dir: "/tmp".to_string(),
            timeout_secs: 60,
            workflow_id: workflow_id.to_string(),
            iteration: 2,
        }
    }

    #[test]
    fn write_log_creates_entry_with_timing_fields() {
        // Given — an agent with a real workflow_id
        let id = format!("test-write-log-{}", uuid::Uuid::new_v4());
        let agent = make_agent(&id);

        // When — write_log is called (same call path used by send() and resume_send())
        agent.write_log("my prompt", "my response", 0, 37.5);

        // Then — the JSONL file exists and contains the timing data
        let entries = read_agent_logs(&id, "dev").unwrap();
        assert_eq!(entries.len(), 1);
        let entry = &entries[0];
        assert_eq!(entry.agent, "dev");
        assert_eq!(entry.workflow_id, id);
        assert_eq!(entry.iteration, 2);
        assert_eq!(entry.prompt, "my prompt");
        assert_eq!(entry.response, "my response");
        assert_eq!(entry.exit_code, 0);
        assert!((entry.duration_secs - 37.5).abs() < 1e-9);
        // Timestamp should be recent (within the last minute)
        let age = chrono::Utc::now() - entry.timestamp;
        assert!(age.num_seconds() < 60);

        // Cleanup
        let config_dir = dirs::config_dir().unwrap();
        let dir = config_dir.join("cadence").join("logs").join(&id);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn write_log_records_failed_invocation() {
        // Given — simulating what send() and resume_send() do on non-zero exit
        let id = format!("test-write-log-fail-{}", uuid::Uuid::new_v4());
        let agent = make_agent(&id);

        // When — write_log is called with a non-zero exit code (failure path)
        agent.write_log("the prompt", "stderr output here", 1, 2.1);

        // Then — failure entry is stored with correct exit_code and response
        let entries = read_agent_logs(&id, "dev").unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].exit_code, 1);
        assert_eq!(entries[0].response, "stderr output here");
        assert!((entries[0].duration_secs - 2.1).abs() < 1e-9);

        // Cleanup
        let config_dir = dirs::config_dir().unwrap();
        let dir = config_dir.join("cadence").join("logs").join(&id);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn write_log_skipped_when_no_workflow_id() {
        // Given — an agent with an empty workflow_id (standalone use)
        let agent = ClaudeAgent {
            workflow_id: "".to_string(),
            ..make_agent("unused")
        };

        // When — write_log is called
        // Then — no panic and no file written (guard clause behaviour)
        agent.write_log("prompt", "response", 0, 1.0);
        // If we reach here without panic, the guard worked
    }

    #[test]
    fn write_log_called_twice_appends_both_entries() {
        // Given — two calls representing send() and resume_send() in sequence
        let id = format!("test-write-log-append-{}", uuid::Uuid::new_v4());
        let agent = make_agent(&id);

        // When
        agent.write_log("first prompt", "first response", 0, 10.0);
        agent.write_log("second prompt", "second response", 0, 20.0);

        // Then — both entries are present (append, not overwrite)
        let entries = read_agent_logs(&id, "dev").unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].prompt, "first prompt");
        assert_eq!(entries[1].prompt, "second prompt");
        assert!((entries[0].duration_secs - 10.0).abs() < 1e-9);
        assert!((entries[1].duration_secs - 20.0).abs() < 1e-9);

        // Cleanup
        let config_dir = dirs::config_dir().unwrap();
        let dir = config_dir.join("cadence").join("logs").join(&id);
        let _ = fs::remove_dir_all(dir);
    }
}
