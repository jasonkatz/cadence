use crate::api::{ApiClient, DaemonStatus};
use crate::commands::Context;
use crate::output::{print_json, print_success, print_table};
use std::io::Write;
use std::path::{Path, PathBuf};
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

    // Find the tmpod binary: check PATH, local installs, or download
    let tmpod = find_or_download_tmpod().await?;

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
/// Skips daemon management when connecting to a remote URL.
pub async fn ensure_daemon(ctx: &Context) -> anyhow::Result<()> {
    if ctx.remote_url.is_some() {
        return Ok(());
    }

    let client = ApiClient::new_unix(ctx.socket_path.clone());
    if client.is_reachable().await {
        return Ok(());
    }

    // Auto-start
    eprintln!("Starting daemon...");
    run_start(ctx).await
}

const GITHUB_REPO: &str = "jasonkatz/tmpo";

fn tmpo_bin_dir() -> PathBuf {
    dirs_home().join(".tmpo").join("bin")
}

fn dirs_home() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/tmp"))
}

fn find_tmpod() -> Option<String> {
    // 1. Check ~/.tmpo/bin/tmpod (managed install location)
    let managed = tmpo_bin_dir().join("tmpod");
    if managed.exists() {
        return Some(managed.to_string_lossy().to_string());
    }

    // 2. Check PATH
    if let Ok(output) = std::process::Command::new("which")
        .arg("tmpod")
        .output()
    {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(path);
            }
        }
    }

    // 3. Check common locations
    for candidate in &["/usr/local/bin/tmpod"] {
        if Path::new(candidate).exists() {
            return Some(candidate.to_string());
        }
    }

    None
}

fn platform_target() -> anyhow::Result<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Ok("darwin-arm64"),
        ("macos", "x86_64") => Ok("darwin-x64"),
        ("linux", "x86_64") => Ok("linux-x64"),
        ("linux", "aarch64") => Ok("linux-arm64"),
        (os, arch) => anyhow::bail!("Unsupported platform: {os}-{arch}"),
    }
}

async fn download_tmpod() -> anyhow::Result<String> {
    let target = platform_target()?;
    let asset_name = format!("tmpod-{target}");
    let url = format!(
        "https://github.com/{GITHUB_REPO}/releases/latest/download/{asset_name}"
    );

    eprint!(
        "tmpod not found. Download from GitHub Releases?\n  {url}\n\n[Y/n] "
    );
    std::io::stderr().flush()?;

    let mut input = String::new();
    std::io::stdin().read_line(&mut input)?;
    let answer = input.trim().to_lowercase();
    if !answer.is_empty() && answer != "y" && answer != "yes" {
        anyhow::bail!("Cancelled. Install tmpod manually: https://github.com/{GITHUB_REPO}/releases");
    }

    eprintln!("Downloading {asset_name}...");

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("User-Agent", "tmpo-cli")
        .send()
        .await?;

    if !resp.status().is_success() {
        anyhow::bail!(
            "Download failed (HTTP {}). Check https://github.com/{}/releases for available binaries.",
            resp.status(),
            GITHUB_REPO
        );
    }

    let bytes = resp.bytes().await?;

    let bin_dir = tmpo_bin_dir();
    std::fs::create_dir_all(&bin_dir)?;

    let dest = bin_dir.join("tmpod");
    std::fs::write(&dest, &bytes)?;

    // Make executable
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755))?;
    }

    let dest_str = dest.to_string_lossy().to_string();
    eprintln!("Installed tmpod to {dest_str}");
    Ok(dest_str)
}

async fn find_or_download_tmpod() -> anyhow::Result<String> {
    if let Some(path) = find_tmpod() {
        return Ok(path);
    }
    download_tmpod().await
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
