use crate::api::{ApiClient, EnableTcpRequest, EnableTcpResponse};
use crate::commands::daemon::ensure_daemon;
use crate::commands::Context;
use crate::output::print_success;

pub async fn run(ctx: &Context, port: u16) -> anyhow::Result<()> {
    // Ensure daemon is running
    ensure_daemon(ctx).await?;

    let client = ApiClient::new_unix(ctx.socket_path.clone());

    // Tell daemon to enable TCP listener
    let req = EnableTcpRequest { port };
    let _: EnableTcpResponse = client.post_json("/v1/daemon/enable-tcp", &req).await?;

    let url = format!("http://localhost:{}", port);
    print_success(&format!("Web UI available at {}", url));

    // Open browser
    open_browser(&url);

    Ok(())
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
