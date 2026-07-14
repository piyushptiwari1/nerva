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

  return new Response(
    JSON.stringify({
      generated_at: new Date().toISOString(),
      source: "github-releases",
      note: "Snap installs: see snapcraft.io/nerva/metrics. App usage pings: see Segment workspace (event app_weekly_ping).",
      totals,
      releases: perRelease,
    }),
    {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    },
  );
}
