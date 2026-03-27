use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::config::CadenceConfig;
use crate::pipeline::stage::Stage;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowState {
    pub id: String,
    pub task: String,
    pub repo: String,
    pub repo_dir: PathBuf,
    pub branch: String,
    pub stage: Stage,
    pub iteration: u32,
    pub max_iters: u32,
    pub pr_number: Option<u64>,
    pub started_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub sessions: SessionIds,
    pub history: Vec<StageTransition>,
    pub regression_context: Option<String>,
    pub requirements: Option<String>,
    pub error: Option<String>,
    pub pid: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionIds {
    pub dev: String,
    pub review: String,
    pub e2e: String,
    pub e2e_verify: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StageTransition {
    pub from: Stage,
    pub to: Stage,
    pub at: DateTime<Utc>,
    pub detail: String,
}

impl WorkflowState {
    pub fn file_path(&self) -> Result<PathBuf> {
        let dir = CadenceConfig::workflows_dir()?;
        Ok(dir.join(format!("{}.json", self.id)))
    }

    pub fn save(&mut self) -> Result<()> {
        self.updated_at = Utc::now();
        let path = self.file_path()?;
        let tmp = path.with_extension("json.tmp");
        let content = serde_json::to_string_pretty(self)?;
        fs::write(&tmp, &content)
            .with_context(|| format!("writing state to {}", tmp.display()))?;
        fs::rename(&tmp, &path)
            .with_context(|| format!("renaming {} to {}", tmp.display(), path.display()))?;
        Ok(())
    }

    pub fn load(id: &str) -> Result<Self> {
        let dir = CadenceConfig::workflows_dir()?;
        let path = dir.join(format!("{id}.json"));
        let content = fs::read_to_string(&path)
            .with_context(|| format!("reading workflow state from {}", path.display()))?;
        let state: Self =
            serde_json::from_str(&content).with_context(|| "parsing workflow state")?;
        Ok(state)
    }

    pub fn list_all() -> Result<Vec<Self>> {
        let dir = CadenceConfig::workflows_dir()?;
        let mut workflows = Vec::new();
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "json") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(state) = serde_json::from_str::<Self>(&content) {
                        workflows.push(state);
                    }
                }
            }
        }
        workflows.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(workflows)
    }

    pub fn transition(&mut self, to: Stage, detail: &str) {
        let transition = StageTransition {
            from: self.stage,
            to,
            at: Utc::now(),
            detail: detail.to_string(),
        };
        self.history.push(transition);
        self.stage = to;
    }

    pub fn regress(&mut self, to: Stage, context: String) {
        self.iteration += 1;
        self.regression_context = Some(context);

        // Regenerate session IDs for agents that always use send() (not
        // resume_send) so the claude CLI doesn't reject a reused session.
        self.sessions.review = uuid::Uuid::new_v4().to_string();
        self.sessions.e2e = uuid::Uuid::new_v4().to_string();
        self.sessions.e2e_verify = uuid::Uuid::new_v4().to_string();

        let detail = format!("Regression (iter {})", self.iteration);
        self.transition(to, &detail);
    }

    pub fn elapsed(&self) -> chrono::Duration {
        Utc::now() - self.started_at
    }

    pub fn elapsed_display(&self) -> String {
        let secs = self.elapsed().num_seconds();
        let mins = secs / 60;
        let remaining_secs = secs % 60;
        format!("{mins}m {remaining_secs}s")
    }

    #[allow(dead_code)]
    pub fn delete(id: &str) -> Result<()> {
        let dir = CadenceConfig::workflows_dir()?;
        let path = dir.join(format!("{id}.json"));
        if path.exists() {
            fs::remove_file(&path)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_test_state(id: &str) -> WorkflowState {
        let now = Utc::now();
        WorkflowState {
            id: id.to_string(),
            task: "test task".to_string(),
            repo: "owner/repo".to_string(),
            repo_dir: PathBuf::from("/tmp/test-repo"),
            branch: "dev/test".to_string(),
            stage: Stage::Pending,
            iteration: 0,
            max_iters: 8,
            pr_number: None,
            started_at: now,
            updated_at: now,
            sessions: SessionIds {
                dev: "dev-session".to_string(),
                review: "review-session".to_string(),
                e2e: "e2e-session".to_string(),
                e2e_verify: "verify-session".to_string(),
            },
            history: vec![],
            regression_context: None,
            requirements: None,
            error: None,
            pid: None,
        }
    }

    #[test]
    fn transition_records_history() {
        let mut state = make_test_state("test-transition");
        assert_eq!(state.history.len(), 0);

        state.transition(Stage::Dev, "starting dev");
        assert_eq!(state.stage, Stage::Dev);
        assert_eq!(state.history.len(), 1);
        assert_eq!(state.history[0].from, Stage::Pending);
        assert_eq!(state.history[0].to, Stage::Dev);
        assert_eq!(state.history[0].detail, "starting dev");

        state.transition(Stage::InReview, "moving to review");
        assert_eq!(state.stage, Stage::InReview);
        assert_eq!(state.history.len(), 2);
    }

    #[test]
    fn regress_increments_iteration() {
        let mut state = make_test_state("test-regress");
        state.stage = Stage::InReview;
        state.iteration = 1;

        state.regress(Stage::Dev, "review comments".to_string());

        assert_eq!(state.stage, Stage::Dev);
        assert_eq!(state.iteration, 2);
        assert_eq!(
            state.regression_context.as_deref(),
            Some("review comments")
        );
        assert_eq!(state.history.len(), 1);
    }

    #[test]
    fn save_and_load_roundtrip() {
        let mut state = make_test_state("test-roundtrip");
        state.pr_number = Some(42);
        state.transition(Stage::Dev, "started");
        state.save().unwrap();

        let loaded = WorkflowState::load("test-roundtrip").unwrap();
        assert_eq!(loaded.id, "test-roundtrip");
        assert_eq!(loaded.stage, Stage::Dev);
        assert_eq!(loaded.pr_number, Some(42));
        assert_eq!(loaded.history.len(), 1);

        // Cleanup
        WorkflowState::delete("test-roundtrip").unwrap();
    }

    #[test]
    fn list_all_returns_saved_workflows() {
        let mut s1 = make_test_state("test-list-1");
        let mut s2 = make_test_state("test-list-2");
        s1.save().unwrap();
        s2.stage = Stage::Complete;
        s2.save().unwrap();

        let all = WorkflowState::list_all().unwrap();
        let ids: Vec<&str> = all.iter().map(|w| w.id.as_str()).collect();
        assert!(ids.contains(&"test-list-1"));
        assert!(ids.contains(&"test-list-2"));

        // Cleanup
        WorkflowState::delete("test-list-1").unwrap();
        WorkflowState::delete("test-list-2").unwrap();
    }

    #[test]
    fn serialization_format() {
        let state = make_test_state("test-serde");
        let json = serde_json::to_string_pretty(&state).unwrap();
        assert!(json.contains("\"pending\""));
        assert!(json.contains("\"test task\""));
        assert!(json.contains("\"owner/repo\""));
    }
}
