// Password-gated download-stats API for the hidden /data page.
//
// POST { password: string }  →  200 { totals, releases } | 401
//
// The password is never stored in plaintext in this (public) repo — only its
// SHA-256 hash. Override with the DATA_PASSWORD_SHA256 env var in Vercel to
// rotate the password without a code change.
//
// Data sources:
//   - GitHub Releases API → per-asset download counts (deb/AppImage/rpm/msi/exe)
//     for every published release. These are the direct-download numbers.
//   - Snap Store / AUR / winget installs are NOT visible here: Snap metrics
//     live in snapcraft.io/nerva/metrics (publisher dashboard), AUR does not
//     track downloads, winget PRs route users to the same GitHub assets.

export const config = { runtime: "edge" };

import { readEvents } from "./_lib/metrics";

const REPO = "piyushptiwari1/nerva";
// sha256("Bytical@1") — override via env DATA_PASSWORD_SHA256.
const DEFAULT_PW_SHA256 =
  "e7d426e003dc6c6a627606f1cf619051ac8101c55a2be8989771efc6e7794f96";

interface GhAsset {
  name: string;
  download_count: number;
  size: number;
  updated_at: string;
}
interface GhRelease {
  tag_name: string;
  published_at: string;
  assets: GhAsset[];
}

function classify(name: string): { platform: string; format: string } | null {
  const n = name.toLowerCase();
  if (n.endsWith(".deb")) return { platform: "linux", format: "deb" };
  if (n.endsWith(".appimage")) return { platform: "linux", format: "appimage" };
  if (n.endsWith(".rpm")) return { platform: "linux", format: "rpm" };
  if (n.endsWith(".msi")) return { platform: "windows", format: "msi" };
  if (n.endsWith(".exe")) return { platform: "windows", format: "exe" };
  // Skip .sig files, latest.json, source archives.
  return null;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405,
      headers: { "content-type": "application/json" },
    });
  }
  let password = "";
  try {
    const body = (await req.json()) as { password?: string };
    password = body.password ?? "";
  } catch {
    /* fall through to 401 */
  }
  const expected =
    (globalThis as { process?: { env?: Record<string, string> } }).process?.env
      ?.DATA_PASSWORD_SHA256 ?? DEFAULT_PW_SHA256;
  if (!password || (await sha256Hex(password)) !== expected.toLowerCase()) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  // Fetch every release (paginated; 100/page covers years of releases).
  const gh = await fetch(
    `https://api.github.com/repos/${REPO}/releases?per_page=100`,
    {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "nerva-data-page",
      },
    },
  );
  if (!gh.ok) {
    return new Response(JSON.stringify({ error: `github ${gh.status}` }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
  const releases = (await gh.json()) as GhRelease[];

  const totals: Record<string, Record<string, number>> = {};
  const perRelease = releases.map((r) => {
    const assets = r.assets
      .map((a) => {
        const c = classify(a.name);
        if (!c) return null;
        totals[c.platform] = totals[c.platform] ?? {};
        totals[c.platform][c.format] =
          (totals[c.platform][c.format] ?? 0) + a.download_count;
        return {
          name: a.name,
          platform: c.platform,
          format: c.format,
          downloads: a.download_count,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    return { tag: r.tag_name, published_at: r.published_at, assets };
  });

  // ---- tracked events (last 30 days, from the private metrics store) ----
  const [dlEvents, pingEvents] = await Promise.all([
    readEvents("downloads", 30),
    readEvents("pings", 30),
  ]);

  // Downloads: by day, by country, by platform (tracked window only).
  const byDay: Record<string, number> = {};
  const byCountry: Record<string, number> = {};
  const byPlatform30: Record<string, number> = {};
  for (const e of dlEvents) {
    const day = String(e.ts ?? "").slice(0, 10);
    if (day) byDay[day] = (byDay[day] ?? 0) + 1;
    const c = String(e.country ?? "??");
    byCountry[c] = (byCountry[c] ?? 0) + 1;
    const p = String(e.platform ?? "?") + "/" + String(e.format ?? "?");
    byPlatform30[p] = (byPlatform30[p] ?? 0) + 1;
  }

  // Usage: fold pings into one row per pseudonymous user (latest ping wins
  // for the property snapshot; first/last seen + ping count aggregated).
  interface UserRow {
    user: string;
    country: string;
    first_seen: string;
    last_seen: string;
    pings: number;
    props: Record<string, unknown>;
  }
  const users = new Map<string, UserRow>();
  for (const e of pingEvents) {
    const key = String(e.user ?? e.anonymousId ?? "unknown");
    const ts = String(e.ts ?? "");
    const { ts: _t, user: _u, anonymousId: _a, country, city: _c, ...props } =
      e as Record<string, unknown>;
    const row = users.get(key);
    if (!row) {
      users.set(key, {
        user: key,
        country: String(country ?? "??"),
        first_seen: ts,
        last_seen: ts,
        pings: 1,
        props,
      });
    } else {
      row.pings += 1;
      if (ts < row.first_seen) row.first_seen = ts;
      if (ts > row.last_seen) {
        row.last_seen = ts;
        row.props = props;
        row.country = String(country ?? row.country);
      }
    }
  }

  return new Response(
    JSON.stringify({
      generated_at: new Date().toISOString(),
      source: "github-releases + nerva-metrics(30d)",
      note: "Tracked downloads/pings start 2026-07-15 (older downloads exist only in the GitHub cumulative totals). Snap installs: snapcraft.io/nerva/metrics. Per-user timer/habit/note detail ships with the next app release.",
      totals,
      releases: perRelease,
      tracked: {
        window_days: 30,
        downloads_total: dlEvents.length,
        downloads_by_day: byDay,
        downloads_by_country: byCountry,
        downloads_by_platform: byPlatform30,
        recent_downloads: dlEvents
          .sort((a, b) => String(b.ts).localeCompare(String(a.ts)))
          .slice(0, 50),
      },
      usage: {
        window_days: 30,
        active_users: users.size,
        users: [...users.values()].sort((a, b) =>
          b.last_seen.localeCompare(a.last_seen),
        ),
      },
    }),
    {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    },
  );
}
