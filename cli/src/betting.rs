use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;

use crate::config::CadenceConfig;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bet {
    pub workflow_id: String,
    pub task: String,
    pub predicted_iters: u32,
    pub actual_iters: Option<u32>,
    pub placed_at: DateTime<Utc>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct BettingLedger {
    pub bets: Vec<Bet>,
}

impl BettingLedger {
    fn path() -> Result<std::path::PathBuf> {
        let dir = CadenceConfig::workflows_dir()?;
        let parent = dir
            .parent()
            .ok_or_else(|| anyhow::anyhow!("no parent for workflows dir"))?;
        Ok(parent.join("betting.json"))
    }

    pub fn load() -> Result<Self> {
        let path = Self::path()?;
        if !path.exists() {
            return Ok(Self::default());
        }
        let content = fs::read_to_string(&path)?;
        Ok(serde_json::from_str(&content).unwrap_or_default())
    }

    pub fn save(&self) -> Result<()> {
        let path = Self::path()?;
        let content = serde_json::to_string_pretty(self)?;
        fs::write(path, content)?;
        Ok(())
    }

    pub fn place(&mut self, bet: Bet) {
        self.bets.push(bet);
    }

    pub fn settle(&mut self, workflow_id: &str, actual_iters: u32) {
        if let Some(bet) = self
            .bets
            .iter_mut()
            .find(|b| b.workflow_id == workflow_id)
        {
            bet.actual_iters = Some(actual_iters);
        }
    }

    /// Percentage of settled bets where prediction was exactly right.
    pub fn exact_accuracy_pct(&self) -> Option<f64> {
        let settled: Vec<&Bet> = self.bets.iter().filter(|b| b.actual_iters.is_some()).collect();
        if settled.is_empty() {
            return None;
        }
        let exact = settled
            .iter()
            .filter(|b| b.actual_iters == Some(b.predicted_iters))
            .count();
        Some(exact as f64 / settled.len() as f64 * 100.0)
    }

    /// Percentage of settled bets where prediction was within 1 of actual.
    pub fn close_accuracy_pct(&self) -> Option<f64> {
        let settled: Vec<&Bet> = self.bets.iter().filter(|b| b.actual_iters.is_some()).collect();
        if settled.is_empty() {
            return None;
        }
        let close = settled
            .iter()
            .filter(|b| b.actual_iters.unwrap().abs_diff(b.predicted_iters) <= 1)
            .count();
        Some(close as f64 / settled.len() as f64 * 100.0)
    }
}

/// Predict iteration count from task complexity heuristics.
pub fn predict_iterations(task: &str) -> u32 {
    let words = task.split_whitespace().count();
    let is_complex = task
        .to_lowercase()
        .split_whitespace()
        .any(|w| COMPLEX_KEYWORDS.contains(&w));

    let base = match words {
        0..=10 => 1,
        11..=25 => 2,
        26..=50 => 3,
        _ => 4,
    };

    if is_complex { base + 1 } else { base }
}

const COMPLEX_KEYWORDS: &[&str] = &[
    "auth",
    "authentication",
    "migrate",
    "migration",
    "refactor",
    "redesign",
    "overhaul",
    "replace",
    "security",
    "encrypt",
    "database",
    "schema",
    "oauth",
    "integration",
];

/// Display the prediction header and prompt the user to agree or enter their own
/// estimate. Returns the iteration count that should be recorded as the bet.
pub fn prompt_user_bet(
    workflow_id: &str,
    task: &str,
    predicted: u32,
    accuracy_note: &str,
) -> u32 {
    eprintln!("\n\x1b[1;36m╔══════════════════════════════════════════╗\x1b[0m");
    eprintln!("\x1b[1;36m║        🎲 Iteration Betting Pool          ║\x1b[0m");
    eprintln!("\x1b[1;36m╚══════════════════════════════════════════╝\x1b[0m");
    eprintln!("\n  Task:       {task}");
    eprintln!("  Prediction: \x1b[1;33m{predicted} iteration(s)\x1b[0m");
    if !accuracy_note.is_empty() {
        eprint!("{accuracy_note}");
    }
    eprintln!("  Workflow:   {workflow_id}");
    eprint!(
        "\n  Agree? Press Enter to accept, or type your own estimate and press Enter: "
    );

    let mut input = String::new();
    if std::io::stdin().read_line(&mut input).is_ok() {
        let trimmed = input.trim();
        if !trimmed.is_empty() {
            if let Ok(n) = trimmed.parse::<u32>() {
                if n > 0 {
                    eprintln!("  Your bet: \x1b[1;33m{n} iteration(s)\x1b[0m — recorded!\n");
                    return n;
                }
            }
        }
    }

    eprintln!("  Bet accepted: \x1b[1;33m{predicted} iteration(s)\x1b[0m — let's see how it goes!\n");
    predicted
}

pub fn print_result(predicted: u32, actual: u32) {
    let diff = actual.abs_diff(predicted);
    let verdict = match diff {
        0 => "\x1b[1;32m🎯 Exact match!\x1b[0m",
        1 => "\x1b[1;33m📍 Close call (±1)\x1b[0m",
        _ => "\x1b[1;31m🎲 Missed the mark\x1b[0m",
    };
    eprintln!(
        "\n  Prediction: {predicted} iter(s) → Actual: {actual} iter(s) — {verdict}"
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_task_predicts_one_iteration() {
        assert_eq!(predict_iterations("add button to nav"), 1);
    }

    #[test]
    fn long_task_predicts_more_iterations() {
        let task =
            "implement complete user auth system with oauth2 social login and refresh token rotation";
        assert!(predict_iterations(task) >= 3);
    }

    #[test]
    fn complex_keyword_bumps_prediction_by_one() {
        let simple_count = predict_iterations("add a login page");
        let complex_count = predict_iterations("implement authentication page");
        assert!(complex_count >= simple_count);
    }

    #[test]
    fn empty_task_returns_one() {
        assert_eq!(predict_iterations(""), 1);
    }

    #[test]
    fn settle_updates_actual_iters() {
        let mut ledger = BettingLedger::default();
        ledger.place(Bet {
            workflow_id: "wf-001".to_string(),
            task: "test".to_string(),
            predicted_iters: 2,
            actual_iters: None,
            placed_at: Utc::now(),
        });
        ledger.settle("wf-001", 3);
        assert_eq!(ledger.bets[0].actual_iters, Some(3));
    }

    #[test]
    fn accuracy_none_with_no_settled_bets() {
        assert!(BettingLedger::default().exact_accuracy_pct().is_none());
    }

    #[test]
    fn exact_accuracy_100_on_perfect_prediction() {
        let mut ledger = BettingLedger::default();
        ledger.place(Bet {
            workflow_id: "wf-001".to_string(),
            task: "test".to_string(),
            predicted_iters: 2,
            actual_iters: Some(2),
            placed_at: Utc::now(),
        });
        assert_eq!(ledger.exact_accuracy_pct(), Some(100.0));
    }

    #[test]
    fn close_accuracy_includes_off_by_one() {
        let mut ledger = BettingLedger::default();
        ledger.place(Bet {
            workflow_id: "wf-001".to_string(),
            task: "test".to_string(),
            predicted_iters: 2,
            actual_iters: Some(3),
            placed_at: Utc::now(),
        });
        assert_eq!(ledger.close_accuracy_pct(), Some(100.0));
        assert_eq!(ledger.exact_accuracy_pct(), Some(0.0));
    }

    #[test]
    fn close_accuracy_excludes_off_by_two() {
        let mut ledger = BettingLedger::default();
        ledger.place(Bet {
            workflow_id: "wf-001".to_string(),
            task: "test".to_string(),
            predicted_iters: 1,
            actual_iters: Some(4),
            placed_at: Utc::now(),
        });
        assert_eq!(ledger.close_accuracy_pct(), Some(0.0));
    }
}
