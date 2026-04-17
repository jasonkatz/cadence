use crate::api::Run;
use crate::commands::daemon::ensure_daemon;
use crate::commands::Context;
use crate::output::{print_json, print_table};
use serde_json::Value;

pub async fn run(
    ctx: &Context,
    workflow_id: &str,
    agent: Option<&str>,
    iteration: Option<i64>,
    full: bool,
) -> anyhow::Result<()> {
    ensure_daemon(ctx).await?;
    let client = ctx.client();

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
            print_run_header(run);
            let log_path = format!("/v1/runs/{}/log", run.id);
            match client.get_text(&log_path).await {
                Ok(body) => render_messages(&body),
                Err(err) => println!("  (failed to load messages: {})", err),
            }
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
                    r.log_path.as_deref().unwrap_or("-").to_string(),
                ]
            })
            .collect();

        print_table(
            &["Timestamp", "Agent", "Iter", "Exit", "Duration", "Log Path"],
            rows,
        );
    }

    Ok(())
}

fn print_run_header(run: &Run) {
    println!("=== {} (iter {}) — {} ===", run.agent_role, run.iteration, run.created_at);
    let exit = run
        .exit_code
        .map(|c| c.to_string())
        .unwrap_or_else(|| "-".to_string());
    let duration = run
        .duration_secs
        .map(|d| format!("{:.1}s", d))
        .unwrap_or_else(|| "-".to_string());
    println!("    run={} exit={} duration={}", run.id, exit, duration);
}

fn render_messages(body: &str) {
    let mut printed_any = false;
    for line in body.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let entry: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let ts = entry.get("ts").and_then(Value::as_str).unwrap_or("");
        let event = entry.get("event").and_then(Value::as_str).unwrap_or("");
        let data = entry.get("data");

        if let Some(rendered) = render_entry(event, data) {
            for line in rendered.lines() {
                println!("[{}] {}", short_ts(ts), line);
            }
            printed_any = true;
        }
    }
    if !printed_any {
        println!("  (no messages logged)");
    }
}

fn render_entry(event: &str, data: Option<&Value>) -> Option<String> {
    match event {
        "prompt" => {
            let text = data
                .and_then(|d| d.get("text"))
                .and_then(Value::as_str)
                .unwrap_or("");
            Some(format!("prompt:\n{}", indent(text)))
        }
        // Legacy event written by pre-stream-json runs.
        "response" => {
            let text = data
                .and_then(|d| d.get("text"))
                .and_then(Value::as_str)
                .unwrap_or("");
            Some(format!("response:\n{}", indent(text)))
        }
        "assistant" => {
            let blocks = data
                .and_then(|d| d.get("message"))
                .and_then(|m| m.get("content"))
                .and_then(Value::as_array)?;
            let mut out = String::new();
            for block in blocks {
                let block_type = block.get("type").and_then(Value::as_str).unwrap_or("");
                match block_type {
                    "text" => {
                        let text = block.get("text").and_then(Value::as_str).unwrap_or("");
                        out.push_str(&format!("assistant:\n{}\n", indent(text)));
                    }
                    "thinking" => {
                        let text = block.get("thinking").and_then(Value::as_str).unwrap_or("");
                        out.push_str(&format!("thinking:\n{}\n", indent(text)));
                    }
                    "tool_use" => {
                        let name = block.get("name").and_then(Value::as_str).unwrap_or("?");
                        let input = block
                            .get("input")
                            .map(|v| serde_json::to_string(v).unwrap_or_default())
                            .unwrap_or_default();
                        out.push_str(&format!("tool_use: {} {}\n", name, truncate(&input, 400)));
                    }
                    _ => {}
                }
            }
            if out.is_empty() {
                None
            } else {
                Some(out.trim_end().to_string())
            }
        }
        "user" => {
            let blocks = data
                .and_then(|d| d.get("message"))
                .and_then(|m| m.get("content"))
                .and_then(Value::as_array)?;
            let mut out = String::new();
            for block in blocks {
                let block_type = block.get("type").and_then(Value::as_str).unwrap_or("");
                if block_type == "tool_result" {
                    let content = block.get("content");
                    let content_str = match content {
                        Some(Value::String(s)) => s.clone(),
                        Some(v) => serde_json::to_string(v).unwrap_or_default(),
                        None => String::new(),
                    };
                    out.push_str(&format!(
                        "tool_result:\n{}\n",
                        indent(&truncate(&content_str, 1500))
                    ));
                }
            }
            if out.is_empty() {
                None
            } else {
                Some(out.trim_end().to_string())
            }
        }
        "result" => {
            let num_turns = data
                .and_then(|d| d.get("num_turns"))
                .and_then(Value::as_i64)
                .unwrap_or(0);
            let duration_ms = data
                .and_then(|d| d.get("duration_ms"))
                .and_then(Value::as_i64)
                .unwrap_or(0);
            let cost = data
                .and_then(|d| d.get("total_cost_usd"))
                .and_then(Value::as_f64)
                .unwrap_or(0.0);
            Some(format!(
                "result: turns={} duration={:.1}s cost=${:.4}",
                num_turns,
                (duration_ms as f64) / 1000.0,
                cost
            ))
        }
        "error" => {
            let summary = data
                .map(|v| serde_json::to_string(v).unwrap_or_default())
                .unwrap_or_default();
            Some(format!("error: {}", truncate(&summary, 500)))
        }
        // Skip system init/hook chatter and rate_limit_event noise.
        _ => None,
    }
}

fn indent(text: &str) -> String {
    text.lines()
        .map(|l| format!("    {}", l))
        .collect::<Vec<_>>()
        .join("\n")
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let cut: String = s.chars().take(max).collect();
        format!("{}… ({} chars total)", cut, s.chars().count())
    }
}

fn short_ts(ts: &str) -> &str {
    // ISO timestamps look like "2026-04-13T18:40:54.880Z" — trim to HH:MM:SS.
    if ts.len() >= 19 {
        &ts[11..19]
    } else {
        ts
    }
}
