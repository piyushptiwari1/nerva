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
if [[ "$1" == "shell" && "$2" == "pidof" ]]; then
  if [[ "\${TEST_PROCESS_READY:-no}" == "yes" ]]; then printf '1234\\n'; else exit 1; fi
elif [[ "$1" == "shell" ]]; then
  printf '%s\\n' "\${TEST_BOOT_READY:-0}"
elif [[ "$6" == "am_proc_bound:I" ]]; then
  printf 'I/am_proc_bound( 500): [0,1234,%s]\\n' "\${TEST_PROCESS_PACKAGE:-ai.bytical.nerva.mobile}"
elif [[ "\${TEST_BOOT_EVENT:-yes}" == "yes" ]]; then
  printf 'I/boot_progress_enable_screen( 500): 23456\\n'
else
  exit 1
fi
`, { mode: 0o700 });
  const script = fileURLToPath(new URL("./wait-android-boot.mjs", import.meta.url));
  const run = (overrides, targetPackage) => execFileSync(process.execPath, [script, adb, ...(targetPackage ? [targetPackage] : [])], {
    env: { ...process.env, ...overrides }, encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"],
  });
  assert.match(run({ TEST_BOOT_READY: "1", TEST_BOOT_EVENT: "no" }), /confirmed/);
  assert.match(run({ TEST_BOOT_READY: "0", TEST_BOOT_EVENT: "yes" }), /confirmed/);
  assert.throws(() => run({ TEST_BOOT_READY: "0", TEST_BOOT_EVENT: "no" }), /before readiness/);
  const targetPackage = "ai.bytical.nerva.mobile";
  assert.match(run({ TEST_BOOT_READY: "1", TEST_PROCESS_READY: "yes", TEST_PROCESS_PACKAGE: "unrelated.app" }, targetPackage), /recovered process confirmed/);
  assert.match(run({ TEST_BOOT_READY: "1", TEST_PROCESS_READY: "no" }, targetPackage), /recovered process confirmed/);
  assert.throws(() => run({ TEST_BOOT_READY: "1", TEST_PROCESS_PACKAGE: `${targetPackage}.test` }, targetPackage), /before readiness/);
  assert.throws(() => run({ TEST_BOOT_READY: "1" }, "invalid;package"), /Invalid Android package/);
});