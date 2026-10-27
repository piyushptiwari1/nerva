import { ipc } from "@/lib/ipc";
import { isAndroid } from "@/lib/platform";

/**
 * Two independent signals, with different defaults:
 *
 *  1. Launch beacon — ON by default, opt-out in Settings → About.
 *     Once per calendar day: app version, OS, platform, language. No id of
 *     any kind, no counts, no content. The server adds country only.
 *     This is the only way to know whether anyone actually uses Nerva.
 *
 *  2. Weekly usage stats — OFF by default, opt-in via the consent dialog.
 *     Anonymous random id + feature counts (how many notes/tasks/…). Content
 *     never leaves the machine.
 *
 * Both are best-effort and never block or break offline use.
 */

const ENDPOINT = "https://nerva.bytical.ai/api/telemetry";
const LAUNCH_ENDPOINT = "https://nerva.bytical.ai/api/launch";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const K_CONSENT = "nerva.telemetry.consent"; // "granted" | "denied" | absent (= not asked yet)
const K_LAST = "nerva.telemetry.lastSent";
const K_ANON = "nerva.telemetry.anonId";
const K_BEACON = "nerva.telemetry.launchBeacon"; // "off" disables; absent/"on" = enabled
const K_BEACON_DAY = "nerva.telemetry.launchDay";

export type ConsentState = "granted" | "denied" | "unset";

export function consentState(): ConsentState {
  const v = localStorage.getItem(K_CONSENT);
  return v === "granted" || v === "denied" ? v : "unset";
}

export function setConsent(granted: boolean): void {
  localStorage.setItem(K_CONSENT, granted ? "granted" : "denied");
  if (!granted) {
    // Revoked → forget the anonymous id so a future opt-in starts fresh.
    localStorage.removeItem(K_ANON);
    localStorage.removeItem(K_LAST);
  }
}

export function launchBeaconEnabled(): boolean {
  return localStorage.getItem(K_BEACON) !== "off";
}

export function setLaunchBeacon(enabled: boolean): void {
  localStorage.setItem(K_BEACON, enabled ? "on" : "off");
}

function detectOs(): string {
  if (isAndroid()) return "android";
  const ua = navigator.userAgent;
  if (/Windows/.test(ua)) return "windows";
  if (/Mac OS|Macintosh/.test(ua)) return "macos";
  if (/Linux|X11/.test(ua)) return "linux";
  return "unknown";
}

function localDay(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Send today's launch beacon if enabled and not yet sent today. Never throws. */
export async function maybeSendLaunchBeacon(): Promise<void> {
  try {
    if (!launchBeaconEnabled()) return;
    const today = localDay();
    if (localStorage.getItem(K_BEACON_DAY) === today) return;
    let version = "unknown";
    try {
      version = (await ipc.runtime()).version;
    } catch {
      /* runtime info unavailable — still count the launch */
    }
    const res = await fetch(LAUNCH_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        app_version: version,
        os: detectOs(),
        platform: isAndroid() ? "android" : "desktop",
        locale: navigator.language,
      }),
    });
    if (res.ok) localStorage.setItem(K_BEACON_DAY, today);
  } catch {
    /* offline — try again next launch */
  }
}

function anonId(): string {
  let id = localStorage.getItem(K_ANON);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(K_ANON, id);
  }
  return id;
}

async function buildPayload(): Promise<Record<string, unknown>> {
  // Every slice is best-effort: a failed IPC just omits that counter.
  const [runtime, workspaces, timers, notes, tasks, habits, momentum] =
    await Promise.allSettled([
      ipc.runtime(),
      ipc.workspaceList(),
      ipc.timerList(),
      ipc.noteList(),
      ipc.taskList(),
      ipc.habitList(),
      ipc.momentumSnapshot(7),
    ]);
  const val = <T,>(r: PromiseSettledResult<T>): T | null =>
    r.status === "fulfilled" ? r.value : null;

  const mom = val(momentum) ?? [];
  const props: Record<string, unknown> = {
    app_version: val(runtime)?.version ?? "unknown",
    os: navigator.userAgent.includes("Windows")
      ? "windows"
      : navigator.userAgent.includes("Mac")
        ? "macos"
        : "linux",
    locale: navigator.language,
    theme: document.documentElement.dataset.theme ?? "dark",
    n_workspaces: val(workspaces)?.length,
    n_timers: val(timers)?.length,
    n_notes: val(notes)?.length,
    n_tasks: val(tasks)?.length,
    n_habits: val(habits)?.length,
    completed_timers_7d: mom.reduce((s, b) => s + b.completed_timers, 0),
    completed_tasks_7d: mom.reduce((s, b) => s + b.completed_tasks, 0),
    focus_ms_7d: mom.reduce((s, b) => s + b.focus_ms, 0),
  };
  // Drop nulls so the server whitelist doesn't see junk.
  for (const k of Object.keys(props)) {
    if (props[k] === null || props[k] === undefined) delete props[k];
  }
  return props;
}

/**
 * Send the weekly ping if (and only if): consent granted, ≥7 days since the
 * last successful send, and the network call succeeds. Never throws — the
 * app must be 100% functional offline.
 */
export async function maybeSendWeeklyPing(): Promise<void> {
  try {
    if (consentState() !== "granted") return;
    const last = Number(localStorage.getItem(K_LAST) ?? 0);
    if (Date.now() - last < WEEK_MS) return;
    const properties = await buildPayload();
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ anonymousId: anonId(), properties }),
    });
    if (res.ok) {
      localStorage.setItem(K_LAST, String(Date.now()));
    }
    // Non-OK / offline → silently retry on a future launch or daily check.
  } catch {
    /* offline or endpoint down — try again another day */
  }
}

/**
 * Install the weekly scheduler: one check shortly after boot (delayed so it
 * never competes with startup IPC), then a re-check once a day for
 * long-running sessions. Main window only — popups must not double-send.
 */
export function initTelemetry(): () => void {
  const beacon = window.setTimeout(() => void maybeSendLaunchBeacon(), 8_000);
  const boot = window.setTimeout(() => void maybeSendWeeklyPing(), 30_000);
  const daily = window.setInterval(() => {
    void maybeSendLaunchBeacon();
    void maybeSendWeeklyPing();
  }, 24 * 60 * 60 * 1000);
  // A phone resumed on a new day should count that day too.
  const onVisible = () => {
    if (document.visibilityState === "visible") void maybeSendLaunchBeacon();
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    window.clearTimeout(beacon);
    window.clearTimeout(boot);
    window.clearInterval(daily);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
