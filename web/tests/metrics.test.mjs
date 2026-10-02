import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const compiled = await build({
  entryPoints: [fileURLToPath(new URL("../api/_lib/metrics.ts", import.meta.url))],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const source = Buffer.from(compiled.outputFiles[0].text).toString("base64");

const blob = (values) => Response.json({ encoding: "base64", content: Buffer.from(JSON.stringify(values)).toString("base64") });

test("shared windows fetch only existing dates with bounded concurrency", async (context) => {
  const originalToken = process.env.GH_METRICS_TOKEN;
  process.env.GH_METRICS_TOKEN = "test-only-token";
  context.after(() => {
    if (originalToken === undefined) delete process.env.GH_METRICS_TOKEN;
    else process.env.GH_METRICS_TOKEN = originalToken;
  });
  const kinds = ["downloads", "pings", "feedback", "licenses"];
  const files = Array.from({ length: 20 }, (_, index) => {
    const day = new Date(Date.now() - Math.floor(index / 4) * 86_400_000).toISOString().slice(0, 10);
    return { type: "blob", path: `events/${kinds[index % 4]}/${day}.json`, sha: index.toString(16).padStart(40, "0") };
  });
  const ignored = ["events/licenses/2000-01-01.json", "events/downloads/9999-01-01.json", "licenses/private.json"];
  const tree = [...files, ...ignored.map((path) => ({ type: "blob", path, sha: "f".repeat(40) }))];
  let active = 0;
  let peak = 0;
  const requests = [];
  context.mock.method(globalThis, "fetch", async (url) => {
    requests.push(String(url));
    if (String(url).includes("/git/trees/")) return Response.json({ tree, truncated: false });
    active++;
    peak = Math.max(active, peak);
    await new Promise(setImmediate);
    active--;
    const file = files.find((file) => String(url).endsWith(file.sha));
    assert.ok(file, "only indexed files inside requested windows may be read");
    return blob([{ kind: file.path.split("/")[1], title: "Unicode: café" }]);
  });
  const { readEventWindows } = await import(`data:text/javascript;base64,${source}#bounded`);
  const result = await readEventWindows({ downloads: 30, pings: 30, feedback: 90, licenses: 365 });
  assert.equal(requests.length, 21);
  assert.ok(peak <= 6);
  assert.ok(peak > 1);
  assert.deepEqual(result.incomplete, []);
  for (const kind of kinds) {
    assert.equal(result.events[kind].length, 5);
    assert.equal(result.events[kind][0].title, "Unicode: café");
  }
});

test("invalid records are skipped and explicitly mark their source incomplete", async (context) => {
  const originalToken = process.env.GH_METRICS_TOKEN;
  process.env.GH_METRICS_TOKEN = "test-only-token";
  context.after(() => {
    if (originalToken === undefined) delete process.env.GH_METRICS_TOKEN;
    else process.env.GH_METRICS_TOKEN = originalToken;
  });
  const today = new Date().toISOString().slice(0, 10);
  context.mock.method(globalThis, "fetch", async (url) => String(url).includes("/git/trees/")
    ? Response.json({ tree: [{ type: "blob", path: `events/licenses/${today}.json`, sha: "a".repeat(40) }], truncated: false })
    : blob([null, 1, [], { plan: "monthly", amount: 249 }]));
  const { readEventWindows } = await import(`data:text/javascript;base64,${source}#invalid`);
  const result = await readEventWindows({ licenses: 365 });
  assert.deepEqual(result.events.licenses, [{ plan: "monthly", amount: 249 }]);
  assert.deepEqual(result.incomplete, ["licenses"]);
});

test("an empty annual metrics window needs one index request, not 365 daily requests", async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.GH_METRICS_TOKEN;
  process.env.GH_METRICS_TOKEN = "test-only-token";
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return Response.json({ tree: [], truncated: false });
  };
  try {
    const { readEvents } = await import(`data:text/javascript;base64,${source}#empty`);
    assert.deepEqual(await readEvents("licenses", 365), []);
    assert.equal(requests.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.GH_METRICS_TOKEN;
    else process.env.GH_METRICS_TOKEN = originalToken;
  }
});