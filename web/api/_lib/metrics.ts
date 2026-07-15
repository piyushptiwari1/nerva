// Shared helpers for the internal metrics pipeline. Files under api/_lib are
// NOT deployed as routes (Vercel ignores underscore-prefixed paths in /api).
//
// Storage: a private GitHub repo (piyushptiwari1/nerva-metrics) written via
// the contents API using GH_METRICS_TOKEN (Vercel env, production). Events
// are appended into one JSON array file per day:
//   events/downloads/YYYY-MM-DD.json
//   events/pings/YYYY-MM-DD.json
// Low write volume makes the read-modify-write race window acceptable; a
// single retry handles the occasional 409 sha conflict.

const METRICS_REPO = "piyushptiwari1/nerva-metrics";
const SEGMENT_WRITE_KEY = "TCz9WfbBHAUOuOYYrfgbcGGDBfLRBlqR";

function ghHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "user-agent": "nerva-metrics",
    "content-type": "application/json",
  };
}

function b64encodeUtf8(s: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)));
}

function b64decodeUtf8(s: string): string {
  const bin = atob(s.replace(/\n/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Append one event to today's file for `kind`. Best-effort; never throws. */
export async function appendEvent(
  kind: "downloads" | "pings",
  event: Record<string, unknown>,
): Promise<void> {
  const token = (globalThis as { process?: { env?: Record<string, string> } })
    .process?.env?.GH_METRICS_TOKEN;
  if (!token) return;
  const day = new Date().toISOString().slice(0, 10);
  const api = `https://api.github.com/repos/${METRICS_REPO}/contents/events/${kind}/${day}.json`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      let sha: string | undefined;
      let arr: unknown[] = [];
      const res = await fetch(api, { headers: ghHeaders(token) });
      if (res.ok) {
        const j = (await res.json()) as { sha: string; content: string };
        sha = j.sha;
        try {
          arr = JSON.parse(b64decodeUtf8(j.content)) as unknown[];
        } catch {
          arr = [];
        }
      }
      arr.push(event);
      const put = await fetch(api, {
        method: "PUT",
        headers: ghHeaders(token),
        body: JSON.stringify({
          message: `${kind} +1 (${day})`,
          content: b64encodeUtf8(JSON.stringify(arr)),
          ...(sha ? { sha } : {}),
        }),
      });
      if (put.ok || put.status !== 409) return; // success or non-retryable
      // 409 = sha conflict (concurrent write) → loop once more
    } catch {
      return; // network failure — drop the event silently
    }
  }
}

/** Read all events of `kind` for the last `days` days. Missing days skipped. */
export async function readEvents(
  kind: "downloads" | "pings",
  days: number,
): Promise<Record<string, unknown>[]> {
  const token = (globalThis as { process?: { env?: Record<string, string> } })
    .process?.env?.GH_METRICS_TOKEN;
  if (!token) return [];
  const out: Record<string, unknown>[] = [];
  const fetches: Promise<void>[] = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    const api = `https://api.github.com/repos/${METRICS_REPO}/contents/events/${kind}/${day}.json`;
    fetches.push(
      (async () => {
        try {
          const res = await fetch(api, { headers: ghHeaders(token) });
          if (!res.ok) return;
          const j = (await res.json()) as { content: string };
          const arr = JSON.parse(b64decodeUtf8(j.content)) as Record<string, unknown>[];
          out.push(...arr);
        } catch {
          /* skip day */
        }
      })(),
    );
  }
  await Promise.all(fetches);
  return out;
}

/** Country/city from Vercel's edge geo headers. */
export function geoOf(req: Request): { country: string; city: string } {
  return {
    country: req.headers.get("x-vercel-ip-country") ?? "??",
    city: decodeURIComponent(req.headers.get("x-vercel-ip-city") ?? ""),
  };
}

const ADJECTIVES = [
  "crimson", "amber", "cobalt", "jade", "ivory", "onyx", "coral", "sage",
  "violet", "copper", "silver", "teal", "rusty", "misty", "golden", "azure",
];
const ANIMALS = [
  "otter", "falcon", "lynx", "panda", "heron", "badger", "fox", "orca",
  "wolf", "raven", "tiger", "koala", "mole", "ibis", "gecko", "bison",
];

/**
 * Deterministic friendly pseudonym from an anonymous UUID, so the internal
 * dashboard can follow one installation over time without any real identity
 * ("cobalt-heron-7", "rusty-fox-3", …).
 */
export function dummyName(anonymousId: string): string {
  let h = 0;
  for (let i = 0; i < anonymousId.length; i++) {
    h = (h * 31 + anonymousId.charCodeAt(i)) >>> 0;
  }
  const adj = ADJECTIVES[h % ADJECTIVES.length];
  const ani = ANIMALS[(h >>> 4) % ANIMALS.length];
  const num = (h >>> 8) % 100;
  return `${adj}-${ani}-${num}`;
}

/** Fire a server-side Segment track event. Best-effort. */
export async function segmentTrack(
  anonymousId: string,
  event: string,
  properties: Record<string, unknown>,
): Promise<void> {
  try {
    await fetch("https://api.segment.io/v1/track", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Basic " + btoa(SEGMENT_WRITE_KEY + ":"),
      },
      body: JSON.stringify({
        anonymousId,
        event,
        properties,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch {
    /* best effort */
  }
}
