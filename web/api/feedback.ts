// Feedback ingest — ratings, feature requests and bug reports from the
// desktop app (src/lib/feedback.ts), the website /feedback form, and the
// Android app later.
//
// Contract:
//   POST { kind: "rating"|"feature"|"bug"|"other", stars?: 1..5, text?: string,
//          email?: string, app_version?: string, os?: string, theme?: string,
//          anon_id?: uuid, source?: "app"|"web" }
//
// Rules:
//   - Free text is capped at 2000 chars, email at 120 chars (validated shape).
//   - Everything is length-checked and type-checked; unknown keys dropped.
//   - Coarse rate limit per IP hash (no raw IP stored): 10 submissions / hour.
//   - Stored in the private nerva-metrics repo (events/feedback/*.json) and
//     mirrored as a Segment track event WITHOUT the free text / email, so the
//     analytics sink only ever sees kind + stars + version + os.

export const config = { runtime: "edge" };

import { appendEvent, dummyName, geoOf, segmentTrack } from "./_lib/metrics";

const KINDS = new Set(["rating", "feature", "bug", "other"]);
const MAX_TEXT = 2000;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,64}\.[^\s@]{2,24}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Edge isolates are ephemeral; this is a soft limiter that catches loops and
// scripts, not a hard guarantee. Good enough for a feedback form.
const bucket = new Map<string, { n: number; reset: number }>();
const LIMIT = 10;
const WINDOW_MS = 60 * 60 * 1000;

async function ipHash(req: Request): Promise<string> {
  const ip =
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "0.0.0.0";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("nerva|" + ip));
  return Array.from(new Uint8Array(buf).slice(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function rateLimited(key: string): boolean {
  const now = Date.now();
  const b = bucket.get(key);
  if (!b || b.reset < now) {
    bucket.set(key, { n: 1, reset: now + WINDOW_MS });
    return false;
  }
  b.n += 1;
  return b.n > LIMIT;
}

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export default async function handler(
  req: Request,
  ctx?: { waitUntil?: (p: Promise<unknown>) => void },
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return new Response(null, { status: 405, headers: cors });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return new Response("bad json", { status: 400, headers: cors });
  }

  const kind = typeof body.kind === "string" && KINDS.has(body.kind) ? body.kind : null;
  if (!kind) return new Response("bad kind", { status: 400, headers: cors });

  const stars =
    typeof body.stars === "number" && Number.isInteger(body.stars) && body.stars >= 1 && body.stars <= 5
      ? body.stars
      : undefined;
  if (kind === "rating" && stars === undefined) {
    return new Response("rating needs stars", { status: 400, headers: cors });
  }
  const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_TEXT) : undefined;
  if (kind !== "rating" && !text) {
    return new Response("text required", { status: 400, headers: cors });
  }
  const email =
    typeof body.email === "string" && body.email.length <= 120 && EMAIL_RE.test(body.email.trim())
      ? body.email.trim()
      : undefined;
  const short = (k: string, max = 24) =>
    typeof body[k] === "string" && (body[k] as string).length <= max ? (body[k] as string) : undefined;
  const anon = typeof body.anon_id === "string" && UUID_RE.test(body.anon_id) ? body.anon_id : undefined;

  const key = await ipHash(req);
  if (rateLimited(key)) return new Response("slow down", { status: 429, headers: cors });

  const { country, city } = geoOf(req);
  const stored = {
    ts: new Date().toISOString(),
    kind,
    stars,
    text,
    email,
    app_version: short("app_version"),
    os: short("os"),
    theme: short("theme", 10),
    source: short("source") ?? "app",
    user: anon ? dummyName(anon) : `anon-${key.slice(0, 6)}`,
    country,
    city,
  };
  const work = Promise.all([
    appendEvent("feedback", stored),
    segmentTrack(anon ?? `feedback-${key}`, "feedback_submitted", {
      kind,
      stars,
      app_version: stored.app_version,
      os: stored.os,
      source: stored.source,
      has_text: !!text,
      country,
    }),
  ]);
  if (ctx?.waitUntil) ctx.waitUntil(work);
  else await work;

  return new Response(null, { status: 204, headers: cors });
}
