use reqwest::Client;
use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::config::Credentials;

pub struct ApiClient {
    client: Client,
    base_url: String,
}

impl ApiClient {
    pub fn new(base_url: &str) -> Self {
        Self {
            client: Client::new(),
            base_url: base_url.to_string(),
        }
    }

    fn get_token() -> anyhow::Result<String> {
        let creds = Credentials::load()?;
        creds
            .access_token
            .ok_or_else(|| anyhow::anyhow!("Not authenticated. Run 'cadence login' first."))
    }

    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> anyhow::Result<T> {
        let token = Self::get_token()?;

        let response = self
            .client
            .get(format!("{}{}", self.base_url, path))
            .bearer_auth(&token)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            anyhow::bail!("Request failed ({}): {}", status, text);
        }

        Ok(response.json().await?)
    }

    pub async fn post<T: DeserializeOwned>(&self, path: &str) -> anyhow::Result<T> {
        let token = Self::get_token()?;

        let response = self
            .client
            .post(format!("{}{}", self.base_url, path))
            .bearer_auth(&token)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            anyhow::bail!("Request failed ({}): {}", status, text);
        }

        Ok(response.json().await?)
    }

    pub async fn post_json<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> anyhow::Result<T> {
        let token = Self::get_token()?;

        let response = self
            .client
            .post(format!("{}{}", self.base_url, path))
            .bearer_auth(&token)
            .json(body)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            anyhow::bail!("Request failed ({}): {}", status, text);
        }

        Ok(response.json().await?)
    }

    pub async fn put_json<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> anyhow::Result<T> {
        let token = Self::get_token()?;

        let response = self
            .client
            .put(format!("{}{}", self.base_url, path))
            .bearer_auth(&token)
            .json(body)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            anyhow::bail!("Request failed ({}): {}", status, text);
        }

        Ok(response.json().await?)
    }
}
