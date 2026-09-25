// Device activation for Nerva Pro.
//
//   POST { key, device_id, device_name?, os?, app_version? }
//     → 200 { token, plan, lexp, devices: [...], limit }
//     → 200 { error: "device_limit", devices: [...], limit }   (pick one to deactivate)
//     → 200 { error: "invalid" | "expired" | "revoked" | "malformed key" }
//     → 503 when LICENSE_SIGNING_JWK is missing
//
//   Re-activating an already-registered device never consumes a slot — the
//   app calls this every ~20 days to refresh its 30-day token.
//
// State lives in the private metrics repo: licenses/activations/<txnid>.json.

export const config = { runtime: "edge" };

import { readJson, writeJson } from "./_lib/metrics";
import {
  DEVICE_LIMIT,
  emailHint,
  signDeviceToken,
  verifyLicense,
  type ActivationDoc,
  type DeviceRecord,
} from "./_lib/license";
import { isRevoked } from "./_lib/revoked";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "content-type": "application/json",
  "cache-control": "no-store",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: cors });
const DEVICE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  let b: { key?: string; device_id?: string; device_name?: string; os?: string; app_version?: string };
  try {
    b = (await req.json()) as typeof b;
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const key = String(b.key ?? "").trim();
  const deviceId = String(b.device_id ?? "").trim();
  if (key.length > 2048 || !DEVICE_ID_RE.test(deviceId)) return json({ error: "bad request" }, 400);

  const v = await verifyLicense(key);
  if (!v.ok) return json({ error: v.reason });
  if (await isRevoked(v.payload.t)) return json({ error: "revoked" });

  const path = `licenses/activations/${v.payload.t}.json`;
  const existing = await readJson<ActivationDoc>(path);
  const doc: ActivationDoc = existing?.data ?? { txnid: v.payload.t, plan: v.payload.p, devices: [] };
  const limit = DEVICE_LIMIT[v.payload.p];
  const now = new Date().toISOString();
  const name = String(b.device_name ?? "").slice(0, 60) || "Unnamed device";
  const os = String(b.os ?? "").slice(0, 20);
  const appVersion = String(b.app_version ?? "").slice(0, 20);

  const publicDevices = (ds: DeviceRecord[]) =>
    ds.map((d) => ({ id: d.id, name: d.name, os: d.os, last_seen: d.last_seen, this_device: d.id === deviceId }));

  let dev = doc.devices.find((d) => d.id === deviceId);
  if (!dev) {
    if (doc.devices.length >= limit) {
      return json({ error: "device_limit", limit, devices: publicDevices(doc.devices) });
    }
    dev = { id: deviceId, name, os, first_seen: now, last_seen: now, app_version: appVersion };
    doc.devices.push(dev);
  } else {
    dev.last_seen = now;
    if (name !== "Unnamed device") dev.name = name;
    if (os) dev.os = os;
    if (appVersion) dev.app_version = appVersion;
  }
  // Best-effort persistence; a failed write still returns a token so a
  // GitHub hiccup never locks a paying user out.
  await writeJson(path, doc, `activate ${v.payload.t} (${doc.devices.length}/${limit})`, existing?.sha);

  const token = await signDeviceToken({
    t: v.payload.t,
    p: v.payload.p,
    d: deviceId,
    h: emailHint(v.payload.e),
    lexp: v.payload.exp,
  });
  if (!token) return json({ error: "server not configured (LICENSE_SIGNING_JWK)" }, 503);

  return json({ token, plan: v.payload.p, lexp: v.payload.exp, limit, devices: publicDevices(doc.devices) });
}
