import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("Android readiness waits for the framework event, not just an ADB connection", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "nerva-boot-check-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const adb = join(directory, "adb");
  writeFileSync(adb, `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "shell" ]]; then
  printf '%s\\n' "\${TEST_BOOT_READY:-0}"
elif [[ "\${TEST_BOOT_EVENT:-yes}" == "yes" ]]; then
  printf 'I/boot_progress_enable_screen( 500): 23456\\n'
else
  exit 1
fi
`, { mode: 0o700 });
  const script = fileURLToPath(new URL("./wait-android-boot.mjs", import.meta.url));
  const run = (overrides) => execFileSync(process.execPath, [script, adb], {
    env: { ...process.env, ...overrides }, encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"],
  });
  assert.match(run({ TEST_BOOT_READY: "1", TEST_BOOT_EVENT: "no" }), /confirmed/);
  assert.match(run({ TEST_BOOT_READY: "0", TEST_BOOT_EVENT: "yes" }), /confirmed/);
  assert.throws(() => run({ TEST_BOOT_READY: "0", TEST_BOOT_EVENT: "no" }), /before readiness/);
});