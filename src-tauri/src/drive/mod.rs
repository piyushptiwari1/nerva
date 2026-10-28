//! Google Drive sync (Pro). One file — the same `.nerva.db` the free backup
//! produces — kept in the account's hidden `appDataFolder`, so Nerva never
//! sees the rest of the user's Drive and nothing else can see Nerva's file.
//!
//! Credentials and sync bookkeeping live in `drive.json` beside the
//! database, *not* inside it: tokens must not travel with a backup, and a
//! restore must not swap one device's identity for another's.
//!
//! Conflict policy (user-chosen): newest wins; the losing local database is
//! kept as `backup-before-restore-<stamp>/` exactly like a manual restore.

use crate::error::{NervaError, Result};
use crate::state::AppState;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

pub const SCOPE: &str = "https://www.googleapis.com/auth/drive.appdata";
const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const FILES_URL: &str = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_URL: &str = "https://www.googleapis.com/upload/drive/v3/files";
const REMOTE_NAME: &str = "nerva.db";

/// Compile-time client id (set `NERVA_GOOGLE_CLIENT_ID` when building the
/// public binaries); a dev override can be stored in `drive.json`.
const BUILT_IN_CLIENT_ID: Option<&str> = option_env!("NERVA_GOOGLE_CLIENT_ID");
const BUILT_IN_CLIENT_SECRET: Option<&str> = option_env!("NERVA_GOOGLE_CLIENT_SECRET");

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct DriveFile {
    #[serde(default)]
    pub client_id: Option<String>,
    #[serde(default)]
    pub client_secret: Option<String>,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub access_token: Option<String>,
    #[serde(default)]
    pub access_expires_ms: i64,
    #[serde(default)]
    pub file_id: Option<String>,
    /// Remote `modifiedTime` (RFC 3339) seen at the last successful sync.
    #[serde(default)]
    pub synced_remote_modified: Option<String>,
    /// Newest local event id at the last successful sync.
    #[serde(default)]
    pub synced_local_event: i64,
    #[serde(default)]
    pub last_sync_ms: Option<i64>,
    #[serde(default)]
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DriveStatus {
    pub configured: bool,
    pub connected: bool,
    pub file_id: Option<String>,
    pub last_sync_ms: Option<i64>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    /// Nothing changed on either side.
    InSync,
    Uploaded,
    /// Remote was newer; the local DB was replaced and the app must restart.
    Downloaded,
}

#[derive(Debug, Clone, Serialize)]
pub struct SyncReport {
    pub outcome: Outcome,
    pub kept_local_copy: Option<String>,
}

fn path(data_dir: &Path) -> PathBuf {
    data_dir.join("drive.json")
}

pub fn load(data_dir: &Path) -> DriveFile {
    std::fs::read(path(data_dir))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

pub fn save(data_dir: &Path, f: &DriveFile) -> Result<()> {
    let tmp = path(data_dir).with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(f)?)?;
    std::fs::rename(tmp, path(data_dir))?;
    Ok(())
}

fn client_id(f: &DriveFile) -> Option<String> {
    f.client_id
        .clone()
        .or_else(|| BUILT_IN_CLIENT_ID.map(str::to_string))
        .filter(|s| !s.is_empty())
}
fn client_secret(f: &DriveFile) -> Option<String> {
    f.client_secret
        .clone()
        .or_else(|| BUILT_IN_CLIENT_SECRET.map(str::to_string))
        .filter(|s| !s.is_empty())
}

pub fn status(data_dir: &Path) -> DriveStatus {
    let f = load(data_dir);
    DriveStatus {
        configured: client_id(&f).is_some(),
        connected: f.refresh_token.is_some(),
        file_id: f.file_id.clone(),
        last_sync_ms: f.last_sync_ms,
        last_error: f.last_error,
    }
}

pub fn disconnect(data_dir: &Path) -> Result<()> {
    let f = load(data_dir);
    save(
        data_dir,
        &DriveFile {
            client_id: f.client_id,
            client_secret: f.client_secret,
            ..Default::default()
        },
    )
}

// ── Decision ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Plan {
    Nothing,
    Upload,
    Download,
}

/// Pure conflict resolution. `remote_changed` = remote modifiedTime differs
/// from the one recorded at last sync; `local_changed` = events appended
/// since then. A device that has never synced and holds no user content
/// adopts the account's data; otherwise when both changed, the newer side wins.
pub fn decide(
    remote_exists: bool,
    remote_changed: bool,
    remote_modified_ms: i64,
    local_changed: bool,
    local_last_event_ms: i64,
    first_sync_pristine: bool,
) -> Plan {
    if remote_exists && first_sync_pristine {
        return Plan::Download;
    }
    match (remote_exists, remote_changed, local_changed) {
        (false, _, _) => Plan::Upload,
        (true, false, false) => Plan::Nothing,
        (true, false, true) => Plan::Upload,
        (true, true, false) => Plan::Download,
        (true, true, true) => {
            if remote_modified_ms > local_last_event_ms {
                Plan::Download
            } else {
                Plan::Upload
            }
        }
    }
}

// ── OAuth (desktop loopback + PKCE) ───────────────────────────────────────

fn b64url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn random_token() -> String {
    b64url(uuid::Uuid::new_v4().as_bytes()) + &b64url(uuid::Uuid::new_v4().as_bytes())
}

#[cfg(desktop)]
fn open_browser(url: &str) -> Result<()> {
    #[cfg(target_os = "linux")]
    let attempts: Vec<(&str, Vec<&str>)> =
        vec![("xdg-open", vec![url]), ("gio", vec!["open", url])];
    #[cfg(target_os = "macos")]
    let attempts: Vec<(&str, Vec<&str>)> = vec![("open", vec![url])];
    #[cfg(target_os = "windows")]
    let attempts: Vec<(&str, Vec<&str>)> = vec![("cmd", vec!["/C", "start", "", url])];
    let mut last = None;
    for (cmd, args) in attempts {
        match std::process::Command::new(cmd).args(&args).spawn() {
            Ok(_) => return Ok(()),
            Err(e) => last = Some(e),
        }
    }
    Err(NervaError::Invalid(format!(
        "could not open a browser: {}",
        last.map(|e| e.to_string()).unwrap_or_default()
    )))
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: i64,
    #[serde(default)]
    refresh_token: Option<String>,
}

/// Run the whole sign-in on the calling (async) task: open the browser,
/// wait for Google to redirect to our loopback port, exchange the code.
#[cfg(desktop)]
pub async fn connect(data_dir: PathBuf) -> Result<DriveStatus> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let mut f = load(&data_dir);
    let cid = client_id(&f).ok_or_else(|| {
        NervaError::Invalid("Google Drive is not configured in this build".into())
    })?;

    let verifier = random_token();
    let challenge = b64url(&Sha256::digest(verifier.as_bytes()));
    let state_token = random_token();

    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await?;
    let port = listener.local_addr()?.port();
    let redirect = format!("http://127.0.0.1:{port}/oauth");

    let url = format!(
        "{AUTH_URL}?client_id={}&redirect_uri={}&response_type=code&scope={}&code_challenge={}&code_challenge_method=S256&state={}&access_type=offline&prompt=consent",
        urlenc(&cid), urlenc(&redirect), urlenc(SCOPE), challenge, state_token
    );
    open_browser(&url)?;

    let accept = tokio::time::timeout(std::time::Duration::from_secs(300), listener.accept()).await;
    let (mut socket, _) =
        accept.map_err(|_| NervaError::Invalid("Sign-in timed out; try again".into()))??;
    let mut buf = vec![0u8; 8192];
    let n = socket.read(&mut buf).await?;
    let request = String::from_utf8_lossy(&buf[..n]).to_string();
    let query = request
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .and_then(|p| p.split_once('?'))
        .map(|(_, q)| q.to_string())
        .unwrap_or_default();
    let params: std::collections::HashMap<String, String> = query
        .split('&')
        .filter_map(|kv| kv.split_once('='))
        .map(|(k, v)| (k.to_string(), urldec(v)))
        .collect();

    let ok = params.get("state") == Some(&state_token) && params.contains_key("code");
    let page = if ok {
        "<!doctype html><meta charset=utf-8><title>Nerva</title><body style=\"font-family:system-ui;background:#0f1115;color:#eef1f7;display:grid;place-items:center;height:100vh;margin:0\"><div style=\"text-align:center\"><h1 style=\"font-weight:600\">Google Drive connected</h1><p style=\"color:#8a94a5\">You can close this tab and return to Nerva.</p></div>"
    } else {
        "<!doctype html><meta charset=utf-8><title>Nerva</title><body style=\"font-family:system-ui;background:#0f1115;color:#eef1f7;display:grid;place-items:center;height:100vh;margin:0\"><div style=\"text-align:center\"><h1 style=\"font-weight:600\">Sign-in was cancelled</h1><p style=\"color:#8a94a5\">Return to Nerva and try again.</p></div>"
    };
    let _ = socket
        .write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", page.len(), page).as_bytes())
        .await;
    let _ = socket.shutdown().await;
    if !ok {
        return Err(NervaError::Invalid(
            params
                .get("error")
                .cloned()
                .unwrap_or_else(|| "sign-in cancelled".into()),
        ));
    }

    let mut form = vec![
        ("client_id", cid.clone()),
        ("code", params["code"].clone()),
        ("code_verifier", verifier),
        ("grant_type", "authorization_code".to_string()),
        ("redirect_uri", redirect),
    ];
    if let Some(secret) = client_secret(&f) {
        form.push(("client_secret", secret));
    }
    let tok: TokenResponse = checked(http()?.post(TOKEN_URL).form(&form).send().await?)
        .await?
        .json()
        .await?;
    f.refresh_token = tok.refresh_token.or(f.refresh_token);
    f.access_token = Some(tok.access_token);
    f.access_expires_ms = crate::store::now_ms() + tok.expires_in * 1000 - 60_000;
    f.last_error = None;
    save(&data_dir, &f)?;
    Ok(status(&data_dir))
}

#[cfg(not(desktop))]
pub async fn connect(_data_dir: PathBuf) -> Result<DriveStatus> {
    Err(NervaError::Invalid("Connect Google Drive from the desktop app for now; the phone follows in the next mobile update".into()))
}

fn http() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .user_agent(concat!("Nerva/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| NervaError::Storage(e.to_string()))
}

/// Like `error_for_status`, but keeps Google's JSON error message.
async fn checked(resp: reqwest::Response) -> Result<reqwest::Response> {
    let status = resp.status();
    if status.is_success() {
        return Ok(resp);
    }
    let body = resp.text().await.unwrap_or_default();
    let message = serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|v| v["error"]["message"].as_str().map(str::to_string))
        .unwrap_or_else(|| body.chars().take(300).collect());
    Err(NervaError::Invalid(format!(
        "Google Drive {}: {}",
        status.as_u16(),
        message
    )))
}

fn urlenc(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn urldec(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                    out.push(v);
                    i += 3;
                    continue;
                }
                out.push(b'%');
                i += 1;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

async fn access_token(data_dir: &Path, f: &mut DriveFile) -> Result<String> {
    if let Some(t) = &f.access_token {
        if f.access_expires_ms > crate::store::now_ms() {
            return Ok(t.clone());
        }
    }
    let cid =
        client_id(f).ok_or_else(|| NervaError::Invalid("Google Drive is not configured".into()))?;
    let refresh = f
        .refresh_token
        .clone()
        .ok_or_else(|| NervaError::Invalid("Google Drive is not connected".into()))?;
    let mut form = vec![
        ("client_id", cid),
        ("refresh_token", refresh),
        ("grant_type", "refresh_token".to_string()),
    ];
    if let Some(secret) = client_secret(f) {
        form.push(("client_secret", secret));
    }
    let resp = http()?.post(TOKEN_URL).form(&form).send().await?;
    if resp.status() == reqwest::StatusCode::BAD_REQUEST
        || resp.status() == reqwest::StatusCode::UNAUTHORIZED
    {
        // Revoked or expired grant: drop it so the UI asks to reconnect.
        f.refresh_token = None;
        f.access_token = None;
        save(data_dir, f)?;
        return Err(NervaError::Invalid(
            "Google Drive access expired; please connect again".into(),
        ));
    }
    let tok: TokenResponse = checked(resp).await?.json().await?;
    f.access_token = Some(tok.access_token.clone());
    f.access_expires_ms = crate::store::now_ms() + tok.expires_in * 1000 - 60_000;
    save(data_dir, f)?;
    Ok(tok.access_token)
}

// ── Drive file operations ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteFile {
    id: String,
    modified_time: String,
}

#[derive(Debug, Deserialize)]
struct FileList {
    #[serde(default)]
    files: Vec<RemoteFile>,
}

async fn find_remote(token: &str) -> Result<Option<RemoteFile>> {
    let resp = http()?
        .get(FILES_URL)
        .bearer_auth(token)
        .query(&[
            ("spaces", "appDataFolder"),
            ("q", &format!("name = '{REMOTE_NAME}' and trashed = false")),
            ("fields", "files(id,modifiedTime)"),
            ("pageSize", "5"),
        ])
        .send()
        .await?;
    let list: FileList = checked(resp).await?.json().await?;
    // Newest first if duplicates ever appear.
    let mut files = list.files;
    files.sort_by(|a, b| b.modified_time.cmp(&a.modified_time));
    Ok(files.into_iter().next())
}

async fn upload(token: &str, existing: Option<&str>, bytes: Vec<u8>) -> Result<RemoteFile> {
    let boundary = format!("nerva{}", uuid::Uuid::new_v4().simple());
    let meta = if existing.is_some() {
        serde_json::json!({ "name": REMOTE_NAME })
    } else {
        serde_json::json!({ "name": REMOTE_NAME, "parents": ["appDataFolder"] })
    };
    let mut body = Vec::with_capacity(bytes.len() + 512);
    body.extend_from_slice(format!("--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{meta}\r\n--{boundary}\r\nContent-Type: application/octet-stream\r\n\r\n").as_bytes());
    body.extend_from_slice(&bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--").as_bytes());
    let client = http()?;
    let req = match existing {
        Some(id) => client.patch(format!("{UPLOAD_URL}/{id}")),
        None => client.post(UPLOAD_URL),
    };
    let resp = req
        .bearer_auth(token)
        .query(&[("uploadType", "multipart"), ("fields", "id,modifiedTime")])
        .header(
            "Content-Type",
            format!("multipart/related; boundary={boundary}"),
        )
        .body(body)
        .send()
        .await?;
    let file: RemoteFile = checked(resp).await?.json().await?;
    Ok(file)
}

async fn download(token: &str, id: &str) -> Result<Vec<u8>> {
    let resp = http()?
        .get(format!("{FILES_URL}/{id}"))
        .bearer_auth(token)
        .query(&[("alt", "media")])
        .send()
        .await?;
    let bytes = checked(resp).await?.bytes().await?;
    Ok(bytes.to_vec())
}

fn rfc3339_ms(s: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|d| d.timestamp_millis())
        .unwrap_or(0)
}

/// One full sync pass. Returns `Downloaded` when the caller must restart.
pub async fn sync(state: &AppState) -> Result<SyncReport> {
    let data_dir = state.data_dir.clone();
    let mut f = load(&data_dir);
    let result = sync_inner(state, &data_dir, &mut f).await;
    match &result {
        Ok(_) => {
            f.last_error = None;
            f.last_sync_ms = Some(crate::store::now_ms());
        }
        Err(e) => f.last_error = Some(e.to_string()),
    }
    save(&data_dir, &f)?;
    result
}

/// No notes, tasks, habits or timers and at most the default workspace.
fn local_is_pristine(state: &AppState) -> bool {
    state.notes.lock().list().is_empty()
        && state.tasks.lock().list().is_empty()
        && state.habits.lock().list().is_empty()
        && state.timers.lock().list().is_empty()
        && state.workspaces.lock().list().len() <= 1
}

async fn sync_inner(state: &AppState, data_dir: &Path, f: &mut DriveFile) -> Result<SyncReport> {
    let token = access_token(data_dir, f).await?;
    let remote = find_remote(&token).await?;
    let (local_id, local_ts) = state.store.last_event()?.unwrap_or((0, 0));
    let remote_changed = remote
        .as_ref()
        .map(|r| Some(&r.modified_time) != f.synced_remote_modified.as_ref())
        .unwrap_or(false);
    let local_changed = local_id != f.synced_local_event;
    let first_sync_pristine = f.synced_remote_modified.is_none() && local_is_pristine(state);
    let plan = decide(
        remote.is_some(),
        remote_changed,
        remote
            .as_ref()
            .map(|r| rfc3339_ms(&r.modified_time))
            .unwrap_or(0),
        local_changed,
        local_ts,
        first_sync_pristine,
    );
    tracing::info!(
        ?plan,
        remote_changed,
        local_changed,
        first_sync_pristine,
        "drive sync"
    );

    match plan {
        Plan::Nothing => Ok(SyncReport {
            outcome: Outcome::InSync,
            kept_local_copy: None,
        }),
        Plan::Upload => {
            state.store.checkpoint()?;
            let tmp = data_dir.join("drive-upload.tmp.db");
            crate::backup::export(&data_dir.join("nerva.db"), &tmp)?;
            let bytes = std::fs::read(&tmp)?;
            let _ = std::fs::remove_file(&tmp);
            let uploaded = upload(&token, remote.as_ref().map(|r| r.id.as_str()), bytes).await?;
            f.file_id = Some(uploaded.id);
            f.synced_remote_modified = Some(uploaded.modified_time);
            f.synced_local_event = local_id;
            Ok(SyncReport {
                outcome: Outcome::Uploaded,
                kept_local_copy: None,
            })
        }
        Plan::Download => {
            let remote = remote.expect("download requires a remote file");
            let bytes = download(&token, &remote.id).await?;
            let tmp = data_dir.join("drive-download.tmp.db");
            std::fs::write(&tmp, &bytes)?;
            let restored = crate::backup::restore(data_dir, &tmp);
            let _ = std::fs::remove_file(&tmp);
            let kept = restored?;
            f.file_id = Some(remote.id);
            f.synced_remote_modified = Some(remote.modified_time);
            // The restored DB's newest event id is unknown until reopen; the
            // next sync after restart recomputes it from a clean baseline.
            f.synced_local_event = crate::backup::inspect(&data_dir.join("nerva.db"))
                .map(|i| i.events)
                .unwrap_or(0);
            Ok(SyncReport {
                outcome: Outcome::Downloaded,
                kept_local_copy: Some(kept.display().to_string()),
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newest_wins_and_simple_cases_are_obvious() {
        assert_eq!(decide(false, false, 0, false, 0, false), Plan::Upload);
        assert_eq!(decide(false, false, 0, false, 0, true), Plan::Upload);
        assert_eq!(decide(true, false, 0, false, 0, false), Plan::Nothing);
        assert_eq!(decide(true, false, 0, true, 10, false), Plan::Upload);
        assert_eq!(decide(true, true, 10, false, 0, false), Plan::Download);
        assert_eq!(decide(true, true, 200, true, 100, false), Plan::Download);
        assert_eq!(decide(true, true, 100, true, 200, false), Plan::Upload);
        // Fresh install joining an account: its bootstrap events are newer, but it must still pull.
        assert_eq!(decide(true, true, 100, true, 200, true), Plan::Download);
    }

    #[test]
    fn url_codec_round_trips_and_pkce_is_url_safe() {
        let raw = "a b&c=d/é";
        assert_eq!(urldec(&urlenc(raw)), raw);
        assert_eq!(urldec("x+y%20z"), "x y z");
        let v = random_token();
        assert!(
            v.len() >= 43
                && v.chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        );
        let c = b64url(&Sha256::digest(v.as_bytes()));
        assert_eq!(c.len(), 43);
    }

    #[test]
    fn drive_file_persists_beside_db_and_disconnect_keeps_client() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!status(dir.path()).connected);
        save(
            dir.path(),
            &DriveFile {
                client_id: Some("cid".into()),
                refresh_token: Some("r".into()),
                ..Default::default()
            },
        )
        .unwrap();
        let s = status(dir.path());
        assert!(s.configured && s.connected);
        disconnect(dir.path()).unwrap();
        let s = status(dir.path());
        assert!(s.configured && !s.connected);
        assert_eq!(rfc3339_ms("2026-10-27T12:00:00.000Z"), 1_793_102_400_000);
    }

    /// Live round trip against Google. Needs a browser and
    /// `NERVA_DRIVE_LIVE_TEST=<path to oauth json with client_id/client_secret>`.
    /// Run: `NERVA_DRIVE_LIVE_TEST=../secrets/google-oauth-desktop.json cargo test drive_live -- --ignored --nocapture`
    #[test]
    #[ignore]
    #[cfg(desktop)]
    fn drive_live_round_trip() {
        let Ok(cfg) = std::env::var("NERVA_DRIVE_LIVE_TEST") else {
            return;
        };
        let creds: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&cfg).unwrap()).unwrap();
        let rt = tokio::runtime::Runtime::new().unwrap();
        let cache = std::path::Path::new(&cfg).with_file_name("google-oauth-live-test.refresh");

        let a = tempfile::tempdir().unwrap();
        let state_a = AppState::initialize_at(a.path().into()).unwrap();
        save(
            a.path(),
            &DriveFile {
                client_id: creds["client_id"].as_str().map(Into::into),
                client_secret: creds["client_secret"].as_str().map(Into::into),
                refresh_token: std::fs::read_to_string(&cache)
                    .ok()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty()),
                ..Default::default()
            },
        )
        .unwrap();
        if !status(a.path()).connected {
            let st = rt.block_on(connect(a.path().into())).unwrap();
            assert!(st.connected, "oauth should yield a refresh token");
            if let Some(r) = &load(a.path()).refresh_token {
                let _ = std::fs::write(&cache, r);
            }
        }

        // Start from a clean remote for this account.
        let mut f = load(a.path());
        let tok = rt.block_on(access_token(a.path(), &mut f)).unwrap();
        if let Some(existing) = rt.block_on(find_remote(&tok)).unwrap() {
            rt.block_on(async {
                http()
                    .unwrap()
                    .delete(format!("{FILES_URL}/{}", existing.id))
                    .bearer_auth(&tok)
                    .send()
                    .await
                    .unwrap()
                    .error_for_status()
                    .unwrap()
            });
        }

        let ws = state_a.workspaces.lock().active().unwrap().id.clone();
        crate::ipc::note_save_for(
            &state_a,
            crate::ipc::SaveNoteArgs {
                id: None,
                title: "From A".into(),
                body: "synced".into(),
                workspace_id: Some(ws),
            },
        )
        .unwrap();
        let r1 = rt.block_on(sync(&state_a)).unwrap();
        assert_eq!(r1.outcome, Outcome::Uploaded);
        let r2 = rt.block_on(sync(&state_a)).unwrap();
        assert_eq!(r2.outcome, Outcome::InSync);

        // Device B: same account, fresh database → pulls A's data.
        let b = tempfile::tempdir().unwrap();
        let state_b = AppState::initialize_at(b.path().into()).unwrap();
        let fa = load(a.path());
        save(
            b.path(),
            &DriveFile {
                client_id: fa.client_id,
                client_secret: fa.client_secret,
                refresh_token: fa.refresh_token,
                ..Default::default()
            },
        )
        .unwrap();
        let r3 = rt.block_on(sync(&state_b)).unwrap();
        assert_eq!(r3.outcome, Outcome::Downloaded);
        assert!(r3.kept_local_copy.is_some());
        drop(state_b);
        let reopened = AppState::initialize_at(b.path().into()).unwrap();
        assert!(reopened
            .notes
            .lock()
            .list()
            .iter()
            .any(|n| n.title == "From A"));
        println!("live drive round trip OK");
    }
}
