import { ipc } from "@/lib/ipc";

/**
 * Opt-in anonymous usage telemetry.
 *
 * Privacy contract (mirrored in the consent dialog and the website FAQ):
 *  - OFF by default. Nothing is ever sent until the user explicitly accepts
 *    the consent dialog. The choice can be reverted any time in Settings.
 *  - Anonymous: a random UUID generated locally, no account, no email, no
 *    hostname, no IP-side enrichment.
 *  - Content never leaves the machine: only COUNTS (how many notes/tasks/
 *    timers/habits exist, focus minutes) plus app version / OS / locale.
 *  - At most one ping every 7 days, and only when the app is online.
 *
 * The payload goes to nerva.bytical.ai/api/telemetry which whitelists the
 * fields server-side before forwarding to the analytics sink.
 */

const ENDPOINT = "https://nerva.bytical.ai/api/telemetry";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const K_CONSENT = "nerva.telemetry.consent"; // "granted" | "denied" | absent (= not asked yet)
const K_LAST = "nerva.telemetry.lastSent";
const K_ANON = "nerva.telemetry.anonId";

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
  const boot = window.setTimeout(() => void maybeSendWeeklyPing(), 30_000);
  const daily = window.setInterval(() => void maybeSendWeeklyPing(), 24 * 60 * 60 * 1000);
  return () => {
    window.clearTimeout(boot);
    window.clearInterval(daily);
  };
}
