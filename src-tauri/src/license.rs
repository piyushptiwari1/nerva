//! Nerva Pro licensing — verification of *device tokens*.
//!
//! Trust model:
//! - A licence key (`NERVA-…`) is only ever verified by nerva.bytical.ai.
//! - The server binds the key to a device id and returns a **device token**
//!   (`NVT1.<payload>.<sig>`) signed with ECDSA P-256. The matching public
//!   key is compiled into this module. Tokens last 30 days; the app refreshes
//!   them silently while online.
//! - Pro is unlocked only when a token (a) verifies against the embedded
//!   public key, (b) names *this* device id, (c) hasn't expired, and (d) the
//!   licence itself hasn't expired. Editing SQLite / localStorage cannot
//!   produce a valid token; only the server's private key can.
//!
//! This is a deterrent, not DRM: the binary is open source and can be
//! patched. Server-side features (backup relay) are gated independently.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use p256::ecdsa::{signature::Verifier, Signature, VerifyingKey};
use serde::{Deserialize, Serialize};

/// Uncompressed SEC1 public key (04 || X || Y) of the licence signer.
/// Rotate by appending a new key and keeping old ones until tokens expire.
const PUBLIC_KEYS_SEC1_B64URL: &[&str] = &[
    // secrets/license-signing.public.jwk.json (2026-09-25)
    "BHzF1AfTql7ninayaYnha_OhFUyeFB9vku98k7F0eZ9qlluNosR9iQtoB9syGxp8tV_e5DBXJ6ifLdN1SCnatug",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Plan {
    Monthly,
    Yearly,
    Lifetime,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DeviceToken {
    pub v: u8,
    /// Licence id (PayU txnid).
    pub t: String,
    pub p: Plan,
    /// Device id the token was issued to.
    pub d: String,
    /// Email hint for display.
    #[serde(default)]
    pub h: String,
    /// Licence expiry, unix seconds; 0 = never.
    pub lexp: i64,
    /// Token expiry, unix seconds.
    pub exp: i64,
    pub iat: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct LicenseStatus {
    pub active: bool,
    pub plan: Option<Plan>,
    pub license_id: Option<String>,
    pub email_hint: Option<String>,
    /// Licence expiry (unix s, 0 = never).
    pub license_exp: Option<i64>,
    /// Device-token expiry (unix s) — the app refreshes before this.
    pub token_exp: Option<i64>,
    pub device_id: String,
    /// Why `active == false`.
    pub reason: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum VerifyError {
    Malformed,
    BadSignature,
    WrongDevice,
    TokenExpired,
    LicenseExpired,
}

impl VerifyError {
    pub fn label(&self) -> &'static str {
        match self {
            Self::Malformed => "malformed token",
            Self::BadSignature => "signature invalid",
            Self::WrongDevice => "token issued to another device",
            Self::TokenExpired => "token expired — reconnect to refresh",
            Self::LicenseExpired => "licence expired",
        }
    }
}

fn verifying_keys() -> Vec<VerifyingKey> {
    PUBLIC_KEYS_SEC1_B64URL
        .iter()
        .filter_map(|b64| URL_SAFE_NO_PAD.decode(b64).ok())
        .filter_map(|bytes| VerifyingKey::from_sec1_bytes(&bytes).ok())
        .collect()
}

/// Verify a device token for `device_id` at wall-clock `now` (unix seconds).
/// Pure, so it is unit-testable and cannot be short-circuited by IO.
pub fn verify_token(token: &str, device_id: &str, now: i64) -> Result<DeviceToken, VerifyError> {
    verify_with(&verifying_keys(), token, device_id, now)
}

pub fn verify_with(
    keys: &[VerifyingKey],
    token: &str,
    device_id: &str,
    now: i64,
) -> Result<DeviceToken, VerifyError> {
    let mut parts = token.trim().split('.');
    let (Some(prefix), Some(body), Some(sig), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(VerifyError::Malformed);
    };
    if prefix != "NVT1" || body.is_empty() || sig.is_empty() {
        return Err(VerifyError::Malformed);
    }
    let sig_bytes = URL_SAFE_NO_PAD
        .decode(sig)
        .map_err(|_| VerifyError::Malformed)?;
    let signature = Signature::from_slice(&sig_bytes).map_err(|_| VerifyError::Malformed)?;
    // The signature covers the base64url body string itself (what WebCrypto signed).
    if !keys
        .iter()
        .any(|k| k.verify(body.as_bytes(), &signature).is_ok())
    {
        return Err(VerifyError::BadSignature);
    }
    let payload = URL_SAFE_NO_PAD
        .decode(body)
        .map_err(|_| VerifyError::Malformed)?;
    let tok: DeviceToken = serde_json::from_slice(&payload).map_err(|_| VerifyError::Malformed)?;
    if tok.v != 1 {
        return Err(VerifyError::Malformed);
    }
    if tok.d != device_id {
        return Err(VerifyError::WrongDevice);
    }
    if tok.exp <= now {
        return Err(VerifyError::TokenExpired);
    }
    if tok.lexp != 0 && tok.lexp <= now {
        return Err(VerifyError::LicenseExpired);
    }
    Ok(tok)
}

#[cfg(test)]
mod tests {
    use super::*;
    use p256::ecdsa::{signature::Signer, SigningKey};

    // Deterministic test keys (any 32-byte scalar in range works).
    fn key(seed: u8) -> SigningKey {
        let mut b = [seed; 32];
        b[0] = 0x01;
        SigningKey::from_slice(&b).expect("valid scalar")
    }

    fn mint(key: &SigningKey, payload: &str) -> String {
        let body = URL_SAFE_NO_PAD.encode(payload.as_bytes());
        let sig: Signature = key.sign(body.as_bytes());
        format!("NVT1.{}.{}", body, URL_SAFE_NO_PAD.encode(sig.to_bytes()))
    }

    fn payload(device: &str, exp: i64, lexp: i64) -> String {
        format!(
            r#"{{"v":1,"t":"txn1","p":"yearly","d":"{device}","h":"p…y@x.io","lexp":{lexp},"exp":{exp},"iat":1000}}"#
        )
    }

    #[test]
    fn valid_token_verifies() {
        let sk = key(7);
        let keys = vec![*sk.verifying_key()];
        let tok = mint(&sk, &payload("dev-A", 5000, 0));
        let t = verify_with(&keys, &tok, "dev-A", 4000).expect("valid");
        assert_eq!(t.p, Plan::Yearly);
        assert_eq!(t.t, "txn1");
    }

    #[test]
    fn rejects_wrong_device_expiry_and_forgery() {
        let sk = key(7);
        let other = key(9);
        let keys = vec![*sk.verifying_key()];
        assert_eq!(
            verify_with(&keys, &mint(&sk, &payload("dev-A", 5000, 0)), "dev-B", 4000).unwrap_err(),
            VerifyError::WrongDevice
        );
        assert_eq!(
            verify_with(&keys, &mint(&sk, &payload("dev-A", 3000, 0)), "dev-A", 4000).unwrap_err(),
            VerifyError::TokenExpired
        );
        assert_eq!(
            verify_with(
                &keys,
                &mint(&sk, &payload("dev-A", 5000, 3500)),
                "dev-A",
                4000
            )
            .unwrap_err(),
            VerifyError::LicenseExpired
        );
        // Signed by someone else's key → not ours.
        assert_eq!(
            verify_with(
                &keys,
                &mint(&other, &payload("dev-A", 5000, 0)),
                "dev-A",
                4000
            )
            .unwrap_err(),
            VerifyError::BadSignature
        );
        // Tampered payload (plan upgraded) with the original signature.
        let good = mint(&sk, &payload("dev-A", 5000, 0));
        let mut parts: Vec<&str> = good.split('.').collect();
        let forged_body =
            URL_SAFE_NO_PAD.encode(payload("dev-A", 5000, 0).replace("yearly", "lifetime"));
        parts[1] = &forged_body;
        let forged = parts.join(".");
        assert_eq!(
            verify_with(&keys, &forged, "dev-A", 4000).unwrap_err(),
            VerifyError::BadSignature
        );
        assert_eq!(
            verify_with(&keys, "garbage", "dev-A", 4000).unwrap_err(),
            VerifyError::Malformed
        );
        assert_eq!(
            verify_with(&keys, "", "dev-A", 4000).unwrap_err(),
            VerifyError::Malformed
        );
    }

    #[test]
    fn embedded_public_key_parses() {
        assert_eq!(verifying_keys().len(), PUBLIC_KEYS_SEC1_B64URL.len());
    }
}
