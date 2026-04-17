use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::body::Incoming;
use hyper::Request;
use hyper_util::client::legacy::Client;
use hyperlocal::{UnixClientExt, Uri as UnixUri};
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::path::PathBuf;

/// Transport configuration for the API client.
pub enum Transport {
    /// Unix socket at the given path (default for local daemon).
    Unix(PathBuf),
    /// TCP connection to a remote URL.
    Remote(String),
}

pub struct ApiClient {
    transport: Transport,
}

impl ApiClient {
    pub fn new_unix(socket_path: PathBuf) -> Self {
        Self {
            transport: Transport::Unix(socket_path),
        }
    }

    pub fn new_remote(base_url: &str) -> Self {
        Self {
            transport: Transport::Remote(base_url.to_string()),
        }
    }

    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> anyhow::Result<T> {
        let body = self.request("GET", path, None).await?;
        Ok(serde_json::from_slice(&body)?)
    }

    pub async fn get_text(&self, path: &str) -> anyhow::Result<String> {
        let body = self.request("GET", path, None).await?;
        Ok(String::from_utf8_lossy(&body).into_owned())
    }

    pub async fn post<T: DeserializeOwned>(&self, path: &str) -> anyhow::Result<T> {
        let body = self.request("POST", path, None).await?;
        Ok(serde_json::from_slice(&body)?)
    }

    pub async fn post_json<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> anyhow::Result<T> {
        let json = serde_json::to_vec(body)?;
        let resp = self.request("POST", path, Some(json)).await?;
        Ok(serde_json::from_slice(&resp)?)
    }

    pub async fn put_json<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> anyhow::Result<T> {
        let json = serde_json::to_vec(body)?;
        let resp = self.request("PUT", path, Some(json)).await?;
        Ok(serde_json::from_slice(&resp)?)
    }

    /// Stream SSE events from a path, calling the handler for each event.
    /// Returns when the stream ends or the handler returns false.
    pub async fn stream_sse<F>(&self, path: &str, mut handler: F) -> anyhow::Result<()>
    where
        F: FnMut(&str, &str) -> bool,
    {
        match &self.transport {
            Transport::Unix(socket_path) => {
                let client = Client::unix();
                let uri = UnixUri::new(socket_path, path);
                let req = Request::builder()
                    .method("GET")
                    .uri(uri)
                    .header("Accept", "text/event-stream")
                    .body(Full::<Bytes>::new(Bytes::new()))?;

                let response = client.request(req).await?;
                if !response.status().is_success() {
                    let status = response.status();
                    let body = response.into_body().collect().await?.to_bytes();
                    let text = String::from_utf8_lossy(&body);
                    anyhow::bail!("Request failed ({}): {}", status, text);
                }

                self.parse_sse_stream(response.into_body(), &mut handler)
                    .await
            }
            Transport::Remote(base_url) => {
                // Fall back to reqwest for remote TCP connections
                let client = reqwest::Client::new();
                let response = client
                    .get(format!("{}{}", base_url, path))
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
        }
    }

    /// Check if the daemon is reachable by attempting a GET /health request.
    pub async fn is_reachable(&self) -> bool {
        self.request("GET", "/health", None).await.is_ok()
    }

    // --- Private helpers ---

    async fn request(
        &self,
        method: &str,
        path: &str,
        body: Option<Vec<u8>>,
    ) -> anyhow::Result<Bytes> {
        match &self.transport {
            Transport::Unix(socket_path) => {
                self.unix_request(socket_path, method, path, body).await
            }
            Transport::Remote(base_url) => {
                self.tcp_request(base_url, method, path, body).await
            }
        }
    }

    async fn unix_request(
        &self,
        socket_path: &PathBuf,
        method: &str,
        path: &str,
        body: Option<Vec<u8>>,
    ) -> anyhow::Result<Bytes> {
        let client = Client::unix();
        let uri = UnixUri::new(socket_path, path);

        let mut builder = Request::builder().method(method).uri(uri);
        if body.is_some() {
            builder = builder.header("Content-Type", "application/json");
        }

        let req_body = match body {
            Some(b) => Full::new(Bytes::from(b)),
            None => Full::new(Bytes::new()),
        };

        let req = builder.body(req_body)?;
        let response = client.request(req).await.map_err(|e| {
            anyhow::anyhow!("Failed to connect to daemon: {}", e)
        })?;

        let status = response.status();
        let resp_body = response.into_body().collect().await?.to_bytes();

        if !status.is_success() {
            let text = String::from_utf8_lossy(&resp_body);
            anyhow::bail!("Request failed ({}): {}", status, text);
        }

        Ok(resp_body)
    }

    async fn tcp_request(
        &self,
        base_url: &str,
        method: &str,
        path: &str,
        body: Option<Vec<u8>>,
    ) -> anyhow::Result<Bytes> {
        let client = reqwest::Client::new();
        let url = format!("{}{}", base_url, path);

        let req = match method {
            "GET" => client.get(&url),
            "POST" => {
                let r = client.post(&url);
                if let Some(ref b) = body {
                    r.header("Content-Type", "application/json")
                        .body(b.clone())
                } else {
                    r
                }
            }
            "PUT" => {
                let r = client.put(&url);
                if let Some(ref b) = body {
                    r.header("Content-Type", "application/json")
                        .body(b.clone())
                } else {
                    r
                }
            }
            _ => anyhow::bail!("Unsupported method: {}", method),
        };

        let response = req.send().await?;
        let status = response.status();
        let resp_body = response.bytes().await?;

        if !status.is_success() {
            let text = String::from_utf8_lossy(&resp_body);
            anyhow::bail!("Request failed ({}): {}", status, text);
        }

        Ok(resp_body)
    }

    async fn parse_sse_stream<F>(
        &self,
        body: Incoming,
        handler: &mut F,
    ) -> anyhow::Result<()>
    where
        F: FnMut(&str, &str) -> bool,
    {
        // Collect the full body into bytes chunks and parse SSE lines.
        // We use BodyExt::frame() in a loop, accumulating text and splitting on newlines.
        let mut body = body;
        let mut buffer = String::new();
        let mut current_event = String::new();
        let mut current_data = String::new();

        loop {
            match body.frame().await {
                Some(Ok(frame)) => {
                    if let Ok(data) = frame.into_data() {
                        buffer.push_str(&String::from_utf8_lossy(&data));

                        // Process complete lines
                        while let Some(newline_pos) = buffer.find('\n') {
                            let line = buffer[..newline_pos].trim_end_matches('\r').to_string();
                            buffer = buffer[newline_pos + 1..].to_string();

                            if let Some(event) = line.strip_prefix("event: ") {
                                current_event = event.to_string();
                            } else if let Some(data) = line.strip_prefix("data: ") {
                                current_data = data.to_string();
                            } else if line.is_empty() && !current_event.is_empty() {
                                let should_continue = handler(&current_event, &current_data);
                                current_event.clear();
                                current_data.clear();
                                if !should_continue {
                                    return Ok(());
                                }
                            }
                        }
                    }
                }
                Some(Err(e)) => return Err(anyhow::anyhow!("Stream error: {}", e)),
                None => break,
            }
        }

        Ok(())
    }
}
