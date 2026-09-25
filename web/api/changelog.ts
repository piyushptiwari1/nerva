// Serve the repository CHANGELOG.md as a simple HTML page at /changelog.
// Fetched live from the main branch so the website never lags a release.

export const config = { runtime: "edge" };

const RAW = "https://raw.githubusercontent.com/piyushptiwari1/nerva/main/CHANGELOG.md";

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

function mdToHtml(md: string): string {
  const out: string[] = [];
  let inList = false;
  for (const line of md.split("\n")) {
    if (/^- /.test(line)) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    }
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
    if (/^### /.test(line)) out.push(`<h3>${inline(line.slice(4))}</h3>`);
    else if (/^## /.test(line)) out.push(`<h2 id="${esc(line.slice(3).split(" ")[0])}">${inline(line.slice(3))}</h2>`);
    else if (/^# /.test(line)) out.push(`<h1>${inline(line.slice(2))}</h1>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (inList) out.push("</ul>");
  return out.join("\n");
}

function inline(s: string): string {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

export default async function handler(): Promise<Response> {
  let md = "# Changelog\n\nUnavailable right now.";
  try {
    const res = await fetch(RAW, { headers: { "user-agent": "nerva-web" } });
    if (res.ok) md = await res.text();
  } catch {
    /* fall through */
  }
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<title>Changelog — Nerva by Bytical</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="description" content="Release notes for Nerva by Bytical — the free, offline-first focus workspace for Linux and Windows."/>
<link rel="canonical" href="https://nerva.bytical.ai/changelog"/>
<link rel="icon" href="/favicon.ico"/>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Roboto,sans-serif;background:#0a0b0d;color:#ecf0f6;margin:0;padding:48px 20px;line-height:1.6}
main{max-width:760px;margin:0 auto}
h1{font-size:32px;letter-spacing:-.02em;margin:0 0 8px}
h2{font-size:22px;margin:40px 0 8px;padding-top:24px;border-top:1px solid rgba(255,255,255,.08)}
h3{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#8a93a6;margin:20px 0 6px}
p{color:#a8acb4}
ul{padding-left:20px;color:#cbd1dc}li{margin:6px 0}
code{background:rgba(255,255,255,.07);padding:1px 5px;border-radius:4px;font-size:.9em}
a{color:#7c9cff}
.nav{color:#8a93a6;font-size:14px;margin-bottom:24px}
</style></head><body><main>
<div class="nav"><a href="/">← nerva.bytical.ai</a> · <a href="https://github.com/piyushptiwari1/nerva/releases">GitHub releases</a> · <a href="/#download">Download</a></div>
${mdToHtml(md)}
</main></body></html>`;
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300, s-maxage=600" },
  });
}
