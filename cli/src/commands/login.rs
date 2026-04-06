use reqwest::Client;
use std::collections::HashMap;
use std::time::Duration;
use tokio::time::sleep;

use crate::api::{DeviceCodeResponse, TokenErrorResponse, TokenResponse};
use crate::commands::Context;
use crate::config::Credentials;
use crate::output::print_success;

const AUTH0_DOMAIN: &str = match option_env!("AUTH0_DOMAIN") {
    Some(v) => v,
    None => "your-tenant.auth0.com",
};
const AUTH0_CLIENT_ID: &str = match option_env!("AUTH0_CLIENT_ID") {
    Some(v) => v,
    None => "your-cli-client-id",
};
const AUTH0_AUDIENCE: &str = match option_env!("AUTH0_AUDIENCE") {
    Some(v) => v,
    None => "https://api.yourapp.com",
};

pub async fn run(_ctx: &Context) -> anyhow::Result<()> {
    let creds = Credentials::load()?;
    if creds.is_valid() {
        print_success("Already logged in. Use 'tmpo logout' to sign out first.");
        return Ok(());
    }

    let client = Client::new();

    let mut params = HashMap::new();
    params.insert("client_id", AUTH0_CLIENT_ID);
    params.insert("scope", "openid profile email offline_access");
    params.insert("audience", AUTH0_AUDIENCE);

    let device_code_url = format!("https://{}/oauth/device/code", AUTH0_DOMAIN);
    let response = client
        .post(&device_code_url)
        .form(&params)
        .send()
        .await?;

    if !response.status().is_success() {
        let text = response.text().await?;
        anyhow::bail!("Failed to start device flow: {}", text);
    }

    let device_code: DeviceCodeResponse = response.json().await?;

    println!("\nTo authenticate, please visit:");
    println!("\n  {}\n", device_code.verification_uri_complete);
    println!("Or go to {} and enter code: {}\n", device_code.verification_uri, device_code.user_code);

    if open::that(&device_code.verification_uri_complete).is_err() {
        println!("(Could not open browser automatically)");
    }

    println!("Waiting for authentication...");

    let token = poll_for_token(&client, &device_code).await?;

    let expires_at = chrono::Utc::now().timestamp() + token.expires_in as i64;
    let creds = Credentials {
        access_token: Some(token.access_token),
        refresh_token: token.refresh_token,
        expires_at: Some(expires_at),
    };
    creds.save()?;

    print_success("\nLogged in. Run 'tmpo whoami' to see your account.");
    Ok(())
}

async fn poll_for_token(
    client: &Client,
    device_code: &DeviceCodeResponse,
) -> anyhow::Result<TokenResponse> {
    let token_url = format!("https://{}/oauth/token", AUTH0_DOMAIN);
    let interval = Duration::from_secs(device_code.interval);

    loop {
        sleep(interval).await;

        let mut params = HashMap::new();
        params.insert("grant_type", "urn:ietf:params:oauth:grant-type:device_code");
        params.insert("device_code", &device_code.device_code);
        params.insert("client_id", AUTH0_CLIENT_ID);

        let response = client.post(&token_url).form(&params).send().await?;

        if response.status().is_success() {
            return Ok(response.json().await?);
        }

        let error: TokenErrorResponse = response.json().await?;

        match error.error.as_str() {
            "authorization_pending" => continue,
            "slow_down" => {
                sleep(Duration::from_secs(5)).await;
                continue;
            }
            "expired_token" => {
                anyhow::bail!("Authentication timed out. Run 'tmpo login' to try again.");
            }
            "access_denied" => {
                anyhow::bail!("Authentication was denied.");
            }
            _ => {
                anyhow::bail!(
                    "Authentication failed: {}",
                    error.error_description.unwrap_or(error.error)
                );
            }
        }
    }
}
