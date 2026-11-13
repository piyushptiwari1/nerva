// Fallback updater manifest: mirrors `latest.json` from the latest GitHub
// release so the Tauri updater has a second endpoint when GitHub's release
// download front end is unreachable (it 504'd for hours on 2026-11-08 while
// the GitHub API stayed up). The signature inside the JSON is what the app
// verifies, so mirroring the bytes does not weaken the trust chain.
//
// Two independent fetch paths, tried in order:
//   1. GitHub API asset endpoint (api.github.com, Accept: octet-stream) —
//      a different host than github.com/releases/download.
//   2. github.com/releases/download (the normal URL).
// The last good manifest is kept in edge cache (s-maxage + stale-if-error)
// so a GitHub outage still serves the previous answer.

export const config = { runtime: "edge" };

const REPO = "piyushptiwari1/nerva";
const UA = { "User-Agent": "nerva-vercel-updater-mirror" };

interface Asset { id: number; name: string; browser_download_url: string }
interface Release { tag_name: string; assets: Asset[] }

async function fetchText(url: string, init: RequestInit, ms: number): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function isManifest(s: string | null): s is string {
  if (!s) return false;
  try {
    const d = JSON.parse(s);
    return typeof d?.version === "string" && d?.platforms && typeof d.platforms === "object";
  } catch {
    return false;
  }
}

export default async function handler(): Promise<Response> {
  const relText = await fetchText(
    `https://api.github.com/repos/${REPO}/releases/latest`,
    { headers: { ...UA, Accept: "application/vnd.github+json" } },
    6000,
  );
  let body: string | null = null;
  let source = "";
  if (relText) {
    let rel: Release | null = null;
    try { rel = JSON.parse(relText) as Release; } catch { rel = null; }
    const asset = rel?.assets.find((a) => a.name === "latest.json");
    if (rel && asset) {
      body = await fetchText(
        `https://api.github.com/repos/${REPO}/releases/assets/${asset.id}`,
        { headers: { ...UA, Accept: "application/octet-stream" }, redirect: "follow" },
        8000,
      );
      source = "api";
      if (!isManifest(body)) {
        body = await fetchText(asset.browser_download_url, { headers: UA, redirect: "follow" }, 8000);
        source = "download";
      }
    }
  }
  if (!isManifest(body)) {
    // Non-2xx lets the CDN serve its stale copy (stale-if-error) instead of this.
    return new Response("upstream unavailable\n", { status: 502, headers: { "cache-control": "no-store" } });
  }
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Fresh for 5 min at the edge; keep serving the last good copy for a week if GitHub is down.
      "cache-control": "public, max-age=0, s-maxage=300, stale-while-revalidate=3600, stale-if-error=604800",
      "x-nerva-source": source,
    },
  });
}
