import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = fileURLToPath(new URL("./verify-android-signing.sh", import.meta.url));
const signer = "a".repeat(64);
const otherSigner = "b".repeat(64);
const legacySigner = "0c6e092921f6045eeeeff8d237b633922be137495599f5f05f677ea835e4d324";

test("public signing gate accepts only pinned upgrades or the approved isolated legacy transition", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "nerva-signing-gate-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const verifier = join(directory, "apksigner");
  writeFileSync(verifier, `#!/usr/bin/env bash
set -euo pipefail
apk="\${!#}"
case "$apk" in
  invalid.apk) exit 1 ;;
  old.apk) digest="\${TEST_PREVIOUS_DIGEST:-${signer}}" ;;
  new.apk) digest="\${TEST_DIGEST}" ;;
esac
printf 'Number of signers: %s\\nSigner #1 certificate SHA-256 digest: %s\\n' "\${TEST_SIGNERS:-1}" "$digest"
`, { mode: 0o700 });
  const analyzer = join(directory, "apkanalyzer");
  writeFileSync(analyzer, `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${!#}" == "old.apk" ]]; then
  printf '%s\\n' "\${TEST_PREVIOUS_PACKAGE:-ai.bytical.nerva.mobile}"
else
  printf '%s\\n' "\${TEST_PACKAGE:-ai.bytical.nerva.mobile}"
fi
`, { mode: 0o700 });
  const run = (overrides = {}, apk = "new.apk") => execFileSync("bash", [script, apk, "old.apk"], {
    env: { ...process.env, APKSIGNER: verifier, APKANALYZER: analyzer, ANDROID_CERT_SHA256: signer, TEST_DIGEST: signer, ...overrides },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.match(run(), /PASS/);
  assert.throws(() => run({ TEST_DIGEST: otherSigner }), /pinned signing certificate/);
  assert.throws(() => run({ TEST_DIGEST: otherSigner, ANDROID_CERT_SHA256: otherSigner }), /BLOCKED/);
  const transition = { TEST_PREVIOUS_PACKAGE: "ai.bytical.nerva", TEST_PREVIOUS_DIGEST: legacySigner };
  assert.match(run(transition), /approved side-by-side/);
  assert.match(run(transition, "--previous"), /approved side-by-side/);
  assert.throws(() => run({ ...transition, TEST_PACKAGE: "ai.bytical.nerva" }), /never replace the legacy/);
  assert.throws(() => run({ ...transition, TEST_PREVIOUS_DIGEST: otherSigner }), /BLOCKED/);
  assert.throws(() => run({ TEST_PREVIOUS_PACKAGE: "unrelated.app" }), /BLOCKED/);
  assert.throws(() => run({ TEST_PACKAGE: "unrelated.app" }), /release package must/);
  assert.throws(() => run({ TEST_SIGNERS: "2" }), /exactly one/);
  assert.throws(() => run({ ANDROID_CERT_SHA256: "invalid" }), /Invalid release/);
  assert.throws(() => run({}, "invalid.apk"));
});