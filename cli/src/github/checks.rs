use anyhow::{Context, Result};
use std::process::Stdio;
use tokio::process::Command;

#[derive(Debug, PartialEq, Eq)]
pub enum GhaStatus {
    Success,
    Failure,
    Pending,
    Timeout,
}

pub async fn wait_for_gha(
    repo: &str,
    pr_num: u64,
    timeout_secs: u64,
    poll_interval_secs: u64,
) -> Result<GhaStatus> {
    let mut elapsed = 0u64;

    while elapsed < timeout_secs {
        let status = check_gha_status(repo, pr_num).await?;
        match status {
            GhaStatus::Success | GhaStatus::Failure => return Ok(status),
            GhaStatus::Pending | GhaStatus::Timeout => {
                tokio::time::sleep(std::time::Duration::from_secs(poll_interval_secs)).await;
                elapsed += poll_interval_secs;
            }
        }
    }

    Ok(GhaStatus::Timeout)
}

async fn check_gha_status(repo: &str, pr_num: u64) -> Result<GhaStatus> {
    let output = Command::new("gh")
        .args([
            "pr",
            "checks",
            &pr_num.to_string(),
            "--repo",
            repo,
            "--json",
            "state",
            "--jq",
            r#"[.[].state] | if all(. == "SUCCESS" or . == "SKIPPED") then "success" elif any(. == "FAILURE") then "failure" elif any(. == "ERROR") then "failure" else "pending" end"#,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .context("checking GHA status")?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

    Ok(match stdout.as_str() {
        "success" => GhaStatus::Success,
        "failure" => GhaStatus::Failure,
        _ => GhaStatus::Pending,
    })
}

pub async fn get_failure_logs(repo: &str, pr_num: u64) -> Result<String> {
    let check_output = Command::new("gh")
        .args([
            "pr",
            "checks",
            &pr_num.to_string(),
            "--repo",
            repo,
            "--json",
            "state,link",
            "--jq",
            r#"[.[] | select(.state == "FAILURE")][0].link"#,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await?;

    let link = String::from_utf8_lossy(&check_output.stdout).trim().to_string();

    // Extract run ID from the link
    let run_id = link
        .split('/')
        .filter(|s| s.chars().all(|c| c.is_ascii_digit()) && !s.is_empty())
        .last()
        .unwrap_or("")
        .to_string();

    if run_id.is_empty() {
        return Ok("Could not retrieve failure logs".to_string());
    }

    let log_output = Command::new("gh")
        .args(["run", "view", &run_id, "--repo", repo, "--log-failed"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await?;

    let logs = String::from_utf8_lossy(&log_output.stdout);
    let lines: Vec<&str> = logs.lines().collect();
    let tail = if lines.len() > 80 {
        &lines[lines.len() - 80..]
    } else {
        &lines
    };

    Ok(tail.join("\n"))
}
