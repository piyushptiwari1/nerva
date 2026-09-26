/**
 * Platform detection. Tauri ships one JS bundle to every target; the mobile
 * shell is chosen at boot from the WebView user agent (synchronous, so the
 * first paint is already the right layout). `@tauri-apps/plugin-os` would
 * be authoritative but is async — the UA is good enough to pick a shell.
 */
let cached: boolean | null = null;

export function isMobile(): boolean {
  if (cached !== null) return cached;
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const forced = new URLSearchParams(window.location.search).get("shell");
  cached = forced === "mobile" || (forced !== "desktop" && /Android|iPhone|iPad|iPod/i.test(ua));
  if (typeof document !== "undefined") {
    document.documentElement.dataset.platform = cached ? "mobile" : "desktop";
  }
  return cached;
}
