use crate::api::{ApiClient, WorkflowList};
use crate::commands::Context;
use crate::config::Credentials;
use crate::output::{print_json, print_table};

pub async fn run(ctx: &Context, status: Option<&str>) -> anyhow::Result<()> {
    let creds = Credentials::load()?;
    if !creds.is_valid() {
        anyhow::bail!("Not authenticated. Run 'tmpo login' first.");
    }

    let client = ApiClient::new(&ctx.base_url);

    let mut path = "/v1/workflows".to_string();
    if let Some(s) = status {
        path = format!("{}?status={}", path, s);
    }

    let result: WorkflowList = client.get(&path).await?;

    if ctx.json {
        print_json(&result)?;
    } else {
        if result.workflows.is_empty() {
            println!("No workflows found.");
            return Ok(());
        }

        let rows: Vec<Vec<String>> = result
            .workflows
            .iter()
            .map(|w| {
                let short_id = &w.id[..8.min(w.id.len())];
                let task = if w.task.len() > 50 {
                    format!("{}...", &w.task[..47])
                } else {
                    w.task.clone()
                };
                let age = format_age(&w.created_at);
                vec![
                    short_id.to_string(),
                    task,
                    w.repo.clone(),
                    w.status.clone(),
                    w.iteration.to_string(),
                    age,
                ]
            })
            .collect();

        print_table(&["ID", "Task", "Repo", "Status", "Iter", "Age"], rows);
    }

    Ok(())
}

fn format_age(created_at: &str) -> String {
    let Ok(created) = chrono::DateTime::parse_from_rfc3339(created_at) else {
        return created_at.to_string();
    };
    let now = chrono::Utc::now();
    let duration = now.signed_duration_since(created);

    if duration.num_days() > 0 {
        format!("{}d ago", duration.num_days())
    } else if duration.num_hours() > 0 {
        format!("{}h ago", duration.num_hours())
    } else if duration.num_minutes() > 0 {
        format!("{}m ago", duration.num_minutes())
    } else {
        "just now".to_string()
    }
}
