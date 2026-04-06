use crate::api::{ApiClient, Step, WorkflowDetail};
use crate::commands::Context;
use crate::config::Credentials;
use crate::output::{print_json, print_table};

#[derive(serde::Serialize)]
struct FullStatusOutput {
    #[serde(flatten)]
    detail: WorkflowDetail,
    all_steps: Vec<Step>,
}

pub async fn run(ctx: &Context, workflow_id: &str) -> anyhow::Result<()> {
    let creds = Credentials::load()?;
    if !creds.is_valid() {
        anyhow::bail!("Not authenticated. Run 'tmpo login' first.");
    }

    let client = ApiClient::new(&ctx.base_url);
    let detail: WorkflowDetail = client.get(&format!("/v1/workflows/{}", workflow_id)).await?;

    if ctx.json {
        // --json: include steps for all iterations
        let all_steps: Vec<Step> = client
            .get(&format!("/v1/workflows/{}/steps", workflow_id))
            .await?;
        let output = FullStatusOutput {
            detail,
            all_steps,
        };
        print_json(&output)?;
    } else {
        let w = &detail.workflow;
        let mut rows = vec![
            vec!["ID".to_string(), w.id.clone()],
            vec!["Task".to_string(), w.task.clone()],
            vec!["Repo".to_string(), w.repo.clone()],
            vec!["Branch".to_string(), w.branch.clone()],
            vec!["Status".to_string(), w.status.clone()],
            vec![
                "Iteration".to_string(),
                format!("{} / {}", w.iteration, w.max_iters),
            ],
        ];

        if let Some(pr_number) = w.pr_number {
            rows.push(vec![
                "PR".to_string(),
                format!(
                    "#{} (https://github.com/{}/pull/{})",
                    pr_number, w.repo, pr_number
                ),
            ]);
        }

        if let Some(ref error) = w.error {
            rows.push(vec!["Error".to_string(), error.clone()]);
        }

        print_table(&["Field", "Value"], rows);

        if !detail.steps.is_empty() {
            println!(
                "\nSteps (iteration {}):",
                detail.steps[0].iteration
            );
            let step_rows: Vec<Vec<String>> = detail
                .steps
                .iter()
                .map(|s| {
                    let timing = match (&s.started_at, &s.finished_at) {
                        (Some(start), Some(end)) => format_duration(start, end),
                        (Some(_), None) => "running...".to_string(),
                        _ => "-".to_string(),
                    };
                    let mut row = vec![s.step_type.clone(), s.status.clone(), timing];
                    if s.status == "failed" {
                        if let Some(ref detail) = s.detail {
                            row.push(truncate(detail, 80));
                        }
                    }
                    row
                })
                .collect();

            let has_detail = step_rows.iter().any(|r| r.len() > 3);
            if has_detail {
                print_table(&["Type", "Status", "Duration", "Detail"], step_rows);
            } else {
                print_table(&["Type", "Status", "Duration"], step_rows);
            }
        }
    }

    Ok(())
}

fn truncate(s: &str, max: usize) -> String {
    let first_line = s.lines().next().unwrap_or(s);
    if first_line.len() > max {
        format!("{}...", &first_line[..max])
    } else {
        first_line.to_string()
    }
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
