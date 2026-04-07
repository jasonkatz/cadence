use crate::api::{ApiClient, Run};
use crate::commands::Context;
use crate::output::{print_json, print_table};

pub async fn run(
    ctx: &Context,
    workflow_id: &str,
    agent: Option<&str>,
    iteration: Option<i64>,
    full: bool,
) -> anyhow::Result<()> {
    let client = ApiClient::new(&ctx.base_url);

    let mut path = format!("/v1/workflows/{}/runs", workflow_id);
    let mut params: Vec<String> = Vec::new();

    if let Some(role) = agent {
        params.push(format!("agent_role={}", role));
    }
    if let Some(iter) = iteration {
        params.push(format!("iteration={}", iter));
    }
    if !params.is_empty() {
        path = format!("{}?{}", path, params.join("&"));
    }

    let runs: Vec<Run> = client.get(&path).await?;

    if ctx.json {
        print_json(&runs)?;
        return Ok(());
    }

    if runs.is_empty() {
        println!("No runs found.");
        return Ok(());
    }

    if full {
        for run in &runs {
            println!("--- Run {} ---", run.id);
            println!("Timestamp:  {}", run.created_at);
            println!("Agent:      {}", run.agent_role);
            println!("Iteration:  {}", run.iteration);
            println!(
                "Exit Code:  {}",
                run.exit_code
                    .map(|c| c.to_string())
                    .unwrap_or_else(|| "-".to_string())
            );
            println!(
                "Duration:   {}",
                run.duration_secs
                    .map(|d| format!("{:.1}s", d))
                    .unwrap_or_else(|| "-".to_string())
            );
            println!("\nPrompt:\n{}", run.prompt);
            println!(
                "\nResponse:\n{}",
                run.response.as_deref().unwrap_or("-")
            );
            println!();
        }
    } else {
        let rows: Vec<Vec<String>> = runs
            .iter()
            .map(|r| {
                vec![
                    r.created_at.clone(),
                    r.agent_role.clone(),
                    r.iteration.to_string(),
                    r.exit_code
                        .map(|c| c.to_string())
                        .unwrap_or_else(|| "-".to_string()),
                    r.duration_secs
                        .map(|d| format!("{:.1}s", d))
                        .unwrap_or_else(|| "-".to_string()),
                    truncate(&r.prompt, 200),
                    truncate(r.response.as_deref().unwrap_or("-"), 200),
                ]
            })
            .collect();

        print_table(
            &["Timestamp", "Agent", "Iter", "Exit", "Duration", "Prompt", "Response"],
            rows,
        );
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
