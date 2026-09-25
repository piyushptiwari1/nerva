// Nerva Pro licence keys.
//
// Format:  NERVA-<base64url(payload JSON)>.<base64url(HMAC-SHA256)>
// Payload: { v:1, e: email, p: plan, t: txnid, iat: unixSeconds, exp: unixSeconds|0 }
//
// Signed with LICENSE_SIGNING_SECRET (Vercel env). The app never sees the
// secret; it calls /api/license-verify and caches the verdict for 14 days so
// it works offline. Keys are revocable by adding the txnid to
// events/licenses/revoked.json in the metrics repo (checked on verify).

export type Plan = "monthly" | "yearly" | "lifetime";

export interface LicensePayload {
  v: 1;
  e: string; // email
  p: Plan;
  t: string; // PayU txnid
  iat: number;
  exp: number; // 0 = never
}

// INR pricing (PayU settles in INR). Keep in sync with the website #pro section.
export const PLANS: Record<Plan, { amountInr: number; label: string; days: number }> = {
  monthly: { amountInr: 249, label: "Nerva Pro — monthly", days: 31 },
  yearly: { amountInr: 1999, label: "Nerva Pro — yearly", days: 366 },
  lifetime: { amountInr: 4999, label: "Nerva Pro — lifetime", days: 0 },
};

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

export function secret(): string | null {
  return (
    (globalThis as { process?: { env?: Record<string, string> } }).process?.env
      ?.LICENSE_SIGNING_SECRET ?? null
  );
}

export async function issueLicense(p: Omit<LicensePayload, "v" | "iat">): Promise<string> {
  const s = secret();
  if (!s) throw new Error("LICENSE_SIGNING_SECRET not configured");
  const payload: LicensePayload = { v: 1, iat: Math.floor(Date.now() / 1000), ...p };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = b64url(await hmac(s, body));
  return `NERVA-${body}.${sig}`;
}

export async function verifyLicense(
  key: string,
): Promise<{ ok: true; payload: LicensePayload } | { ok: false; reason: string }> {
  const s = secret();
  if (!s) return { ok: false, reason: "server not configured" };
  const m = /^NERVA-([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(key.trim());
  if (!m) return { ok: false, reason: "malformed key" };
  const [, body, sig] = m;
  const expected = b64url(await hmac(s, body));
  if (expected.length !== sig.length) return { ok: false, reason: "bad signature" };
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return { ok: false, reason: "bad signature" };
  let payload: LicensePayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(unb64url(body))) as LicensePayload;
  } catch {
    return { ok: false, reason: "bad payload" };
  }
  if (payload.v !== 1 || !payload.t || !payload.p) return { ok: false, reason: "bad payload" };
  if (payload.exp && payload.exp * 1000 < Date.now()) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}

export function expiryFor(plan: Plan, fromMs = Date.now()): number {
  const d = PLANS[plan].days;
  return d === 0 ? 0 : Math.floor((fromMs + d * 86_400_000) / 1000);
}

// ---------- device activations + signed device tokens ----------
//
// A licence key alone never unlocks the app. The app registers a device
// (`/api/license-activate`) and receives a short-lived DEVICE TOKEN signed
// with ECDSA P-256 (private JWK in LICENSE_SIGNING_JWK). The Rust core
// verifies the signature with the embedded public key, checks the token is
// for THIS device id and not expired, and only then reports Pro. Tokens
// last 30 days and are refreshed silently while online; revocation = the
// next refresh fails.

/** Max simultaneously activated devices per plan. */
export const DEVICE_LIMIT: Record<Plan, number> = { monthly: 2, yearly: 3, lifetime: 5 };
export const TOKEN_TTL_S = 30 * 24 * 3600;

export interface DeviceRecord {
  id: string;
  name: string;
  os: string;
  first_seen: string;
  last_seen: string;
  app_version?: string;
}

export interface ActivationDoc {
  txnid: string;
  plan: Plan;
  devices: DeviceRecord[];
}

export interface DeviceTokenPayload {
  v: 1;
  t: string; // txnid (licence id)
  p: Plan;
  d: string; // device id
  h: string; // email hint
  lexp: number; // licence expiry (unix s, 0 = never)
  exp: number; // token expiry (unix s)
  iat: number;
}

async function signingKey(): Promise<CryptoKey | null> {
  const raw = (globalThis as { process?: { env?: Record<string, string> } }).process?.env
    ?.LICENSE_SIGNING_JWK;
  if (!raw) return null;
  try {
    const jwk = JSON.parse(raw) as JsonWebKey;
    return await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  } catch {
    return null;
  }
}

export async function signDeviceToken(p: Omit<DeviceTokenPayload, "v" | "iat" | "exp">): Promise<string | null> {
  const key = await signingKey();
  if (!key) return null;
  const now = Math.floor(Date.now() / 1000);
  const payload: DeviceTokenPayload = { v: 1, iat: now, exp: now + TOKEN_TTL_S, ...p };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  // WebCrypto returns raw r||s (64 bytes) — exactly what p256::ecdsa::Signature::from_slice expects.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(body)));
  return `NVT1.${body}.${b64url(sig)}`;
}

export function emailHint(email: string): string {
  const at = email.indexOf("@");
  return at > 1 ? `${email[0]}…${email.slice(at - 1)}` : "";
}

/** Short HMAC over a txnid — gates the invoice URL emailed to the buyer. */
export async function invoiceSig(txnid: string): Promise<string> {
  const s = secret();
  if (!s) return "";
  return b64url(await hmac(s, `invoice|${txnid}`)).slice(0, 22);
}
