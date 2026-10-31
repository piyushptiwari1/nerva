/**
 * Semantic haptic + sound feedback for the moments that matter.
 * Phones get Web Audio ticks and `navigator.vibrate`; desktop gets the Rust
 * synth where a cue exists and silence otherwise (a mouse click is its own
 * feedback). One switch pair in Settings → "Sounds & haptics".
 */
import { ipc } from "@/lib/ipc";
import { isMobile } from "@/lib/platform";

const KEY = "nerva.haptics";
export type HapticPrefs = { haptics: boolean; sounds: boolean };

export function hapticPrefs(): HapticPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { haptics: true, sounds: true, ...(JSON.parse(raw) as Partial<HapticPrefs>) };
  } catch { /* ignore */ }
  return { haptics: true, sounds: true };
}
export function setHapticPrefs(next: Partial<HapticPrefs>): HapticPrefs {
  const merged = { ...hapticPrefs(), ...next };
  try { localStorage.setItem(KEY, JSON.stringify(merged)); } catch { /* ignore */ }
  return merged;
}

function vibrate(pattern: number | number[]) {
  if (!hapticPrefs().haptics) return;
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (!hapticPrefs().sounds) return null;
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch { return null; }
}

/** Short tones; `notes` are [frequencyHz, startOffsetS, durationS]. */
function blip(notes: Array<[number, number, number]>, gain = 0.08, type: OscillatorType = "sine") {
  const c = audio();
  if (!c) return;
  const t0 = c.currentTime;
  for (const [f, at, dur] of notes) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t0 + at);
    g.gain.setValueAtTime(0, t0 + at);
    g.gain.linearRampToValueAtTime(gain, t0 + at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + at + dur);
    o.connect(g).connect(c.destination);
    o.start(t0 + at);
    o.stop(t0 + at + dur + 0.02);
  }
}

export const haptic = {
  /** Any button press on a phone. Silent on desktop. */
  tap() {
    if (!isMobile()) return;
    vibrate(8);
  },
  /** A toggle landed (check, chip select). */
  select() {
    vibrate(12);
    if (isMobile()) blip([[880, 0, 0.05]], 0.04);
  },
  /** Something was completed: task done, habit logged. */
  complete() {
    vibrate([14, 40, 22]);
    if (isMobile()) blip([[660, 0, 0.08], [990, 0.07, 0.12]], 0.07);
    else void ipc.audioTestCue("resume").catch(() => void 0);
  },
  /** A streak milestone or similar — a little more. */
  celebrate() {
    vibrate([18, 50, 18, 50, 36]);
    if (isMobile()) blip([[523, 0, 0.1], [659, 0.09, 0.1], [784, 0.18, 0.1], [1047, 0.27, 0.22]], 0.08);
    else void ipc.audioTestCue("completion").catch(() => void 0);
  },
  /** Timer started / resumed. */
  start() {
    vibrate(20);
    if (isMobile()) blip([[440, 0, 0.06], [660, 0.06, 0.1]], 0.06, "triangle");
  },
  /** Destructive or dismissive action (delete, snooze). */
  warn() {
    vibrate([10, 30, 10]);
    if (isMobile()) blip([[330, 0, 0.09]], 0.05, "triangle");
  },
  /** Something failed. */
  error() {
    vibrate([30, 40, 30, 40, 30]);
    if (isMobile()) blip([[220, 0, 0.12], [196, 0.12, 0.16]], 0.07, "square");
  },
};
