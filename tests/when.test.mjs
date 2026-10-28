import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const compiled = await build({ entryPoints: ["src/lib/when.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const { whenLabel, defaultDue, toLocalInput } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);

// Fixed "now": a Tuesday at 10:00 local.
const now = new Date(2026, 9, 27, 10, 0, 0).getTime();
const H = 3_600_000;
const D = 24 * H;

const T = String.raw`\d{1,2}:\d{2}(?: [AP]M)?`;

test("whenLabel picks the shortest honest phrasing", () => {
  assert.equal(whenLabel(now - 5 * 60_000, now), "overdue");
  assert.equal(whenLabel(now - 30_000, now), "in 1m");
  assert.equal(whenLabel(now + 25 * 60_000, now), "in 25m");
  assert.match(whenLabel(now + 3 * H, now), new RegExp(`^${T}$`));
  assert.match(whenLabel(now + D, now), new RegExp(`^Tomorrow ${T}$`));
  assert.match(whenLabel(now + 3 * D, now), new RegExp(`^[A-Z][a-z]{2} ${T}$`));
  assert.match(whenLabel(now + 10 * D, now), new RegExp(`^\\d{1,2} [A-Z][a-z]{2} ${T}$|^[A-Z][a-z]{2} \\d{1,2} ${T}$`));
});

test("defaultDue lands on a quarter hour at least 15 minutes out", () => {
  const due = defaultDue(now);
  assert.ok(due - now >= 15 * 60_000 && due - now <= 30 * 60_000);
  assert.equal(toLocalInput(due), "2026-10-27T10:15");
  assert.equal(toLocalInput(defaultDue(now + 60_000)), "2026-10-27T10:30");
});
