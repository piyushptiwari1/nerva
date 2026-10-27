import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

globalThis.crypto ??= webcrypto;
const compiled = await build({ entryPoints: [fileURLToPath(new URL("../api/stats.ts", import.meta.url))], bundle: true, write: false, platform: "node", format: "esm" });
const { default: handler } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
const password = "test-password";
process.env.DATA_PASSWORD_SHA256 = createHash("sha256").update(password).digest("hex");
process.env.GH_METRICS_TOKEN = "test-only-token";
const request = (value = password) => new Request("https://example.test/api/stats", { method: "POST", body: JSON.stringify({ password: value }) });
const releases = [{ tag_name: "v0.1.14", published_at: "2026-09-26T00:00:00Z", assets: [{ name: "Nerva_0.1.14_android.apk", download_count: 3 }] }];

test("valid login returns counts with only two requests for empty metrics", async (context) => {
  const calls = [];
  context.mock.method(globalThis, "fetch", async (url) => {
    calls.push(String(url));
    return Response.json(String(url).includes("/releases?") ? releases : { tree: [], truncated: false });
  });
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const data = await response.json();
  assert.equal(data.totals.android.apk, 3);
  assert.equal(data.latest_version, "0.1.14");
  assert.deepEqual(data.incomplete_sources, []);
  assert.equal(calls.length, 2);
});

test("unauthorized and malformed passwords never query upstream data", async (context) => {
  const fetch = context.mock.method(globalThis, "fetch", async () => { throw new Error("must not fetch"); });
  for (const value of ["wrong", "", null, {}, 123]) assert.equal((await handler(request(value))).status, 401);
  assert.equal(fetch.mock.callCount(), 0);
});

test("network errors return a controlled retryable response, not an unhandled 500", async (context) => {
  context.mock.method(globalThis, "fetch", async () => { throw new Error("connection refused"); });
  const response = await handler(request());
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /retry/i);
});

test("unavailable tracked data is explicitly marked incomplete", async (context) => {
  context.mock.method(globalThis, "fetch", async (url) => String(url).includes("/releases?") ? Response.json(releases) : new Response(null, { status: 403 }));
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).incomplete_sources, ["downloads", "pings", "feedback", "licenses", "launches"]);
});

test("launch beacons aggregate into launch-days, peak daily and per-version adoption", async (context) => {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const rows = {
    [today]: [{ ts: `${today}T08:00:00Z`, app_version: "0.1.16", os: "linux", platform: "desktop", country: "IN" }, { ts: `${today}T09:00:00Z`, app_version: "0.1.16", os: "android", platform: "android", country: "DE" }],
    [yesterday]: [{ ts: `${yesterday}T08:00:00Z`, app_version: "0.1.15", os: "windows", platform: "desktop", country: "IN" }],
  };
  context.mock.method(globalThis, "fetch", async (url) => {
    const target = String(url);
    if (target.includes("/releases?")) return Response.json(releases);
    if (target.includes("/git/trees/")) return Response.json({ truncated: false, tree: Object.keys(rows).map((day) => ({ type: "blob", path: `events/launches/${day}.json`, sha: `${"a".repeat(30)}${day.replace(/-/g, "")}00` })) });
    const day = Object.keys(rows).find((d) => target.endsWith(`${"a".repeat(30)}${d.replace(/-/g, "")}00`));
    return Response.json({ encoding: "base64", content: Buffer.from(JSON.stringify(rows[day])).toString("base64") });
  });
  const data = await (await handler(request())).json();
  assert.equal(data.launches.launch_days_total, 3);
  assert.equal(data.launches.launch_days_7d, 3);
  assert.equal(data.launches.peak_daily, 2);
  assert.deepEqual(data.launches.by_version, { "0.1.16": 2, "0.1.15": 1 });
  assert.deepEqual(data.launches.by_platform, { "desktop/linux": 1, "android/android": 1, "desktop/windows": 1 });
});

test("malformed release response returns a controlled upstream error", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json({ message: "unavailable" }));
  assert.equal((await handler(request())).status, 502);
});