import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const compiled = await build({ entryPoints: ["src/lib/errors.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const { errorMessage } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);

test("native and web errors have readable messages", () => {
  assert.equal(errorMessage({ error: { message: "Notifications are unavailable" } }), "Notifications are unavailable");
  assert.equal(errorMessage(new Error("Could not load widgets")), "Could not load widgets");
  assert.equal(errorMessage("Permission denied"), "Permission denied");
  const cyclic = {}; cyclic.cause = cyclic;
  assert.equal(errorMessage(cyclic, "Try again"), "Try again");
  assert.equal(errorMessage({ code: 4 }, "Try again"), "Try again");
});