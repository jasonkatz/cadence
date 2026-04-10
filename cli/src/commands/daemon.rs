use crate::api::{ApiClient, DaemonStatus};
use crate::commands::Context;
use crate::output::{print_json, print_success, print_table};
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

/// Start the daemon in the background.
pub async fn run_start(ctx: &Context) -> anyhow::Result<()> {
    let client = ApiClient::new_unix(ctx.socket_path.clone());

    // Check if already running
    if client.is_reachable().await {
        if ctx.json {
            let status: DaemonStatus = client.get("/v1/daemon/status").await?;
            print_json(&status)?;
        } else {
            print_success("Daemon is already running.");
        }
        return Ok(());
    }

    // Find the tmpod binary: check PATH, then common locations
    let tmpod = find_tmpod()?;

    // Spawn detached daemon process
    let _child = std::process::Command::new(&tmpod)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| anyhow::anyhow!("Failed to start daemon ({}): {}", tmpod, e))?;

    // Wait for socket to appear (poll up to 5s)
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        if ctx.socket_path.exists() && client.is_reachable().await {
            break;
        }
        if tokio::time::Instant::now() > deadline {
            anyhow::bail!("Daemon did not start within 5 seconds");
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    if ctx.json {
        let status: DaemonStatus = client.get("/v1/daemon/status").await?;
        print_json(&status)?;
    } else {
        print_success("Daemon started.");
    }

    Ok(())
}

/// Stop the daemon gracefully.
pub async fn run_stop(ctx: &Context) -> anyhow::Result<()> {
    let client = ApiClient::new_unix(ctx.socket_path.clone());

    if !client.is_reachable().await {
        if ctx.json {
            print_json(&serde_json::json!({ "ok": true, "message": "Daemon is not running" }))?;
        } else {
            print_success("Daemon is not running.");
        }
        return Ok(());
    }

    let _: serde_json::Value = client.post("/v1/daemon/stop").await?;

    // Wait for PID file removal (up to 35s for graceful shutdown)
    let pid_path = ctx.socket_path.with_file_name("tmpod.pid");
    let deadline = tokio::time::Instant::now() + Duration::from_secs(35);
    loop {
        if !pid_path.exists() && !ctx.socket_path.exists() {
            break;
        }
        if tokio::time::Instant::now() > deadline {
            anyhow::bail!("Daemon did not stop within 35 seconds");
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }

    if ctx.json {
        print_json(&serde_json::json!({ "ok": true, "message": "Daemon stopped" }))?;
    } else {
        print_success("Daemon stopped.");
    }

    Ok(())
}

/// Show daemon status.
pub async fn run_status(ctx: &Context) -> anyhow::Result<()> {
    let client = ApiClient::new_unix(ctx.socket_path.clone());

    if !client.is_reachable().await {
        if ctx.json {
            print_json(&serde_json::json!({ "running": false }))?;
        } else {
            println!("Daemon is not running.");
        }
        return Ok(());
    }

    let status: DaemonStatus = client.get("/v1/daemon/status").await?;

    if ctx.json {
        print_json(&serde_json::json!({
            "running": true,
            "pid": status.pid,
            "uptime": status.uptime,
            "socket_path": status.socket_path,
            "tcp_port": status.tcp_port,
            "active_workflows": status.active_workflows,
        }))?;
    } else {
        let uptime_str = format_uptime(status.uptime);
        let tcp_str = status
            .tcp_port
            .map(|p| format!("localhost:{}", p))
            .unwrap_or_else(|| "off".to_string());

        print_table(
            &["Field", "Value"],
            vec![
                vec!["Status".to_string(), "running".to_string()],
                vec!["PID".to_string(), status.pid.to_string()],
                vec!["Uptime".to_string(), uptime_str],
                vec!["Socket".to_string(), status.socket_path],
                vec!["TCP".to_string(), tcp_str],
                vec![
                    "Active workflows".to_string(),
                    status.active_workflows.to_string(),
                ],
            ],
        );
    }

    Ok(())
}

/// Ensure the daemon is running, starting it if necessary. Returns Ok(()) when the daemon is ready.
pub async fn ensure_daemon(ctx: &Context) -> anyhow::Result<()> {
    let client = ApiClient::new_unix(ctx.socket_path.clone());
    if client.is_reachable().await {
        return Ok(());
    }

    // Auto-start
    eprintln!("Starting daemon...");
    run_start(ctx).await
}

fn find_tmpod() -> anyhow::Result<String> {
    // Check if tmpod is on PATH
    if let Ok(output) = std::process::Command::new("which")
        .arg("tmpod")
        .output()
    {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Ok(path);
            }
        }
    }

    // Check common locations
    let candidates = [
        "/usr/local/bin/tmpod",
        // Look relative to the CLI binary
    ];
    for candidate in &candidates {
        if Path::new(candidate).exists() {
            return Ok(candidate.to_string());
        }
    }

    // Last resort: try to run via bun in the server directory
    // This is useful during development
    anyhow::bail!(
        "Could not find 'tmpod' binary. Install it with 'make install' or add it to your PATH."
    )
}

fn format_uptime(seconds: i64) -> String {
    if seconds < 60 {
        format!("{}s", seconds)
    } else if seconds < 3600 {
        format!("{}m {}s", seconds / 60, seconds % 60)
    } else {
        let hours = seconds / 3600;
        let mins = (seconds % 3600) / 60;
        format!("{}h {}m", hours, mins)
    }
}
