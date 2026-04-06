use crate::api::{ApiClient, User};
use crate::commands::Context;
use crate::config::Credentials;
use crate::output::{print_json, print_table};

pub async fn run(ctx: &Context) -> anyhow::Result<()> {
    let creds = Credentials::load()?;
    if !creds.is_valid() {
        anyhow::bail!("Not authenticated. Run 'tmpo login' first.");
    }

    let client = ApiClient::new(&ctx.base_url);
    let user: User = client.get("/auth/me").await?;

    if ctx.json {
        print_json(&user)?;
    } else {
        print_table(
            &["Field", "Value"],
            vec![
                vec!["ID".to_string(), user.id],
                vec!["Email".to_string(), user.email],
                vec![
                    "Name".to_string(),
                    user.name.unwrap_or_else(|| "(not set)".to_string()),
                ],
            ],
        );
    }

    Ok(())
}
