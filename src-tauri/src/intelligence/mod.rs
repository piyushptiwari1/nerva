//! Local-LLM bridge. Talks to an Ollama sidecar over HTTP.
//!
//! We deliberately don't link llama.cpp directly — Ollama is the de-facto
//! 2026 standard for managing local models on Linux/Mac/Windows, ships
//! pre-quantized weights, and gives us a stable JSON streaming API. If
//! Ollama isn't running, every call here surfaces a graceful "unavailable"
//! status so the rest of Nerva keeps working.
//!
//! Streaming protocol: Ollama's `/api/chat` (when `stream=true`) returns
//! newline-delimited JSON, one object per line, terminating with `"done": true`.

use crate::error::{NervaError, Result};
use futures_util::StreamExt;
use parking_lot::{Mutex, RwLock};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

const DEFAULT_ENDPOINT: &str = "http://localhost:11434";
const DEFAULT_MODEL: &str = "llama3.2:3b";

#[derive(Debug, Clone)]
pub struct OllamaConfig {
    pub endpoint: String,
    pub model: String,
}

impl OllamaConfig {
    pub fn from_env() -> Self {
        Self {
            endpoint: std::env::var("NERVA_OLLAMA_URL")
                .unwrap_or_else(|_| DEFAULT_ENDPOINT.to_string()),
            model: std::env::var("NERVA_OLLAMA_MODEL")
                .unwrap_or_else(|_| DEFAULT_MODEL.to_string()),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct AiHealth {
    pub available: bool,
    pub endpoint: String,
    pub model: String,
    pub installed_models: Vec<String>,
    /// Populated when `available == false` — surfaces the reason in the UI.
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String, // "system" | "user" | "assistant"
    pub content: String,
}

pub struct OllamaClient {
    cfg: RwLock<OllamaConfig>,
    http: reqwest::Client,
    /// Active in-flight requests, keyed by frontend-supplied request_id. The
    /// flag is flipped to `true` when the frontend invokes `ai_cancel`; the
    /// streaming loop polls it after every chunk and bails out cleanly.
    cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl OllamaClient {
    pub fn new(cfg: OllamaConfig) -> Self {
        let http = reqwest::Client::builder()
            // Generous timeouts: local model load can take a moment on first invoke.
            .timeout(std::time::Duration::from_secs(120))
            .connect_timeout(std::time::Duration::from_secs(2))
            .build()
            .expect("reqwest client build");
        Self {
            cfg: RwLock::new(cfg),
            http,
            cancels: Mutex::new(HashMap::new()),
        }
    }

    pub fn snapshot(&self) -> OllamaConfig { self.cfg.read().clone() }

    /// Update the active model. Persisted by the caller via the meta-table.
    pub fn set_model(&self, model: &str) {
        self.cfg.write().model = model.to_string();
    }

    /// Probe `/api/tags` to confirm the sidecar is reachable and report the
    /// list of locally-installed models.
    pub async fn health(&self) -> AiHealth {
        let cfg = self.snapshot();
        let url = format!("{}/api/tags", cfg.endpoint.trim_end_matches('/'));
        match self.http.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => {
                #[derive(Deserialize)]
                struct TagsResp { models: Vec<TagModel> }
                #[derive(Deserialize)]
                struct TagModel { name: String }
                let body: TagsResp = resp.json().await.unwrap_or(TagsResp { models: vec![] });
                let installed: Vec<String> = body.models.into_iter().map(|m| m.name).collect();
                AiHealth {
                    available: true,
                    endpoint: cfg.endpoint,
                    model: cfg.model,
                    installed_models: installed,
                    error: None,
                }
            }
            Ok(resp) => AiHealth {
                available: false,
                endpoint: cfg.endpoint,
                model: cfg.model,
                installed_models: vec![],
                error: Some(format!("HTTP {}", resp.status())),
            },
            Err(e) => AiHealth {
                available: false,
                endpoint: cfg.endpoint,
                model: cfg.model,
                installed_models: vec![],
                error: Some(simple_err(&e)),
            },
        }
    }

    /// Cancel an in-flight stream by request id. Returns whether a matching
    /// in-flight request was found. Safe to call for unknown ids.
    pub fn cancel(&self, request_id: &str) -> bool {
        if let Some(flag) = self.cancels.lock().get(request_id) {
            flag.store(true, Ordering::SeqCst);
            true
        } else {
            false
        }
    }

    /// Stream a chat completion. `on_token` is called with each delta as it
    /// arrives; the assembled output, the model used, and a `cancelled` flag
    /// are returned. The closure runs on the same task that drives the HTTP
    /// body, so it must be cheap (in practice we just emit a Tauri event).
    ///
    /// `request_id` lets callers cancel the in-flight stream via
    /// [`Self::cancel`]. The cancel flag is registered before the request is
    /// fired and deregistered on every exit path (success, error, cancel) via
    /// the RAII [`CancelGuard`].
    pub async fn chat_stream<F>(
        &self,
        request_id: &str,
        messages: Vec<ChatMessage>,
        mut on_token: F,
    ) -> Result<ChatOutcome>
    where
        F: FnMut(&str),
    {
        let cfg = self.snapshot();
        let url = format!("{}/api/chat", cfg.endpoint.trim_end_matches('/'));
        let body = serde_json::json!({
            "model": cfg.model,
            "messages": messages,
            "stream": true,
            // Sensible defaults; we can lift these into UI later.
            "options": { "temperature": 0.4, "num_ctx": 4096 },
        });

        // Register cancel flag for this request.
        let flag = Arc::new(AtomicBool::new(false));
        self.cancels.lock().insert(request_id.to_string(), flag.clone());
        let _guard = CancelGuard { client: self, id: request_id };

        let resp = self
            .http
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| NervaError::Invalid(format!("ollama request: {}", simple_err(&e))))?;

        if !resp.status().is_success() {
            return Err(NervaError::Invalid(format!(
                "ollama returned HTTP {}",
                resp.status()
            )));
        }

        let mut stream = resp.bytes_stream();
        let mut buf: Vec<u8> = Vec::with_capacity(4096);
        let mut out = String::new();

        while let Some(chunk) = stream.next().await {
            if flag.load(Ordering::SeqCst) {
                // Frontend requested cancel — stop reading; dropping the body
                // here closes the TCP stream, which Ollama treats as a normal
                // client disconnect and aborts generation server-side.
                return Ok(ChatOutcome { text: out, cancelled: true, model: cfg.model });
            }
            let chunk = chunk
                .map_err(|e| NervaError::Invalid(format!("ollama stream: {}", simple_err(&e))))?;
            buf.extend_from_slice(&chunk);
            // Process complete lines.
            while let Some(nl) = buf.iter().position(|&b| b == b'\n') {
                let line = buf.drain(..=nl).collect::<Vec<u8>>();
                let trimmed = std::str::from_utf8(&line)
                    .unwrap_or("")
                    .trim();
                if trimmed.is_empty() { continue; }
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
                    if let Some(c) = v.get("message").and_then(|m| m.get("content")).and_then(|c| c.as_str()) {
                        if !c.is_empty() {
                            on_token(c);
                            out.push_str(c);
                        }
                    }
                    if v.get("done").and_then(|b| b.as_bool()).unwrap_or(false) {
                        return Ok(ChatOutcome { text: out, cancelled: false, model: cfg.model });
                    }
                }
            }
        }
        Ok(ChatOutcome { text: out, cancelled: false, model: cfg.model })
    }
}

/// Final result of a streamed chat. `cancelled` lets the caller decide
/// whether to persist an exchange event (we skip persistence on cancel).
#[derive(Debug)]
pub struct ChatOutcome {
    pub text: String,
    pub cancelled: bool,
    pub model: String,
}

/// Ensures the cancel-flag entry is removed when the streaming function
/// returns by any path (success, error, panic, early cancel).
struct CancelGuard<'a> {
    client: &'a OllamaClient,
    id: &'a str,
}

impl Drop for CancelGuard<'_> {
    fn drop(&mut self) {
        self.client.cancels.lock().remove(self.id);
    }
}

fn simple_err(e: &reqwest::Error) -> String {
    if e.is_connect() {
        "could not connect to ollama (is it running on localhost:11434?)".to_string()
    } else if e.is_timeout() {
        "ollama request timed out".to_string()
    } else {
        e.to_string()
    }
}
