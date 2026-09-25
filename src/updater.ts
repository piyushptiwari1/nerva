// Auto-updater bootstrap.
//
// Runs ONCE at app launch from the main window only. Fetches
// `https://github.com/.../releases/latest/download/latest.json`,
// verifies its signature against the bundled minisign pubkey
// (see `plugins.updater.pubkey` in src-tauri/tauri.conf.json),
// then \u2014 if a newer version is available \u2014 prompts the user via
// the native Tauri updater dialog (`plugins.updater.dialog = true`).
//
// Failures are swallowed silently: offline users, GitHub rate-limit,
// or a missing `latest.json` should never block the app from starting.
// Errors are logged to the JS console for the diagnostics export.
//
// The updater is desktop-only; web/dev builds skip it.

import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

const CHECK_DELAY_MS = 4_000;

export function scheduleUpdateCheck(): void {
  // Only the main window runs the check \u2014 widgets and sticky notes
  // share the same JS bundle but we don't want N concurrent checks.
  if (window.location.search.includes("widget=")) return;
  if (window.location.search.includes("sticky=")) return;

  // Wait until the workspace has settled (first paint + initial IPC
  // calls done) before hitting the network. Keeps cold-start fast.
  window.setTimeout(() => {
    void runCheck();
  }, CHECK_DELAY_MS);
}

async function runCheck(): Promise<void> {
  let update: Awaited<ReturnType<typeof check>> = null;
  try {
    update = await check();
  } catch (err) {
    // Common: offline, GitHub rate-limit, signature mismatch on a tampered
    // artifact. None of these should crash the app.
    // eslint-disable-next-line no-console
    console.warn("[updater] check failed:", err);
    return;
  }
  if (!update) return;
  try {
    // dialog=true in tauri.conf.json shows a native confirm dialog before
    // downloading; downloadAndInstall verifies the signature and swaps
    // the binary (dpkg/rpm via pkexec on Linux, NSIS/MSI on Windows).
    await update.downloadAndInstall();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[updater] install failed:", err);
    return;
  }
  try {
    await relaunch();
  } catch (err) {
    // The update is already on disk; a failed relaunch just means the
    // user picks it up on their next launch.
    // eslint-disable-next-line no-console
    console.warn("[updater] relaunch failed (update installed, restart manually):", err);
  }
}
