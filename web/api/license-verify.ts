// Licence verification (key only — does NOT unlock the app; see
// license-activate for device tokens). Used by the website "check my key"
// helper and as a lightweight health probe.
//
//   POST { key: string }  →  200 { valid: true, plan, email_hint, exp }
//                         →  200 { valid: false, reason }
//
// Revocation: add a txnid to licenses/revoked.json in the metrics repo.

export const config = { runtime: "edge" };

import { verifyLicense } from "./_lib/license";
import { isRevoked } from "./_lib/revoked";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "content-type": "application/json",
  "cache-control": "no-store",
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return new Response(null, { status: 405, headers: cors });
  let key = "";
  try {
    key = String(((await req.json()) as { key?: string }).key ?? "");
  } catch {
    return new Response(JSON.stringify({ valid: false, reason: "bad json" }), { status: 400, headers: cors });
  }
  if (key.length > 2048) {
    return new Response(JSON.stringify({ valid: false, reason: "too long" }), { status: 400, headers: cors });
  }
  const v = await verifyLicense(key);
  if (!v.ok) return new Response(JSON.stringify({ valid: false, reason: v.reason }), { headers: cors });
  if (await isRevoked(v.payload.t)) {
    return new Response(JSON.stringify({ valid: false, reason: "revoked" }), { headers: cors });
  }
  const email = v.payload.e;
  const at = email.indexOf("@");
  const hint = at > 1 ? `${email[0]}…${email.slice(at - 1)}` : "";
  return new Response(
    JSON.stringify({ valid: true, plan: v.payload.p, exp: v.payload.exp, email_hint: hint, txnid: v.payload.t }),
    { headers: cors },
  );
}
