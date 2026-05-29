import { useCallback, useEffect, useMemo, useState } from "react";
import { ipc, type Habit, type HabitEntry } from "@/lib/ipc";
import { PinButton } from "./PinButton";

/**
 * Floating always-on-top habits widget (single window label `habits-widget`).
 *
 * Pop-out twin of {@link HabitsRail} — designed for users who want their
 * habits visible while working in a different fullscreen app. Each row shows
 * today's state and supports a one-tap quick log. Heavy analytics live in
 * the main HabitsPane; this widget intentionally stays compact.
 */
export function HabitsWidget() {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [todayMap, setTodayMap] = useState<Record<string, HabitEntry | null>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const today = useMemo(() => todayIso(), []);

  const refresh = useCallback(async () => {
    const list = await ipc.habitList();
    setHabits(list);
    const pairs = await Promise.all(
      list
        .filter((h) => !h.archived)
        .map(async (h) => {
          const entries = await ipc.habitEntries({
            habit_id: h.id,
            from_day: today,
            to_day: today,
          });
          return [h.id, entries[0] ?? null] as const;
        }),
    );
    setTodayMap(Object.fromEntries(pairs));
  }, [today]);

  useEffect(() => {
    refresh();
    // Safety-net poll at 30 s — the primary refresh trigger is the
    // `habit:changed` Tauri event below, so the widget reacts within ms
    // of any edit in the main window.
    const h = window.setInterval(refresh, 30000);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);

    let unlistenHabit: (() => void) | undefined;
    let unlistenWs: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlistenHabit = await listen("habit:changed", () => refresh());
        unlistenWs = await listen("workspace:activated", () => refresh());
        if (cancelled) {
          unlistenHabit?.();
          unlistenWs?.();
        }
      } catch {
        /* not in Tauri context */
      }
    })();

    return () => {
      cancelled = true;
      window.clearInterval(h);
      window.removeEventListener("focus", onFocus);
      unlistenHabit?.();
      unlistenWs?.();
    };
  }, [refresh]);

  async function quickLog(h: Habit, delta: number) {
    if (busy) return;
    setBusy(h.id);
    try {
      const cur = todayMap[h.id];
      if (h.kind === "bool") {
        // Four-state cycle on a single button:
        //   empty  → done   → skipped → missed → empty
        // skipped keeps the streak alive (life happens), missed breaks it.
        const state = boolState(cur);
        const next: BoolState =
          state === "empty"
            ? "done"
            : state === "done"
              ? "skipped"
              : state === "skipped"
                ? "missed"
                : "empty";
        if (next === "empty") {
          await ipc.habitClear({ habit_id: h.id, day: today });
        } else if (next === "done") {
          await ipc.habitLog({ habit_id: h.id, day: today, value: 1, skipped: false });
        } else if (next === "skipped") {
          await ipc.habitLog({ habit_id: h.id, day: today, value: 0, skipped: true });
        } else {
          await ipc.habitLog({ habit_id: h.id, day: today, value: 0, skipped: false });
        }
      } else {
        const next = Math.max(0, (cur && !cur.skipped ? cur.value : 0) + delta);
        await ipc.habitLog({ habit_id: h.id, day: today, value: next });
      }
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function close() {
    try {
      const win = (await import("@tauri-apps/api/window")).getCurrentWindow();
      await win.close();
    } catch {
      /* ignore */
    }
  }

  const visible = habits.filter((h) => !h.archived);

  return (
    <div className="h-screen w-screen flex flex-col bg-ink-950 text-ink-100 select-none">
      <header
        data-tauri-drag-region
        className="h-9 px-3 flex items-center justify-between cursor-grab active:cursor-grabbing bg-ink-900 border-b border-ink-700 shrink-0"
        title="Drag to move"
      >
        <span data-tauri-drag-region className="flex items-center gap-2 pointer-events-none">
          <span className="text-ink-400 text-sm leading-none">⋮⋮</span>
          <span className="text-[10px] uppercase tracking-widest text-ink-300">
            Habits · {todayLabel()}
          </span>
        </span>
        <span className="flex items-center gap-1">
          <PinButton />
          <button
            onClick={close}
            className="text-ink-400 hover:text-ink-100 text-base leading-none px-1"
            title="Close widget"
          >
            ×
          </button>
        </span>
      </header>

      <div className="flex-1 overflow-y-auto p-2">
        {visible.length === 0 ? (
          <div className="text-xs text-ink-400 text-center mt-8 px-4">
            No habits yet. Open the main window and add one.
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {visible.map((h) => {
              const cur = todayMap[h.id] ?? null;
              const target = h.target ?? (h.kind === "bool" ? 1 : 0.0001);
              const done = !!cur && !cur.skipped && cur.value >= target;
              return (
                <li
                  key={h.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-ink-800/60 transition-colors"
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: h.color, opacity: done ? 1 : 0.55 }}
                  />
                  <span className="flex-1 min-w-0 truncate text-sm text-ink-200">
                    {h.name}
                  </span>
                  {h.kind === "bool" ? (
                    <BoolCycleButton
                      state={boolState(cur)}
                      onClick={() => quickLog(h, 0)}
                      disabled={busy === h.id}
                    />
                  ) : (
                    <span className="flex items-center gap-1">
                      <button
                        onClick={() => quickLog(h, -1)}
                        disabled={busy === h.id}
                        className="w-5 h-5 grid place-items-center rounded-md text-ink-400 hover:text-ink-100 border border-ink-700 bg-ink-800 text-[11px] disabled:opacity-50"
                        title="-1"
                      >
                        −
                      </button>
                      <span
                        className={`text-[10.5px] px-1.5 py-0.5 min-w-[2.6rem] rounded-md tnum text-center border ${
                          done
                            ? "bg-accent/25 text-accent-glow border-accent/30"
                            : "bg-ink-800 text-ink-200 border-ink-700"
                        }`}
                      >
                        {cur && !cur.skipped ? cur.value : 0}
                        {h.target ? <span className="text-ink-500">/{h.target}</span> : null}
                      </span>
                      <button
                        onClick={() => quickLog(h, +1)}
                        disabled={busy === h.id}
                        className="w-5 h-5 grid place-items-center rounded-md text-ink-400 hover:text-ink-100 border border-ink-700 bg-ink-800 text-[11px] disabled:opacity-50"
                        title="+1"
                      >
                        +
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function todayLabel(): string {
  const d = new Date();
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Four logical states a bool habit can be in for a given day:
 *  - `empty`   : no entry yet (pristine, neutral)
 *  - `done`    : value ≥ 1 — counts toward the streak
 *  - `skipped` : intentional rest day — streak preserved, not counted
 *  - `missed`  : explicitly logged as not-done — breaks the streak
 *
 * Stored as `(value, skipped)` pairs so this is a derived view, not a new
 * column. Backwards compatible with every existing habit entry.
 */
export type BoolState = "empty" | "done" | "skipped" | "missed";

export function boolState(e: HabitEntry | null): BoolState {
  if (!e) return "empty";
  if (e.skipped) return "skipped";
  return e.value >= 1 ? "done" : "missed";
}

interface BoolCycleProps {
  state: BoolState;
  onClick: () => void;
  disabled?: boolean;
}

/**
 * Single-button 4-state toggle for a bool habit. Each click advances:
 * empty → done → skipped → missed → empty. The icon and tint communicate
 * the current state at a glance — no separate "skip" or "miss" buttons.
 */
export function BoolCycleButton({ state, onClick, disabled }: BoolCycleProps) {
  const variants: Record<BoolState, { glyph: string; cls: string; title: string }> = {
    empty: {
      glyph: "○",
      cls: "bg-ink-800 text-ink-500 hover:text-ink-200 border-ink-700",
      title: "Not logged — click to mark done",
    },
    done: {
      glyph: "✓",
      cls: "bg-accent/40 text-accent-glow border-accent/40",
      title: "Done — click to mark skipped",
    },
    skipped: {
      glyph: "⊘",
      cls: "bg-ink-700/70 text-ink-300 border-ink-600",
      title: "Skipped (streak kept) — click to mark missed",
    },
    missed: {
      glyph: "✗",
      cls: "bg-danger/20 text-danger border-danger/40",
      title: "Missed — click to clear",
    },
  };
  const v = variants[state];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-6 h-6 grid place-items-center rounded-md text-[12px] border transition-all disabled:opacity-50 ${v.cls}`}
      title={v.title}
      aria-label={`Habit state: ${state}`}
    >
      {v.glyph}
    </button>
  );
}
