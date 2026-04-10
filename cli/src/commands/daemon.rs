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

    // Find the tmpod binary or dev source: check PATH, local installs, dev mode, or download
    let launch = find_or_download_tmpod().await?;

    // Spawn detached daemon process
    let mut cmd = std::process::Command::new(&launch.command);
    cmd.args(&launch.args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if let Some(ref dir) = launch.cwd {
        cmd.current_dir(dir);
    }
    let _child = cmd
        .spawn()
        .map_err(|e| anyhow::anyhow!("Failed to start daemon ({}): {}", launch.display(), e))?;

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

struct DaemonLaunch {
    command: String,
    args: Vec<String>,
    cwd: Option<PathBuf>,
}

impl DaemonLaunch {
    fn binary(path: String) -> Self {
        Self { command: path, args: vec![], cwd: None }
    }

    fn bun_dev(server_dir: PathBuf) -> Self {
        Self {
            command: "bun".to_string(),
            args: vec!["run".to_string(), "src/daemon.ts".to_string()],
            cwd: Some(server_dir),
        }
    }

    fn display(&self) -> String {
        if self.args.is_empty() {
            self.command.clone()
        } else {
            format!("{} {}", self.command, self.args.join(" "))
        }
    }
}

fn tmpo_bin_dir() -> PathBuf {
    dirs_home().join(".tmpo").join("bin")
}

fn dirs_home() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/tmp"))
}

/// Look for a compiled tmpod binary in standard locations.
fn find_tmpod_binary() -> Option<String> {
    // 1. ~/.tmpo/bin/tmpod (managed install / make install)
    let managed = tmpo_bin_dir().join("tmpod");
    if managed.exists() {
        return Some(managed.to_string_lossy().to_string());
    }

    // 2. PATH
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

    // 3. Common locations
    for candidate in &["/usr/local/bin/tmpod"] {
        if Path::new(candidate).exists() {
            return Some(candidate.to_string());
        }
    }

    None
}

/// Look for the daemon TypeScript source in a git checkout, runnable via bun.
fn find_dev_source() -> Option<PathBuf> {
    // Check if bun is available
    let bun_ok = std::process::Command::new("bun")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success());
    if !bun_ok {
        return None;
    }

    // Walk up from the CLI binary (or cwd) looking for server/src/daemon.ts
    let start_dirs: Vec<PathBuf> = vec![
        // Relative to the running binary (works when installed in the repo tree)
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf())),
        // Current working directory (works when running from repo root)
        std::env::current_dir().ok(),
    ]
    .into_iter()
    .flatten()
    .collect();

    for start in start_dirs {
        let mut dir = start.as_path();
        for _ in 0..5 {
            let daemon_ts = dir.join("server").join("src").join("daemon.ts");
            if daemon_ts.exists() {
                return Some(dir.join("server"));
            }
            match dir.parent() {
                Some(parent) => dir = parent,
                None => break,
            }
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

async fn download_tmpod() -> anyhow::Result<DaemonLaunch> {
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

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755))?;
    }

    let dest_str = dest.to_string_lossy().to_string();
    eprintln!("Installed tmpod to {dest_str}");
    Ok(DaemonLaunch::binary(dest_str))
}

async fn find_or_download_tmpod() -> anyhow::Result<DaemonLaunch> {
    // 1. Compiled binary
    if let Some(path) = find_tmpod_binary() {
        return Ok(DaemonLaunch::binary(path));
    }

    // 2. Dev mode: bun + source checkout
    if let Some(server_dir) = find_dev_source() {
        eprintln!(
            "No tmpod binary found; using dev mode (bun run src/daemon.ts in {})",
            server_dir.display()
        );
        return Ok(DaemonLaunch::bun_dev(server_dir));
    }

    // 3. Download from GitHub Releases
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
