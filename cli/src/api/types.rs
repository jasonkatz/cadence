use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub email: String,
    pub name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub token_type: String,
    pub expires_in: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TokenErrorResponse {
    pub error: String,
    pub error_description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Settings {
    pub github_token: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SettingsInput {
    pub github_token: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Workflow {
    pub id: String,
    pub task: String,
    pub repo: String,
    pub branch: String,
    pub requirements: Option<String>,
    pub proposal: Option<String>,
    pub pr_number: Option<i64>,
    pub status: String,
    pub iteration: i64,
    pub max_iters: i64,
    pub error: Option<String>,
    pub created_by: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkflowCreateInput {
    pub task: String,
    pub repo: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requirements: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_iters: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkflowListItem {
    pub id: String,
    pub task: String,
    pub repo: String,
    pub branch: String,
    pub status: String,
    pub iteration: i64,
    pub pr_number: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkflowList {
    pub workflows: Vec<WorkflowListItem>,
    pub total: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Step {
    pub id: String,
    pub workflow_id: String,
    pub iteration: i64,
    #[serde(rename = "type")]
    pub step_type: String,
    pub status: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub detail: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkflowDetail {
    #[serde(flatten)]
    pub workflow: Workflow,
    pub steps: Vec<Step>,
}
