use anyhow::Result;

use crate::config::CadenceConfig;

pub async fn send(message: &str, config: &CadenceConfig) -> Result<()> {
    let notify = match &config.notify {
        Some(n) => n,
        None => return Ok(()),
    };

    let body = notify.body_template.replace("{{message}}", message);

    let client = reqwest::Client::new();
    let resp = client
        .post(&notify.url)
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        anyhow::bail!("webhook returned {status}: {text}");
    }

    Ok(())
}
