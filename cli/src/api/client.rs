use reqwest::Client;
use serde::de::DeserializeOwned;
use serde::Serialize;

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

    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> anyhow::Result<T> {
        let response = self
            .client
            .get(format!("{}{}", self.base_url, path))
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
        let response = self
            .client
            .post(format!("{}{}", self.base_url, path))
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
        let response = self
            .client
            .post(format!("{}{}", self.base_url, path))
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

    /// Stream SSE events from a path, calling the handler for each event.
    /// Returns when the stream ends or the handler returns false.
    pub async fn stream_sse<F>(
        &self,
        path: &str,
        mut handler: F,
    ) -> anyhow::Result<()>
    where
        F: FnMut(&str, &str) -> bool, // (event_type, data) -> continue?
    {
        let response = self
            .client
            .get(format!("{}{}", self.base_url, path))
            .header("Accept", "text/event-stream")
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            anyhow::bail!("Request failed ({}): {}", status, text);
        }

        let stream = response.bytes_stream();
        use futures_util::StreamExt;
        use tokio::io::AsyncBufReadExt;
        let reader = tokio_util::io::StreamReader::new(
            stream.map(|r| r.map_err(std::io::Error::other)),
        );
        let mut lines = reader.lines();

        let mut current_event = String::new();
        let mut current_data = String::new();

        while let Some(line) = lines.next_line().await? {
            if let Some(event) = line.strip_prefix("event: ") {
                current_event = event.to_string();
            } else if let Some(data) = line.strip_prefix("data: ") {
                current_data = data.to_string();
            } else if line.is_empty() && !current_event.is_empty() {
                let should_continue = handler(&current_event, &current_data);
                current_event.clear();
                current_data.clear();
                if !should_continue {
                    break;
                }
            }
        }

        Ok(())
    }

    pub async fn put_json<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> anyhow::Result<T> {
        let response = self
            .client
            .put(format!("{}{}", self.base_url, path))
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
