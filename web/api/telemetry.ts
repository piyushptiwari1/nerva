// In-app telemetry ingest — receives the weekly opt-in usage ping from the
// Nerva desktop app and forwards it to Segment's HTTP tracking API.
//
// Contract with the app (src/lib/telemetry.ts):
//   POST { anonymousId: string, properties: object }
//
// Privacy rules enforced server-side (defense in depth — the app already
// promises this in the consent dialog):
//   - Only a whitelisted set of numeric/short-string properties is forwarded.
//     Free-text fields are dropped, so note/task contents can never leak even
//     if a modified client sends them.
//   - No IP-based geo enrichment is requested; Segment's default context is
//     minimal for server-side events.
//
// The Segment write key is public by design (same key the website snippet
// uses); the source is write-only.

export const config = { runtime: "edge" };

const SEGMENT_WRITE_KEY = "TCz9WfbBHAUOuOYYrfgbcGGDBfLRBlqR";

// Whitelist: property name → validator.
const ALLOWED: Record<string, (v: unknown) => boolean> = {
  app_version: (v) => typeof v === "string" && v.length <= 20,
  os: (v) => typeof v === "string" && v.length <= 20,
  arch: (v) => typeof v === "string" && v.length <= 20,
  locale: (v) => typeof v === "string" && v.length <= 20,
  theme: (v) => typeof v === "string" && v.length <= 10,
  channel: (v) => typeof v === "string" && v.length <= 20,
  n_workspaces: (v) => typeof v === "number" && v >= 0,
  n_timers: (v) => typeof v === "number" && v >= 0,
  n_notes: (v) => typeof v === "number" && v >= 0,
  n_tasks: (v) => typeof v === "number" && v >= 0,
  n_habits: (v) => typeof v === "number" && v >= 0,
  completed_timers_7d: (v) => typeof v === "number" && v >= 0,
  completed_tasks_7d: (v) => typeof v === "number" && v >= 0,
  focus_ms_7d: (v) => typeof v === "number" && v >= 0,
  ai_enabled: (v) => typeof v === "boolean",
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(null, { status: 405 });
  }
  let anonymousId = "";
  let properties: Record<string, unknown> = {};
  try {
    const body = (await req.json()) as {
      anonymousId?: string;
      properties?: Record<string, unknown>;
    };
    anonymousId = body.anonymousId ?? "";
    properties = body.properties ?? {};
  } catch {
    return new Response(null, { status: 400 });
  }
  // Anonymous id must look like a UUID — anything else is rejected.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(anonymousId)) {
    return new Response(null, { status: 400 });
  }
  const clean: Record<string, unknown> = {};
  for (const [k, validate] of Object.entries(ALLOWED)) {
    if (k in properties && validate(properties[k])) clean[k] = properties[k];
  }

  const res = await fetch("https://api.segment.io/v1/track", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Basic " + btoa(SEGMENT_WRITE_KEY + ":"),
    },
    body: JSON.stringify({
      anonymousId,
      event: "app_weekly_ping",
      properties: clean,
      timestamp: new Date().toISOString(),
    }),
  });
  return new Response(null, { status: res.ok ? 204 : 502 });
}
