use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::flair::Personality;

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct CadenceConfig {
    pub notify: Option<NotifyConfig>,
    pub defaults: DefaultsConfig,
    pub agents: AgentsConfig,
    pub timeouts: TimeoutConfig,
    pub fun: FunConfig,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct NotifyConfig {
    pub url: String,
    pub body_template: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(default)]
pub struct DefaultsConfig {
    pub max_iters: u32,
    pub model: String,
    pub permission_mode: String,
    pub git_push: bool,
}

impl Default for DefaultsConfig {
    fn default() -> Self {
        Self {
            max_iters: 8,
            model: "sonnet".to_string(),
            permission_mode: "bypassPermissions".to_string(),
            git_push: true,
        }
    }
}

#[derive(Debug, Deserialize, Serialize, Default)]
#[serde(default)]
pub struct AgentsConfig {
    pub dev: AgentConfig,
    pub review: AgentConfig,
    pub e2e: AgentConfig,
}

#[derive(Debug, Deserialize, Serialize, Default, Clone)]
#[serde(default)]
pub struct AgentConfig {
    pub model: Option<String>,
    pub budget_usd: Option<f64>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(default)]
pub struct TimeoutConfig {
    pub agent_secs: u64,
    pub e2e_secs: u64,
    pub gha_secs: u64,
    pub gha_poll_secs: u64,
}

impl Default for TimeoutConfig {
    fn default() -> Self {
        Self {
            agent_secs: 3600,
            e2e_secs: 900,
            gha_secs: 600,
            gha_poll_secs: 30,
        }
    }
}

/// Configuration for fun and motivational features.
#[derive(Debug, Deserialize, Serialize)]
#[serde(default)]
pub struct FunConfig {
    /// Team personality affecting status message tone.
    pub personality: Personality,
    /// Enable ASCII animations (progress bars, confetti, sad trombone).
    pub flair: bool,
    /// Enable iteration count prediction before pipeline starts.
    pub betting: bool,
}

impl Default for FunConfig {
    fn default() -> Self {
        Self {
            personality: Personality::None,
            flair: true,
            betting: true,
        }
    }
}

impl CadenceConfig {
    pub fn load() -> Result<Self> {
        let path = Self::path()?;
        if !path.exists() {
            return Ok(Self::default());
        }
        let content = fs::read_to_string(&path)
            .with_context(|| format!("reading config from {}", path.display()))?;
        let config: CadenceConfig =
            toml::from_str(&content).with_context(|| "parsing config TOML")?;
        Ok(config)
    }

    pub fn save_default() -> Result<PathBuf> {
        let path = Self::path()?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let config = Self::default();
        let content = toml::to_string_pretty(&config)?;
        fs::write(&path, &content)?;
        Ok(path)
    }

    pub fn path() -> Result<PathBuf> {
        let config_dir =
            dirs::config_dir().ok_or_else(|| anyhow::anyhow!("could not find config directory"))?;
        Ok(config_dir.join("cadence").join("config.toml"))
    }

    pub fn workflows_dir() -> Result<PathBuf> {
        let config_dir =
            dirs::config_dir().ok_or_else(|| anyhow::anyhow!("could not find config directory"))?;
        let dir = config_dir.join("cadence").join("workflows");
        fs::create_dir_all(&dir)?;
        Ok(dir)
    }

    pub fn model_for_role(&self, role: &str) -> String {
        let agent_model = match role {
            "dev" => self.agents.dev.model.as_deref(),
            "review" => self.agents.review.model.as_deref(),
            "e2e" | "e2e_verify" => self.agents.e2e.model.as_deref(),
            _ => None,
        };
        agent_model
            .unwrap_or(&self.defaults.model)
            .to_string()
    }

    pub fn budget_for_role(&self, role: &str) -> Option<f64> {
        match role {
            "dev" => self.agents.dev.budget_usd,
            "review" => self.agents.review.budget_usd,
            "e2e" | "e2e_verify" => self.agents.e2e.budget_usd,
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_values() {
        let config = CadenceConfig::default();
        assert_eq!(config.defaults.max_iters, 8);
        assert_eq!(config.defaults.model, "sonnet");
        assert_eq!(config.defaults.permission_mode, "bypassPermissions");
        assert!(config.defaults.git_push);
        assert_eq!(config.timeouts.agent_secs, 3600);
        assert_eq!(config.timeouts.e2e_secs, 900);
        assert!(config.notify.is_none());
    }

    #[test]
    fn default_fun_config() {
        let config = CadenceConfig::default();
        assert_eq!(config.fun.personality, Personality::None);
        assert!(config.fun.flair);
        assert!(config.fun.betting);
    }

    #[test]
    fn parse_full_toml() {
        let toml_str = r#"
[notify]
url = "https://example.com/webhook"
body_template = '{"text": "{{message}}"}'

[defaults]
max_iters = 5
model = "opus"
permission_mode = "auto"
git_push = false

[agents.dev]
model = "opus"
budget_usd = 10.0

[agents.review]
budget_usd = 3.0

[agents.e2e]
model = "haiku"

[timeouts]
agent_secs = 1800
e2e_secs = 600
gha_secs = 300
gha_poll_secs = 15

[fun]
personality = "pirate"
flair = false
betting = false
"#;
        let config: CadenceConfig = toml::from_str(toml_str).unwrap();
        assert_eq!(config.defaults.max_iters, 5);
        assert_eq!(config.defaults.model, "opus");
        assert!(!config.defaults.git_push);
        assert_eq!(config.agents.dev.model.as_deref(), Some("opus"));
        assert_eq!(config.agents.dev.budget_usd, Some(10.0));
        assert_eq!(config.agents.e2e.model.as_deref(), Some("haiku"));
        assert_eq!(config.timeouts.gha_poll_secs, 15);
        assert!(config.notify.is_some());
        assert_eq!(config.fun.personality, Personality::Pirate);
        assert!(!config.fun.flair);
        assert!(!config.fun.betting);
    }

    #[test]
    fn parse_minimal_toml() {
        let toml_str = "";
        let config: CadenceConfig = toml::from_str(toml_str).unwrap();
        assert_eq!(config.defaults.max_iters, 8);
        assert_eq!(config.defaults.model, "sonnet");
    }

    #[test]
    fn model_for_role_falls_back_to_default() {
        let mut config = CadenceConfig::default();
        config.defaults.model = "opus".to_string();
        config.agents.dev.model = Some("sonnet".to_string());

        assert_eq!(config.model_for_role("dev"), "sonnet");
        assert_eq!(config.model_for_role("review"), "opus");
        assert_eq!(config.model_for_role("e2e"), "opus");
        assert_eq!(config.model_for_role("unknown"), "opus");
    }
}
