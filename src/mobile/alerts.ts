import type { Timer } from "@/lib/ipc";
import { formatRemaining } from "@/lib/ipc";

/**
 * Background-safe timer alerts for mobile.
 *
 * The Rust timer engine is wall-clock based, but Android suspends the
 * WebView (and may kill the process) once Nerva leaves the foreground, so the
 * 250 ms tick that fires desktop notifications stops. Instead we hand the OS
 * a pre-computed alarm for every phase boundary and the session end via the
 * notification plugin's `schedule` API. Whenever the set of running timers
 * changes we cancel everything and schedule again — idempotent, cheap, and
 * immune to drift because the dates come from the engine's own remaining
 * milliseconds.
 */
const CHANNEL_ID = "nerva-timers";
let channelReady = false;

async function ensureChannel(n: typeof import("@tauri-apps/plugin-notification")) {
  if (channelReady) return;
  try {
    await n.createChannel({
      id: CHANNEL_ID,
      name: "Timers",
      description: "Focus session and break alerts",
      importance: n.Importance.High,
      visibility: n.Visibility.Public,
      vibration: true,
    });
  } catch {
    /* iOS / older plugin — channels are Android-only */
  }
  channelReady = true;
}

/** Stable numeric id per (timer, boundary) so re-scheduling replaces rather than duplicates. */
function notifId(timerId: string, index: number): number {
  let h = 2166136261;
  for (let i = 0; i < timerId.length; i++) {
    h ^= timerId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1_000_000) * 100 + (index % 100);
}

/** Signature of the running set — callers only reschedule when this changes. */
export function runningSignature(timers: Timer[]): string {
  return timers
    .filter((t) => t.status === "running")
    .map((t) => `${t.id}:${t.phase_index}:${Math.round(t.remaining_ms / 1000)}`)
    .sort()
    .join("|");
}

export async function rescheduleTimerAlerts(timers: Timer[]): Promise<void> {
  let n: typeof import("@tauri-apps/plugin-notification");
  try {
    n = await import("@tauri-apps/plugin-notification");
    if (!(await n.isPermissionGranted())) {
      if ((await n.requestPermission()) !== "granted") return;
    }
    await ensureChannel(n);
    await n.cancelAll();
  } catch {
    return;
  }

  const now = Date.now();
  for (const t of timers) {
    if (t.status !== "running") continue;
    // Walk the remaining phases: the current one ends after phase_remaining_ms,
    // each later one after its full duration.
    let at = now + t.phase_remaining_ms;
    let idx = 0;
    for (let p = t.phase_index; p < t.phases.length; p++) {
      const last = p === t.phases.length - 1;
      const next = t.phases[p + 1];
      const title = last
        ? `${t.name} — done`
        : next?.kind === "break"
          ? `Break — ${formatRemaining(next.duration_ms)}`
          : "Back to focus";
      const body = last
        ? "Session complete. Nerva by Bytical"
        : next?.kind === "break"
          ? `${t.name}: step away, you've earned it.`
          : `${t.name}: next focus block starts now.`;
      try {
        n.sendNotification({
          id: notifId(t.id, idx++),
          channelId: CHANNEL_ID,
          title,
          body,
          schedule: n.Schedule.at(new Date(at), false, true),
        });
      } catch {
        /* best-effort */
      }
      if (next) at += next.duration_ms;
    }
  }
}
