use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct Credentials {
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub expires_at: Option<i64>,
}

impl Credentials {
    pub fn load() -> anyhow::Result<Self> {
        let path = Self::path()?;
        if !path.exists() {
            return Ok(Self::default());
        }
        let content = fs::read_to_string(&path)?;
        let creds: Credentials = serde_json::from_str(&content)?;
        Ok(creds)
    }

    pub fn save(&self) -> anyhow::Result<()> {
        let path = Self::path()?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let content = serde_json::to_string_pretty(self)?;
        fs::write(&path, content)?;
        Ok(())
    }

    pub fn clear() -> anyhow::Result<()> {
        let path = Self::path()?;
        if path.exists() {
            fs::remove_file(&path)?;
        }
        Ok(())
    }

    fn path() -> anyhow::Result<PathBuf> {
        let config_dir = dirs::config_dir()
            .ok_or_else(|| anyhow::anyhow!("Could not find config directory"))?;
        Ok(config_dir.join("tmpo").join("credentials.json"))
    }

    pub fn is_valid(&self) -> bool {
        if let (Some(_token), Some(expires_at)) = (&self.access_token, self.expires_at) {
            let now = chrono::Utc::now().timestamp();
            expires_at > now
        } else {
            false
        }
    }
}
