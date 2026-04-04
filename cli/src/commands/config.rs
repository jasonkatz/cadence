use crate::api::{ApiClient, Settings, SettingsInput};
use crate::commands::Context;
use crate::config::Credentials;
use crate::output::{print_error, print_json, print_success, print_table};

pub async fn run_set(ctx: &Context, key: &str, value: &str) -> anyhow::Result<()> {
    if key != "github-token" {
        anyhow::bail!("Unknown config key '{}'. Supported: github-token", key);
    }

    let creds = Credentials::load()?;
    if !creds.is_valid() {
        anyhow::bail!("Not authenticated. Run 'cadence login' first.");
    }

    let client = ApiClient::new(&ctx.base_url);
    let input = SettingsInput {
        github_token: value.to_string(),
    };
    let settings: Settings = client.put_json("/v1/settings", &input).await?;

    let masked = settings.github_token.unwrap_or_default();
    print_success(&format!("GitHub token saved: {}", masked));
    Ok(())
}

pub async fn run_get(ctx: &Context) -> anyhow::Result<()> {
    let creds = Credentials::load()?;
    if !creds.is_valid() {
        anyhow::bail!("Not authenticated. Run 'cadence login' first.");
    }

    let client = ApiClient::new(&ctx.base_url);
    let settings: Settings = client.get("/v1/settings").await?;

    if ctx.json {
        print_json(&settings)?;
    } else {
        match settings.github_token {
            Some(token) => {
                print_table(
                    &["Key", "Value"],
                    vec![vec!["github-token".to_string(), token]],
                );
            }
            None => {
                print_error("No GitHub token configured. Use 'cadence config set github-token <value>' to set one.");
            }
        }
    }

    Ok(())
}
