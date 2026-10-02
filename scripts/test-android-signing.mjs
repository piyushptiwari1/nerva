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

test("public signing gate accepts only a verified, pinned, upgrade-compatible APK", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "nerva-signing-gate-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const verifier = join(directory, "apksigner");
  writeFileSync(verifier, `#!/usr/bin/env bash
set -euo pipefail
apk="\${!#}"
case "$apk" in
  invalid.apk) exit 1 ;;
  old.apk) digest="${signer}" ;;
  new.apk) digest="\${TEST_DIGEST}" ;;
esac
printf 'Number of signers: %s\\nSigner #1 certificate SHA-256 digest: %s\\n' "\${TEST_SIGNERS:-1}" "$digest"
`, { mode: 0o700 });
  const run = (overrides = {}, apk = "new.apk") => execFileSync("bash", [script, apk, "old.apk"], {
    env: { ...process.env, APKSIGNER: verifier, ANDROID_CERT_SHA256: signer, TEST_DIGEST: signer, ...overrides },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.match(run(), /PASS/);
  assert.throws(() => run({ TEST_DIGEST: otherSigner }), /pinned signing certificate/);
  assert.throws(() => run({ TEST_DIGEST: otherSigner, ANDROID_CERT_SHA256: otherSigner }), /BLOCKED/);
  assert.throws(() => run({ TEST_SIGNERS: "2" }), /exactly one/);
  assert.throws(() => run({ ANDROID_CERT_SHA256: "invalid" }), /Invalid release/);
  assert.throws(() => run({}, "invalid.apk"));
});