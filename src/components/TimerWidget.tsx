import { useEffect, useState } from "react";
import { ipc, formatRemaining, type Timer } from "@/lib/ipc";

/**
 * Floating always-on-top timer widget. Single window (label `timer-widget`).
 * Shows the most "active" timer — running first, then paused, else most-recent.
 * Click the header to drag, click the body to pause/resume.
 */
export function TimerWidget() {
  const [timers, setTimers] = useState<Timer[]>([]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const rep = await ipc.timerTick();
        if (alive) setTimers(rep.timers);
      } catch {
        /* ignore */
      }
    };
    tick();
    const h = window.setInterval(tick, 250);
    return () => {
      alive = false;
      window.clearInterval(h);
    };
  }, []);

  const active =
    timers.find((t) => t.status === "running") ??
    timers.find((t) => t.status === "paused") ??
    timers[0] ??
    null;

  async function toggle() {
    if (!active) return;
    if (active.status === "running") await ipc.timerPause(active.id);
    else if (active.status === "paused") await ipc.timerResume(active.id);
    else if (active.status === "idle") await ipc.timerStart(active.id);
  }

  async function close() {
    try {
      const win = (await import("@tauri-apps/api/window")).getCurrentWindow();
      await win.close();
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-ink-950 text-ink-100 select-none">
      <header
        data-tauri-drag-region
        className="h-9 px-3 flex items-center justify-between cursor-grab active:cursor-grabbing bg-ink-900 border-b border-ink-700"
        title="Drag to move"
      >
        <span data-tauri-drag-region className="flex items-center gap-2 pointer-events-none">
          <span className="text-ink-400 text-sm leading-none">⋮⋮</span>
          <span className="text-[10px] uppercase tracking-widest text-ink-300">
            Nerva timer
          </span>
        </span>
        <span className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full"
            style={{ background: active?.color ?? "#7c9cff" }}
          />
          <button
            onClick={close}
            className="text-ink-400 hover:text-ink-100 text-base leading-none px-1"
            title="Close widget"
          >
            ×
          </button>
        </span>
      </header>

      <button
        onClick={toggle}
        disabled={!active}
        className="flex-1 flex flex-col items-center justify-center hover:bg-ink-900/40 transition-colors disabled:cursor-default px-3"
      >
        {active ? (
          <>
            {/* The big digits use the theme's primary text colour so they
                stay legible in both dark and light themes; the timer's
                saved colour identity lives in the small dot in the header
                and as the leading accent stripe below. */}
            <div className="flex items-center gap-2">
              <span
                className="w-1 h-7 rounded-full"
                style={{ background: active.color }}
                aria-hidden
              />
              <div className="text-3xl font-semibold tnum text-ink-100">
                {formatRemaining(active.remaining_ms)}
              </div>
            </div>
            <div className="text-[11px] text-ink-400 mt-0.5 truncate max-w-full">
              {active.name} · {active.status}
            </div>
          </>
        ) : (
          <div className="text-xs text-ink-400">No timer</div>
        )}
      </button>
    </div>
  );
}
