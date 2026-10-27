import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const compiled = await build({ entryPoints: [fileURLToPath(new URL("../api/launch.ts", import.meta.url))], bundle: true, write: false, platform: "node", format: "esm" });
const { default: handler } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
process.env.GH_METRICS_TOKEN = "test-only-token";

const post = (body, headers = {}) => new Request("https://example.test/api/launch", {
  method: "POST",
  headers: { "content-type": "application/json", "x-vercel-ip-country": "IN", "x-vercel-ip-city": "Pune", ...headers },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

test("valid beacon stores only version, os, platform, language and country", async (context) => {
  const writes = [];
  context.mock.method(globalThis, "fetch", async (url, init) => {
    if (init?.method === "PUT") writes.push(JSON.parse(init.body));
    return new Response(null, { status: 404 });
  });
  const waited = [];
  const response = await handler(post({ app_version: "0.1.16", os: "android", platform: "android", locale: "en-IN", anonymousId: "should-be-dropped", n_notes: 12 }), { waitUntil: (p) => waited.push(p) });
  assert.equal(response.status, 204);
  await Promise.all(waited);
  assert.equal(writes.length, 1);
  const stored = JSON.parse(Buffer.from(writes[0].content, "base64").toString("utf8"))[0];
  assert.deepEqual(Object.keys(stored).sort(), ["app_version", "country", "locale", "os", "platform", "ts"]);
  assert.equal(stored.locale, "en");
  assert.equal(stored.country, "IN");
  assert.ok(!("city" in stored));
});

test("malformed beacons are rejected before any storage", async (context) => {
  const fetch = context.mock.method(globalThis, "fetch", async () => { throw new Error("must not fetch"); });
  for (const body of ["not json", [], { app_version: "<script>", os: "linux", platform: "desktop" }, { app_version: "0.1.16", os: "amiga", platform: "desktop" }, { app_version: "0.1.16", os: "linux", platform: "tv" }]) {
    assert.equal((await handler(post(body))).status, 400);
  }
  assert.equal((await handler(new Request("https://example.test/api/launch"))).status, 405);
  assert.equal(fetch.mock.callCount(), 0);
});

test("webview origins can preflight the beacon", async () => {
  const response = await handler(new Request("https://example.test/api/launch", { method: "OPTIONS", headers: { origin: "tauri://localhost" } }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.match(response.headers.get("access-control-allow-headers"), /content-type/);
});
