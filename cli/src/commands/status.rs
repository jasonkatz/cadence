use crate::api::{ApiClient, WorkflowDetail};
use crate::commands::Context;
use crate::config::Credentials;
use crate::output::{print_json, print_table};

pub async fn run(ctx: &Context, workflow_id: &str) -> anyhow::Result<()> {
    let creds = Credentials::load()?;
    if !creds.is_valid() {
        anyhow::bail!("Not authenticated. Run 'cadence login' first.");
    }

    let client = ApiClient::new(&ctx.base_url);
    let detail: WorkflowDetail = client.get(&format!("/v1/workflows/{}", workflow_id)).await?;

    if ctx.json {
        print_json(&detail)?;
    } else {
        let w = &detail.workflow;
        print_table(
            &["Field", "Value"],
            vec![
                vec!["ID".to_string(), w.id.clone()],
                vec!["Task".to_string(), w.task.clone()],
                vec!["Repo".to_string(), w.repo.clone()],
                vec!["Branch".to_string(), w.branch.clone()],
                vec!["Status".to_string(), w.status.clone()],
                vec!["Iteration".to_string(), w.iteration.to_string()],
            ],
        );

        if !detail.steps.is_empty() {
            println!("\nSteps (iteration {}):", detail.steps[0].iteration);
            let step_rows: Vec<Vec<String>> = detail
                .steps
                .iter()
                .map(|s| {
                    let timing = match (&s.started_at, &s.finished_at) {
                        (Some(start), Some(end)) => {
                            format_duration(start, end)
                        }
                        (Some(_), None) => "running...".to_string(),
                        _ => "-".to_string(),
                    };
                    vec![s.step_type.clone(), s.status.clone(), timing]
                })
                .collect();
            print_table(&["Type", "Status", "Duration"], step_rows);
        }
    }

    Ok(())
}

fn format_duration(start: &str, end: &str) -> String {
    let Ok(s) = chrono::DateTime::parse_from_rfc3339(start) else {
        return "-".to_string();
    };
    let Ok(e) = chrono::DateTime::parse_from_rfc3339(end) else {
        return "-".to_string();
    };
    let secs = (e - s).num_seconds();
    if secs < 60 {
        format!("{}s", secs)
    } else {
        format!("{}m {}s", secs / 60, secs % 60)
    }
}
