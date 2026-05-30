// Edge proxy for Nerva binary downloads.
//
// Why this exists:
//   The public download URLs (nerva.bytical.ai/download/...) used to be
//   Vercel `rewrites` pointing at GitHub release URLs. Vercel turns
//   cross-origin rewrites into 308 redirects, so the user's browser ended
//   up on github.com — making it look like the binaries were hosted on
//   GitHub rather than nerva.bytical.ai.
//
// This Edge Function streams the release artifact back through Vercel's
// edge network so the bytes (and the browser's Save-As dialog) stay on
// the bytical.ai domain. The GitHub release remains the source of truth
// — only the bandwidth is fronted.
//
// URL surface:
//   /api/download?p=linux&f=deb       → Nerva_<ver>_amd64.deb
//   /api/download?p=linux&f=appimage  → Nerva_<ver>_amd64.AppImage
//   /api/download?p=linux&f=rpm       → Nerva-<ver>-1.x86_64.rpm
//   /api/download?p=windows&f=msi     → Nerva_<ver>_x64_en-US.msi
//   /api/download?p=windows&f=exe     → Nerva_<ver>_x64-setup.exe
//   /api/download?p=cert              → bytical-codesign.crt
//
// `vercel.json` rewrites the public /download/... paths onto this handler.

export const config = { runtime: "edge" };

const REPO = "piyushptiwari1/nerva";

// Filename templates per platform/format. `{v}` is replaced with the
// resolved version (e.g. "0.1.1").
const FILES: Record<string, Record<string, string>> = {
  linux: {
    deb: "Nerva_{v}_amd64.deb",
    appimage: "Nerva_{v}_amd64.AppImage",
    rpm: "Nerva-{v}-1.x86_64.rpm",
  },
  windows: {
    msi: "Nerva_{v}_x64_en-US.msi",
    exe: "Nerva_{v}_x64-setup.exe",
  },
  cert: {
    // No version in the cert filename.
    crt: "bytical-codesign.crt",
  },
};

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}
interface Release {
  tag_name: string;
  assets: ReleaseAsset[];
}

let cachedRelease: { at: number; data: Release } | null = null;
const CACHE_TTL_MS = 60 * 1000; // 1 minute

async function getLatestRelease(): Promise<Release> {
  const now = Date.now();
  if (cachedRelease && now - cachedRelease.at < CACHE_TTL_MS) {
    return cachedRelease.data;
  }
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { "User-Agent": "nerva-vercel-proxy" },
    // Keep release metadata fresh so a new tag is picked up quickly.
    cf: { cacheTtl: 60 },
  } as RequestInit);
  if (!res.ok) {
    throw new Error(`GitHub releases API ${res.status}`);
  }
  const data = (await res.json()) as Release;
  cachedRelease = { at: now, data };
  return data;
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const platform = (url.searchParams.get("p") || "").toLowerCase();
  const format = (url.searchParams.get("f") || "").toLowerCase();

  const platformFiles = FILES[platform];
  if (!platformFiles) {
    return new Response("Unknown platform. Try p=linux|windows|cert.\n", { status: 404 });
  }
  // For `cert`, default format = `crt`.
  const fileKey = format || (platform === "cert" ? "crt" : "");
  const template = platformFiles[fileKey];
  if (!template) {
    return new Response(
      `Unknown format for ${platform}. Try f=${Object.keys(platformFiles).join("|")}.\n`,
      { status: 404 },
    );
  }

  let release: Release;
  try {
    release = await getLatestRelease();
  } catch (err) {
    return new Response(`Failed to resolve latest release: ${err}\n`, { status: 502 });
  }

  const version = release.tag_name.replace(/^v/, "");
  const filename = template.replace("{v}", version);

  // Find the asset by name. If template doesn't match the actual published
  // asset (e.g. naming convention changed in a future release), fall back
  // to a substring match so the proxy keeps working through small renames.
  const asset =
    release.assets.find((a) => a.name === filename) ??
    release.assets.find((a) => a.name.includes(template.replace("{v}", "")));

  if (!asset) {
    return new Response(
      `Asset ${filename} not found in release ${release.tag_name}.\n`,
      { status: 404 },
    );
  }

  // Stream the binary through. `Content-Disposition: attachment` makes the
  // browser save it instead of trying to render it.
  const upstream = await fetch(asset.browser_download_url, {
    redirect: "follow",
    cf: { cacheTtl: 300 },
  } as RequestInit);

  if (!upstream.ok || !upstream.body) {
    return new Response(`Upstream ${upstream.status} fetching ${asset.name}\n`, {
      status: 502,
    });
  }

  const headers = new Headers();
  headers.set(
    "Content-Type",
    upstream.headers.get("Content-Type") ?? "application/octet-stream",
  );
  const len = upstream.headers.get("Content-Length");
  if (len) headers.set("Content-Length", len);
  headers.set("Content-Disposition", `attachment; filename="${asset.name}"`);
  // Cache on the edge briefly so "latest" flips quickly after a new release.
  // Browser-side max-age stays 0 so users always revalidate.
  headers.set("Cache-Control", "public, max-age=0, s-maxage=300");
  headers.set("X-Nerva-Release", release.tag_name);

  return new Response(upstream.body, { status: 200, headers });
}
