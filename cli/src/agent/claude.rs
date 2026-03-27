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

        let failed_with_no_stdout = !output.status.success() && stdout.is_empty();
        let response_text = if failed_with_no_stdout {
            stderr.trim().to_string()
        } else {
            extract_text_from_json(&stdout).unwrap_or_else(|| stdout.clone())
        };

        self.write_log(prompt, &response_text, exit_code, duration_secs);

        if failed_with_no_stdout {
            bail!(
                "agent {} exited with code {}: {}",
                self.role,
                exit_code,
                stderr.trim()
            );
        }

        Ok(AgentResponse {
            text: response_text,
            exit_code,
        })
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

        let failed_with_no_stdout = !output.status.success() && stdout.is_empty();
        let response_text = if failed_with_no_stdout {
            stderr.trim().to_string()
        } else {
            extract_text_from_json(&stdout).unwrap_or_else(|| stdout.clone())
        };

        self.write_log(prompt, &response_text, exit_code, duration_secs);

        if failed_with_no_stdout {
            bail!(
                "agent {} exited with code {}: {}",
                self.role,
                exit_code,
                stderr.trim()
            );
        }

        Ok(AgentResponse {
            text: response_text,
            exit_code,
        })
    }

    /// Serialize and append the interaction to the workflow's JSONL log.
    ///
    /// Disk failures print a warning but do not abort the pipeline.
    fn write_log(&self, prompt: &str, response: &str, exit_code: i32, duration_secs: f64) {
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
            eprintln!("  \x1b[33mwarning: failed to write agent log: {e}\x1b[0m");
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
