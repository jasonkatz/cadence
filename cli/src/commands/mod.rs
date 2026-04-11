pub mod cancel;
pub mod config;
pub mod daemon;
pub mod list;
pub mod logs;
pub mod proposal;
pub mod run;
pub mod status;
pub mod ui;

use crate::api::ApiClient;
use std::path::PathBuf;

pub struct Context {
    /// Path to the Unix socket for daemon communication.
    pub socket_path: PathBuf,
    /// Optional remote URL (overrides Unix socket).
    pub remote_url: Option<String>,
    /// Output structured JSON.
    pub json: bool,
}

impl Context {
    /// Create an API client based on the context's transport configuration.
    pub fn client(&self) -> ApiClient {
        if let Some(ref url) = self.remote_url {
            ApiClient::new_remote(url)
        } else {
            ApiClient::new_unix(self.socket_path.clone())
        }
    }
}
