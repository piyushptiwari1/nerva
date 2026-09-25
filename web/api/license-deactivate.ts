// Remove a device from a licence so the slot can be reused elsewhere.
//   POST { key, device_id }  → 200 { devices: [...] , limit }
// The removed device's token keeps working until it expires (≤30 days) or
// it tries to refresh — at which point activation is required again.

export const config = { runtime: "edge" };

import { readJson, writeJson } from "./_lib/metrics";
import { DEVICE_LIMIT, verifyLicense, type ActivationDoc } from "./_lib/license";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "content-type": "application/json",
  "cache-control": "no-store",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: cors });

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let b: { key?: string; device_id?: string };
  try {
    b = (await req.json()) as typeof b;
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const key = String(b.key ?? "").trim();
  const deviceId = String(b.device_id ?? "").trim();
  if (!key || !deviceId || key.length > 2048 || deviceId.length > 64) return json({ error: "bad request" }, 400);

  const v = await verifyLicense(key);
  if (!v.ok) return json({ error: v.reason });

  const path = `licenses/activations/${v.payload.t}.json`;
  const existing = await readJson<ActivationDoc>(path);
  const doc: ActivationDoc = existing?.data ?? { txnid: v.payload.t, plan: v.payload.p, devices: [] };
  const before = doc.devices.length;
  doc.devices = doc.devices.filter((d) => d.id !== deviceId);
  if (doc.devices.length !== before) {
    await writeJson(path, doc, `deactivate ${v.payload.t} (${doc.devices.length})`, existing?.sha);
  }
  return json({
    limit: DEVICE_LIMIT[v.payload.p],
    devices: doc.devices.map((d) => ({ id: d.id, name: d.name, os: d.os, last_seen: d.last_seen })),
  });
}
