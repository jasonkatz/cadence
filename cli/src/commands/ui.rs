use crate::api::{ApiClient, EnableTcpRequest, EnableTcpResponse};
use crate::commands::daemon::ensure_daemon;
use crate::commands::Context;
use crate::output::print_success;
use std::fs;
use std::path::PathBuf;

// Embed the client's built single-file HTML at compile time so the CLI can
// open the web UI without any network dependency or daemon-side serving.
// `make build-cli` runs `make build-client` first so this file exists.
const INDEX_HTML: &[u8] = include_bytes!("../../../client/dist/index.html");

pub async fn run(ctx: &Context, port: u16) -> anyhow::Result<()> {
    // Ensure daemon is running
    ensure_daemon(ctx).await?;

    let client = ApiClient::new_unix(ctx.socket_path.clone());

    // Tell daemon to enable TCP listener
    let req = EnableTcpRequest { port };
    let _: EnableTcpResponse = client.post_json("/v1/daemon/enable-tcp", &req).await?;

    // Write the embedded HTML to a stable path under ~/.tmpo/ so repeated
    // invocations reuse the same file and the browser's cache stays warm.
    let html_path = write_ui_html()?;
    let url = format!(
        "file://{}?api=http://127.0.0.1:{}",
        html_path.display(),
        port
    );
    print_success(&format!("Web UI available at {}", url));

    open_browser(&url);

    Ok(())
}

fn write_ui_html() -> anyhow::Result<PathBuf> {
    let dir = dirs_home().join(".tmpo");
    fs::create_dir_all(&dir)?;
    let path = dir.join("ui.html");
    fs::write(&path, INDEX_HTML)?;
    Ok(path)
}

fn dirs_home() -> PathBuf {
    #[cfg(unix)]
    {
        std::env::var("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("/tmp"))
    }
    #[cfg(not(unix))]
    {
        std::env::var("USERPROFILE")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."))
    }
}

fn open_browser(url: &str) {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(url).spawn();
    }

    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open").arg(url).spawn();
    }
}
