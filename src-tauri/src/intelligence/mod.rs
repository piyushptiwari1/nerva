//! LLM bridge. Default provider is a local Ollama sidecar; users can also
//! bring their own key for OpenAI, Anthropic, Gemini, OpenRouter or any
//! OpenAI-compatible endpoint (LM Studio, Groq, Together, vLLM…).
//!
//! We deliberately don't link llama.cpp directly — Ollama is the de-facto
//! standard for managing local models on Linux/Mac/Windows, ships
//! pre-quantized weights, and gives us a stable JSON streaming API. If the
//! configured provider isn't reachable, every call here surfaces a graceful
//! "unavailable" status so the rest of Nerva keeps working.
//!
//! Streaming: Ollama returns newline-delimited JSON; every other provider
//! returns Server-Sent Events. Both are line-oriented, so one read loop
//! handles all of them and `parse_stream_line` does the per-provider
//! extraction (pure, unit-tested).
//!
//! Embeddings (semantic note search) always go to Ollama regardless of the
//! chat provider — they're free, local, and the vector cache is keyed to
//! `nomic-embed-text` dimensions.

use crate::error::{NervaError, Result};
use futures_util::StreamExt;
use parking_lot::{Mutex, RwLock};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

const DEFAULT_ENDPOINT: &str = "http://localhost:11434";
const DEFAULT_MODEL: &str = "llama3.2:3b";
/// Embedding model used for semantic note search. `nomic-embed-text` is the
/// Ollama default — 768-dim, ~270 MB, multilingual, free. Users on other
/// models can override via env (`NERVA_EMBED_MODEL`). Mismatched dimensions
/// stored in the cache are silently skipped on read so switching models just
/// triggers a lazy re-embed on next save.
pub const DEFAULT_EMBED_MODEL: &str = "nomic-embed-text";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    #[default]
    Ollama,
    OpenAI,
    Anthropic,
    Gemini,
    OpenRouter,
    /// Any OpenAI-compatible `/v1/chat/completions` server.
    Custom,
}

impl Provider {
    pub fn from_label(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "ollama" => Some(Self::Ollama),
            "openai" => Some(Self::OpenAI),
            "anthropic" => Some(Self::Anthropic),
            "gemini" => Some(Self::Gemini),
            "openrouter" => Some(Self::OpenRouter),
            "custom" => Some(Self::Custom),
            _ => None,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Ollama => "ollama",
            Self::OpenAI => "openai",
            Self::Anthropic => "anthropic",
            Self::Gemini => "gemini",
            Self::OpenRouter => "openrouter",
            Self::Custom => "custom",
        }
    }

    /// Sensible base URL when the user hasn't typed one.
    pub fn default_endpoint(self) -> &'static str {
        match self {
            Self::Ollama => DEFAULT_ENDPOINT,
            Self::OpenAI => "https://api.openai.com/v1",
            Self::Anthropic => "https://api.anthropic.com",
            Self::Gemini => "https://generativelanguage.googleapis.com",
            Self::OpenRouter => "https://openrouter.ai/api/v1",
            Self::Custom => "http://localhost:1234/v1",
        }
    }

    pub fn default_model(self) -> &'static str {
        match self {
            Self::Ollama => DEFAULT_MODEL,
            Self::OpenAI => "gpt-4o-mini",
            Self::Anthropic => "claude-3-5-haiku-latest",
            Self::Gemini => "gemini-2.0-flash",
            Self::OpenRouter => "openai/gpt-4o-mini",
            Self::Custom => "local-model",
        }
    }

    pub fn needs_key(self) -> bool {
        !matches!(self, Self::Ollama | Self::Custom)
    }
}

#[derive(Debug, Clone)]
pub struct OllamaConfig {
    pub provider: Provider,
    pub endpoint: String,
    pub model: String,
    /// Bearer / API key for hosted providers. Device-local only.
    pub api_key: Option<String>,
    /// Where embeddings go, independent of the chat provider.
    pub ollama_endpoint: String,
}

impl OllamaConfig {
    pub fn from_env() -> Self {
        let ollama =
            std::env::var("NERVA_OLLAMA_URL").unwrap_or_else(|_| DEFAULT_ENDPOINT.to_string());
        Self {
            provider: Provider::Ollama,
            endpoint: ollama.clone(),
            model: std::env::var("NERVA_OLLAMA_MODEL")
                .unwrap_or_else(|_| DEFAULT_MODEL.to_string()),
            api_key: None,
            ollama_endpoint: ollama,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct AiHealth {
    pub available: bool,
    pub provider: Provider,
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

/// What one line of a streaming response means.
#[derive(Debug, PartialEq)]
pub enum StreamEvent {
    Delta(String),
    Done,
    Ignore,
}

/// Build the streaming chat request for the configured provider.
/// Returns `(url, extra headers, json body)`. Pure — unit-tested.
pub fn build_chat_request(
    cfg: &OllamaConfig,
    messages: &[ChatMessage],
) -> (String, Vec<(String, String)>, serde_json::Value) {
    let base = cfg.endpoint.trim_end_matches('/');
    let key = cfg.api_key.clone().unwrap_or_default();
    match cfg.provider {
        Provider::Ollama => (
            format!("{base}/api/chat"),
            vec![],
            serde_json::json!({
                "model": cfg.model,
                "messages": messages,
                "stream": true,
                "options": { "temperature": 0.4, "num_ctx": 4096 },
            }),
        ),
        Provider::Anthropic => {
            let system: String = messages
                .iter()
                .filter(|m| m.role == "system")
                .map(|m| m.content.as_str())
                .collect::<Vec<_>>()
                .join("\n\n");
            let turns: Vec<serde_json::Value> = messages
                .iter()
                .filter(|m| m.role != "system")
                .map(|m| serde_json::json!({ "role": m.role, "content": m.content }))
                .collect();
            let mut body = serde_json::json!({
                "model": cfg.model,
                "max_tokens": 1024,
                "temperature": 0.4,
                "messages": turns,
                "stream": true,
            });
            if !system.is_empty() {
                body["system"] = serde_json::Value::String(system);
            }
            (
                format!("{base}/v1/messages"),
                vec![
                    ("x-api-key".into(), key),
                    ("anthropic-version".into(), "2023-06-01".into()),
                ],
                body,
            )
        }
        Provider::Gemini => {
            let system: String = messages
                .iter()
                .filter(|m| m.role == "system")
                .map(|m| m.content.as_str())
                .collect::<Vec<_>>()
                .join("\n\n");
            let contents: Vec<serde_json::Value> = messages
                .iter()
                .filter(|m| m.role != "system")
                .map(|m| {
                    serde_json::json!({
                        "role": if m.role == "assistant" { "model" } else { "user" },
                        "parts": [{ "text": m.content }],
                    })
                })
                .collect();
            let mut body = serde_json::json!({
                "contents": contents,
                "generationConfig": { "temperature": 0.4 },
            });
            if !system.is_empty() {
                body["system_instruction"] = serde_json::json!({ "parts": [{ "text": system }] });
            }
            (
                format!(
                    "{base}/v1beta/models/{}:streamGenerateContent?alt=sse",
                    cfg.model
                ),
                vec![("x-goog-api-key".into(), key)],
                body,
            )
        }
        Provider::OpenAI | Provider::OpenRouter | Provider::Custom => {
            let mut headers = vec![];
            if !key.is_empty() {
                headers.push(("authorization".to_string(), format!("Bearer {key}")));
            }
            if cfg.provider == Provider::OpenRouter {
                headers.push(("http-referer".into(), "https://nerva.bytical.ai".into()));
                headers.push(("x-title".into(), "Nerva by Bytical".into()));
            }
            (
                format!("{base}/chat/completions"),
                headers,
                serde_json::json!({
                    "model": cfg.model,
                    "messages": messages,
                    "stream": true,
                    "temperature": 0.4,
                }),
            )
        }
    }
}

/// Interpret one line of the streaming body for `provider`. Pure.
pub fn parse_stream_line(provider: Provider, line: &str) -> StreamEvent {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return StreamEvent::Ignore;
    }
    let payload = if provider == Provider::Ollama {
        trimmed
    } else {
        // SSE: only `data:` lines carry JSON; `event:`/`id:`/comments are noise.
        match trimmed.strip_prefix("data:") {
            Some(rest) => rest.trim(),
            None => return StreamEvent::Ignore,
        }
    };
    if payload == "[DONE]" {
        return StreamEvent::Done;
    }
    let v: serde_json::Value = match serde_json::from_str(payload) {
        Ok(v) => v,
        Err(_) => return StreamEvent::Ignore,
    };
    let text = match provider {
        Provider::Ollama => {
            if v.get("done").and_then(|b| b.as_bool()).unwrap_or(false) {
                // Ollama's final frame may still carry a last delta.
                let tail = v["message"]["content"].as_str().unwrap_or("");
                return if tail.is_empty() {
                    StreamEvent::Done
                } else {
                    StreamEvent::Delta(tail.to_string())
                };
            }
            v["message"]["content"].as_str()
        }
        Provider::Anthropic => match v["type"].as_str() {
            Some("message_stop") => return StreamEvent::Done,
            Some("content_block_delta") => v["delta"]["text"].as_str(),
            _ => None,
        },
        Provider::Gemini => {
            if v["candidates"][0]["finishReason"].is_string()
                && v["candidates"][0]["content"]["parts"][0]["text"].is_null()
            {
                return StreamEvent::Done;
            }
            v["candidates"][0]["content"]["parts"][0]["text"].as_str()
        }
        _ => {
            if v["choices"][0]["finish_reason"].is_string()
                && v["choices"][0]["delta"]["content"].is_null()
            {
                return StreamEvent::Done;
            }
            v["choices"][0]["delta"]["content"].as_str()
        }
    };
    match text {
        Some(t) if !t.is_empty() => StreamEvent::Delta(t.to_string()),
        _ => StreamEvent::Ignore,
    }
}

/// `(url, headers)` of the model-listing endpoint used by `health()`.
fn build_models_request(cfg: &OllamaConfig) -> (String, Vec<(String, String)>) {
    let base = cfg.endpoint.trim_end_matches('/');
    let key = cfg.api_key.clone().unwrap_or_default();
    match cfg.provider {
        Provider::Ollama => (format!("{base}/api/tags"), vec![]),
        Provider::Anthropic => (
            format!("{base}/v1/models"),
            vec![
                ("x-api-key".into(), key),
                ("anthropic-version".into(), "2023-06-01".into()),
            ],
        ),
        Provider::Gemini => (
            format!("{base}/v1beta/models?pageSize=200"),
            vec![("x-goog-api-key".into(), key)],
        ),
        _ => {
            let mut h = vec![];
            if !key.is_empty() {
                h.push(("authorization".to_string(), format!("Bearer {key}")));
            }
            (format!("{base}/models"), h)
        }
    }
}

/// Extract model ids from a model-listing response. Pure.
fn parse_models(provider: Provider, v: &serde_json::Value) -> Vec<String> {
    let arr = match provider {
        Provider::Ollama => v["models"].as_array(),
        Provider::Gemini => v["models"].as_array(),
        _ => v["data"].as_array(),
    };
    let mut out: Vec<String> = arr
        .map(|a| {
            a.iter()
                .filter_map(|m| m["name"].as_str().or_else(|| m["id"].as_str()))
                .map(|s| s.trim_start_matches("models/").to_string())
                .collect()
        })
        .unwrap_or_default();
    if provider == Provider::Gemini {
        out.retain(|m| m.starts_with("gemini"));
    }
    out.sort();
    out
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
            .connect_timeout(std::time::Duration::from_secs(5))
            .build()
            .expect("reqwest client build");
        Self {
            cfg: RwLock::new(cfg),
            http,
            cancels: Mutex::new(HashMap::new()),
        }
    }

    pub fn snapshot(&self) -> OllamaConfig {
        self.cfg.read().clone()
    }

    /// Update the active model. Persisted by the caller via the meta-table.
    pub fn set_model(&self, model: &str) {
        self.cfg.write().model = model.to_string();
    }

    /// Update the active provider's endpoint (base URL). Trailing slashes are
    /// tolerated. When the provider is Ollama this also moves embeddings.
    /// Persistence is the caller's job (meta-table).
    pub fn set_endpoint(&self, endpoint: &str) {
        let mut c = self.cfg.write();
        c.endpoint = endpoint.to_string();
        if c.provider == Provider::Ollama {
            c.ollama_endpoint = endpoint.to_string();
        }
    }

    /// Switch provider. Resets endpoint/model to that provider's defaults
    /// unless overrides are supplied.
    pub fn set_provider(&self, provider: Provider, endpoint: Option<&str>, model: Option<&str>) {
        let mut c = self.cfg.write();
        c.provider = provider;
        c.endpoint = endpoint.map(str::to_string).unwrap_or_else(|| {
            if provider == Provider::Ollama {
                c.ollama_endpoint.clone()
            } else {
                provider.default_endpoint().to_string()
            }
        });
        c.model = model
            .map(str::to_string)
            .unwrap_or_else(|| provider.default_model().to_string());
    }

    pub fn set_api_key(&self, key: Option<&str>) {
        self.cfg.write().api_key = key.map(|k| k.trim().to_string()).filter(|k| !k.is_empty());
    }

    fn apply_headers(
        mut req: reqwest::RequestBuilder,
        headers: &[(String, String)],
    ) -> reqwest::RequestBuilder {
        for (k, v) in headers {
            req = req.header(k.as_str(), v.as_str());
        }
        req
    }

    /// Probe the provider's model-listing endpoint to confirm it is reachable
    /// (and the key is valid) and report the available models.
    pub async fn health(&self) -> AiHealth {
        let cfg = self.snapshot();
        let mut base = AiHealth {
            available: false,
            provider: cfg.provider,
            endpoint: cfg.endpoint.clone(),
            model: cfg.model.clone(),
            installed_models: vec![],
            error: None,
        };
        if cfg.provider.needs_key() && cfg.api_key.as_deref().unwrap_or("").is_empty() {
            base.error = Some("API key required — add it in Settings → Nerva AI".into());
            return base;
        }
        let (url, headers) = build_models_request(&cfg);
        match Self::apply_headers(self.http.get(&url), &headers)
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                let body: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
                base.installed_models = parse_models(cfg.provider, &body);
                base.available = true;
                base
            }
            Ok(resp) => {
                let code = resp.status();
                base.error = Some(if code.as_u16() == 401 || code.as_u16() == 403 {
                    format!("HTTP {code} — check the API key")
                } else {
                    format!("HTTP {code}")
                });
                base
            }
            Err(e) => {
                base.error = Some(simple_err(&e, cfg.provider));
                base
            }
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
        if cfg.provider.needs_key() && cfg.api_key.as_deref().unwrap_or("").is_empty() {
            return Err(NervaError::Invalid(format!(
                "{} needs an API key — add it in Settings → Nerva AI",
                cfg.provider.label()
            )));
        }
        let (url, headers, body) = build_chat_request(&cfg, &messages);

        // Register cancel flag for this request.
        let flag = Arc::new(AtomicBool::new(false));
        self.cancels
            .lock()
            .insert(request_id.to_string(), flag.clone());
        let _guard = CancelGuard {
            client: self,
            id: request_id,
        };

        let resp = Self::apply_headers(self.http.post(&url), &headers)
            .json(&body)
            .send()
            .await
            .map_err(|e| {
                NervaError::Invalid(format!(
                    "{} request: {}",
                    cfg.provider.label(),
                    simple_err(&e, cfg.provider)
                ))
            })?;

        if !resp.status().is_success() {
            let code = resp.status();
            // Providers put the useful reason in the body (bad key, unknown
            // model, quota) — surface the first 200 chars.
            let detail = resp.text().await.unwrap_or_default();
            let detail: String = detail.chars().take(200).collect();
            return Err(NervaError::Invalid(format!(
                "{} returned HTTP {code}{}",
                cfg.provider.label(),
                if detail.is_empty() {
                    String::new()
                } else {
                    format!(": {detail}")
                }
            )));
        }

        let mut stream = resp.bytes_stream();
        let mut buf: Vec<u8> = Vec::with_capacity(4096);
        let mut out = String::new();

        while let Some(chunk) = stream.next().await {
            if flag.load(Ordering::SeqCst) {
                // Frontend requested cancel — stop reading; dropping the body
                // here closes the TCP stream, which every provider treats as
                // a client disconnect and aborts generation server-side.
                return Ok(ChatOutcome {
                    text: out,
                    cancelled: true,
                    model: cfg.model,
                });
            }
            let chunk = chunk.map_err(|e| {
                NervaError::Invalid(format!(
                    "{} stream: {}",
                    cfg.provider.label(),
                    simple_err(&e, cfg.provider)
                ))
            })?;
            buf.extend_from_slice(&chunk);
            // Process complete lines (NDJSON and SSE are both line-oriented).
            while let Some(nl) = buf.iter().position(|&b| b == b'\n') {
                let line = buf.drain(..=nl).collect::<Vec<u8>>();
                let line = std::str::from_utf8(&line).unwrap_or("");
                match parse_stream_line(cfg.provider, line) {
                    StreamEvent::Delta(c) => {
                        on_token(&c);
                        out.push_str(&c);
                    }
                    StreamEvent::Done => {
                        return Ok(ChatOutcome {
                            text: out,
                            cancelled: false,
                            model: cfg.model,
                        });
                    }
                    StreamEvent::Ignore => {}
                }
            }
        }
        Ok(ChatOutcome {
            text: out,
            cancelled: false,
            model: cfg.model,
        })
    }

    /// Compute an embedding for arbitrary text via Ollama's `/api/embeddings`.
    /// Always uses the Ollama endpoint (see module docs). Returns the raw
    /// float vector. Errors propagate so callers can decide whether to skip
    /// persistence vs. surface to the UI.
    pub async fn embed(&self, text: &str, model: &str) -> Result<Vec<f32>> {
        let cfg = self.snapshot();
        let url = format!(
            "{}/api/embeddings",
            cfg.ollama_endpoint.trim_end_matches('/')
        );
        // Ollama accepts an empty `prompt` but returns a zero-norm vector,
        // which would poison cosine similarity. Substitute a single space.
        let prompt = if text.trim().is_empty() { " " } else { text };
        let body = serde_json::json!({ "model": model, "prompt": prompt });
        #[derive(Deserialize)]
        struct EmbedResp {
            embedding: Vec<f32>,
        }
        let resp = self.http.post(&url).json(&body).send().await.map_err(|e| {
            NervaError::Invalid(format!(
                "ollama embed: {}",
                simple_err(&e, Provider::Ollama)
            ))
        })?;
        if !resp.status().is_success() {
            return Err(NervaError::Invalid(format!(
                "ollama embed HTTP {}",
                resp.status()
            )));
        }
        let parsed: EmbedResp = resp.json().await.map_err(|e| {
            NervaError::Invalid(format!(
                "ollama embed parse: {}",
                simple_err(&e, Provider::Ollama)
            ))
        })?;
        if parsed.embedding.is_empty() {
            return Err(NervaError::Invalid("empty embedding".into()));
        }
        Ok(parsed.embedding)
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

fn simple_err(e: &reqwest::Error, provider: Provider) -> String {
    if e.is_connect() {
        match provider {
            Provider::Ollama => {
                "could not connect to ollama (is it running on localhost:11434?)".to_string()
            }
            _ => format!(
                "could not connect to {} — check the endpoint / network",
                provider.label()
            ),
        }
    } else if e.is_timeout() {
        format!("{} request timed out", provider.label())
    } else {
        e.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(provider: Provider) -> OllamaConfig {
        OllamaConfig {
            provider,
            endpoint: provider.default_endpoint().to_string(),
            model: provider.default_model().to_string(),
            api_key: if provider.needs_key() {
                Some("sk-test".into())
            } else {
                None
            },
            ollama_endpoint: DEFAULT_ENDPOINT.to_string(),
        }
    }

    fn msgs() -> Vec<ChatMessage> {
        vec![
            ChatMessage {
                role: "system".into(),
                content: "You are Nerva.".into(),
            },
            ChatMessage {
                role: "user".into(),
                content: "hi".into(),
            },
            ChatMessage {
                role: "assistant".into(),
                content: "hello".into(),
            },
            ChatMessage {
                role: "user".into(),
                content: "plan my day".into(),
            },
        ]
    }

    #[test]
    fn openai_request_shape() {
        let (url, headers, body) = build_chat_request(&cfg(Provider::OpenAI), &msgs());
        assert_eq!(url, "https://api.openai.com/v1/chat/completions");
        assert!(headers
            .iter()
            .any(|(k, v)| k == "authorization" && v == "Bearer sk-test"));
        assert_eq!(body["stream"], true);
        assert_eq!(body["messages"].as_array().unwrap().len(), 4);
        assert_eq!(body["model"], "gpt-4o-mini");
    }

    #[test]
    fn openrouter_adds_attribution_headers() {
        let (url, headers, _) = build_chat_request(&cfg(Provider::OpenRouter), &msgs());
        assert_eq!(url, "https://openrouter.ai/api/v1/chat/completions");
        assert!(headers.iter().any(|(k, _)| k == "x-title"));
    }

    #[test]
    fn anthropic_moves_system_out_of_messages() {
        let (url, headers, body) = build_chat_request(&cfg(Provider::Anthropic), &msgs());
        assert_eq!(url, "https://api.anthropic.com/v1/messages");
        assert!(headers
            .iter()
            .any(|(k, v)| k == "x-api-key" && v == "sk-test"));
        assert!(headers.iter().any(|(k, _)| k == "anthropic-version"));
        assert_eq!(body["system"], "You are Nerva.");
        let turns = body["messages"].as_array().unwrap();
        assert_eq!(turns.len(), 3);
        assert!(turns.iter().all(|t| t["role"] != "system"));
        assert!(body["max_tokens"].as_i64().unwrap() > 0);
    }

    #[test]
    fn gemini_maps_roles_and_system_instruction() {
        let (url, headers, body) = build_chat_request(&cfg(Provider::Gemini), &msgs());
        assert!(url.ends_with("/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse"));
        assert!(headers
            .iter()
            .any(|(k, v)| k == "x-goog-api-key" && v == "sk-test"));
        assert_eq!(
            body["system_instruction"]["parts"][0]["text"],
            "You are Nerva."
        );
        let contents = body["contents"].as_array().unwrap();
        assert_eq!(contents[1]["role"], "model");
        assert_eq!(contents[2]["parts"][0]["text"], "plan my day");
    }

    #[test]
    fn ollama_request_unchanged() {
        let (url, headers, body) = build_chat_request(&cfg(Provider::Ollama), &msgs());
        assert_eq!(url, "http://localhost:11434/api/chat");
        assert!(headers.is_empty());
        assert_eq!(body["options"]["num_ctx"], 4096);
    }

    #[test]
    fn custom_without_key_sends_no_auth_header() {
        let (_, headers, _) = build_chat_request(&cfg(Provider::Custom), &msgs());
        assert!(headers.is_empty());
    }

    #[test]
    fn parse_openai_sse() {
        let p = Provider::OpenAI;
        assert_eq!(parse_stream_line(p, ""), StreamEvent::Ignore);
        assert_eq!(parse_stream_line(p, ": keep-alive"), StreamEvent::Ignore);
        assert_eq!(
            parse_stream_line(p, r#"data: {"choices":[{"delta":{"content":"Hel"}}]}"#),
            StreamEvent::Delta("Hel".into())
        );
        assert_eq!(
            parse_stream_line(
                p,
                r#"data: {"choices":[{"delta":{},"finish_reason":"stop"}]}"#
            ),
            StreamEvent::Done
        );
        assert_eq!(parse_stream_line(p, "data: [DONE]"), StreamEvent::Done);
    }

    #[test]
    fn parse_anthropic_sse() {
        let p = Provider::Anthropic;
        assert_eq!(
            parse_stream_line(p, "event: content_block_delta"),
            StreamEvent::Ignore
        );
        assert_eq!(
            parse_stream_line(
                p,
                r#"data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}"#
            ),
            StreamEvent::Delta("Hi".into())
        );
        assert_eq!(
            parse_stream_line(
                p,
                r#"data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}"#
            ),
            StreamEvent::Ignore
        );
        assert_eq!(
            parse_stream_line(p, r#"data: {"type":"message_stop"}"#),
            StreamEvent::Done
        );
    }

    #[test]
    fn parse_gemini_sse() {
        let p = Provider::Gemini;
        assert_eq!(
            parse_stream_line(
                p,
                r#"data: {"candidates":[{"content":{"parts":[{"text":"Yo"}],"role":"model"}}]}"#
            ),
            StreamEvent::Delta("Yo".into())
        );
        // Final frame usually carries the last text AND finishReason → delta.
        assert_eq!(
            parse_stream_line(
                p,
                r#"data: {"candidates":[{"content":{"parts":[{"text":"."}]},"finishReason":"STOP"}]}"#
            ),
            StreamEvent::Delta(".".into())
        );
        assert_eq!(
            parse_stream_line(p, r#"data: {"candidates":[{"finishReason":"STOP"}]}"#),
            StreamEvent::Done
        );
    }

    #[test]
    fn parse_ollama_ndjson() {
        let p = Provider::Ollama;
        assert_eq!(
            parse_stream_line(
                p,
                r#"{"message":{"role":"assistant","content":"a"},"done":false}"#
            ),
            StreamEvent::Delta("a".into())
        );
        assert_eq!(
            parse_stream_line(
                p,
                r#"{"message":{"role":"assistant","content":""},"done":true}"#
            ),
            StreamEvent::Done
        );
        assert_eq!(parse_stream_line(p, "not json"), StreamEvent::Ignore);
    }

    #[test]
    fn parse_models_per_provider() {
        let openai = serde_json::json!({"data":[{"id":"gpt-4o"},{"id":"gpt-4o-mini"}]});
        assert_eq!(
            parse_models(Provider::OpenAI, &openai),
            vec!["gpt-4o", "gpt-4o-mini"]
        );
        let gem = serde_json::json!({"models":[{"name":"models/gemini-2.0-flash"},{"name":"models/embedding-001"}]});
        assert_eq!(
            parse_models(Provider::Gemini, &gem),
            vec!["gemini-2.0-flash"]
        );
        let oll = serde_json::json!({"models":[{"name":"llama3.2:3b"}]});
        assert_eq!(parse_models(Provider::Ollama, &oll), vec!["llama3.2:3b"]);
        let anth = serde_json::json!({"data":[{"id":"claude-3-5-haiku-latest"}]});
        assert_eq!(
            parse_models(Provider::Anthropic, &anth),
            vec!["claude-3-5-haiku-latest"]
        );
    }

    #[test]
    fn provider_labels_round_trip() {
        for p in [
            Provider::Ollama,
            Provider::OpenAI,
            Provider::Anthropic,
            Provider::Gemini,
            Provider::OpenRouter,
            Provider::Custom,
        ] {
            assert_eq!(Provider::from_label(p.label()), Some(p));
        }
        assert_eq!(Provider::from_label("OpenAI"), Some(Provider::OpenAI));
        assert_eq!(Provider::from_label("nope"), None);
    }
}
