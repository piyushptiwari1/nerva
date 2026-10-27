// Anonymous daily launch beacon — the only signal sent by default.
//
// Contract with the app (src/lib/telemetry.ts → sendLaunchBeacon):
//   POST { app_version, os, platform, locale }
//
// Deliberately has no identifier of any kind: no anonymous id, no device
// fingerprint, no cookie. The server adds only Vercel's country header and
// the receive date. That makes "launch-days" countable (one row per
// installation per day) without being able to follow an installation.

export const config = { runtime: "edge" };

import { appendEvent, geoOf } from "./_lib/metrics";

const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]{1,20})?$/;
const OS = new Set(["linux", "windows", "macos", "android", "ios", "unknown"]);
const PLATFORM = new Set(["desktop", "android", "ios", "web"]);
const LOCALE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/;

// The desktop webview posts from tauri://localhost and Android from
// http(s)://tauri.localhost; browsers treat both as cross-origin.
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "no-store",
};

export default async function handler(
  req: Request,
  ctx?: { waitUntil?: (p: Promise<unknown>) => void },
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return new Response(null, { status: 405, headers: cors });
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return new Response(null, { status: 400, headers: cors });
    body = parsed as Record<string, unknown>;
  } catch {
    return new Response(null, { status: 400, headers: cors });
  }
  const version = body.app_version;
  const os = body.os;
  const platform = body.platform;
  const locale = body.locale;
  if (typeof version !== "string" || !VERSION.test(version)) return new Response(null, { status: 400, headers: cors });
  if (typeof os !== "string" || !OS.has(os)) return new Response(null, { status: 400, headers: cors });
  if (typeof platform !== "string" || !PLATFORM.has(platform)) return new Response(null, { status: 400, headers: cors });
  const { country } = geoOf(req);
  const stored = {
    ts: new Date().toISOString(),
    app_version: version,
    os,
    platform,
    // Language only; the region part can narrow a user down more than needed.
    locale: typeof locale === "string" && LOCALE.test(locale) ? locale.split("-")[0].toLowerCase() : "unknown",
    country,
  };
  const log = appendEvent("launches", stored);
  if (ctx?.waitUntil) ctx.waitUntil(log);
  else void log;
  return new Response(null, { status: 204, headers: cors });
}
