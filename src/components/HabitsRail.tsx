import { useCallback, useEffect, useMemo, useState } from "react";
import { ipc, type Habit, type HabitEntry } from "@/lib/ipc";
import { useHabitsUi } from "@/store/habits";

/**
 * HabitsRail — compact habits list for the home sidebar.
 *
 * Goals (from user feedback):
 *  - Habits visible on the home screen without opening the overlay.
 *  - One-tap completion: each habit shows today's state and a quick toggle.
 *  - Truly small footprint so the rail doesn't crowd workspaces / tasks.
 *
 * Heavy analytics live in HabitsPane; the rail just renders today's status
 * (color stripe, name, current streak, today control).
 */
export function HabitsRail() {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [todayMap, setTodayMap] = useState<Record<string, HabitEntry | null>>(
    {},
  );
  const [busy, setBusy] = useState<string | null>(null);
  const openHabits = useHabitsUi((s) => s.show);

  const today = useMemo(() => todayIso(), []);

  const refresh = useCallback(async () => {
    const list = await ipc.habitList();
    setHabits(list);
    // Fetch today's entry for each habit in parallel.
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
    // Refresh on focus so the rail catches edits made inside HabitsPane.
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  async function quickLog(h: Habit) {
    if (busy) return;
    setBusy(h.id);
    try {
      const cur = todayMap[h.id];
      const target = h.target ?? (h.kind === "bool" ? 1 : 1);
      if (h.kind === "bool") {
        const done = cur && !cur.skipped && cur.value >= 1;
        await ipc.habitLog({
          habit_id: h.id,
          day: today,
          value: done ? 0 : 1,
        });
      } else {
        // count/amount → increment by 1 (or by 0.5 of target if target < 1).
        const step = h.kind === "count" ? 1 : Math.max(1, Math.round(target / 4));
        const next = (cur && !cur.skipped ? cur.value : 0) + step;
        await ipc.habitLog({ habit_id: h.id, day: today, value: next });
      }
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  const visible = habits.filter((h) => !h.archived);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[11px] uppercase tracking-wider text-ink-400">
          Habits
        </h3>
        <button
          onClick={openHabits}
          className="text-[10px] text-ink-400 hover:text-ink-100 transition-colors"
          title="Open habits tracker (Ctrl+H)"
        >
          all →
        </button>
      </div>
      {visible.length === 0 ? (
        <button
          onClick={openHabits}
          className="w-full text-left text-xs text-ink-400 hover:text-ink-100 px-2 py-1.5 rounded-md hover:bg-ink-800/60 transition-colors"
        >
          + add your first habit
        </button>
      ) : (
        <div className="flex flex-col gap-1">
          {visible.slice(0, 6).map((h) => {
            const cur = todayMap[h.id] ?? null;
            const target = h.target ?? (h.kind === "bool" ? 1 : 0.0001);
            const done = !!cur && !cur.skipped && cur.value >= target;
            const skipped = cur?.skipped === true;
            return (
              <div
                key={h.id}
                className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-ink-800/60 transition-colors"
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: h.color, opacity: done ? 1 : 0.55 }}
                />
                <button
                  onClick={openHabits}
                  className="flex-1 text-left min-w-0 truncate text-sm text-ink-200 group-hover:text-ink-100"
                  title="Open habits"
                >
                  {h.name}
                </button>
                <HabitRailControl
                  h={h}
                  cur={cur}
                  done={done}
                  skipped={skipped}
                  busy={busy === h.id}
                  onClick={() => quickLog(h)}
                />
              </div>
            );
          })}
          {visible.length > 6 && (
            <button
              onClick={openHabits}
              className="text-[10px] text-ink-500 hover:text-ink-200 px-2 py-1 text-left transition-colors"
            >
              +{visible.length - 6} more…
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function HabitRailControl({
  h,
  cur,
  done,
  skipped,
  busy,
  onClick,
}: {
  h: Habit;
  cur: HabitEntry | null;
  done: boolean;
  skipped: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  if (h.kind === "bool") {
    return (
      <button
        onClick={onClick}
        disabled={busy}
        title={done ? "Mark not-done" : "Mark done"}
        className={`w-5 h-5 grid place-items-center rounded-md text-[11px] transition-all disabled:opacity-50 ${
          done
            ? "bg-accent/40 text-accent-glow border border-accent/40 shadow-[0_0_10px_-4px_rgba(124,156,255,0.7)]"
            : skipped
              ? "bg-ink-700/60 text-ink-400 border border-ink-700"
              : "bg-ink-800 text-ink-400 hover:text-ink-100 border border-ink-700"
        }`}
      >
        {done ? "✓" : skipped ? "·" : ""}
      </button>
    );
  }
  // count/amount → show current value tinted; tap = +1 quick log
  const v = cur && !cur.skipped ? cur.value : 0;
  const target = h.target ?? 0;
  return (
    <button
      onClick={onClick}
      disabled={busy}
      title="Quick +1"
      className={`text-[10.5px] px-1.5 py-0.5 min-w-[2.5rem] rounded-md tnum text-right border transition-colors disabled:opacity-50 ${
        done
          ? "bg-accent/25 text-accent-glow border-accent/30"
          : "bg-ink-800 text-ink-200 hover:text-ink-100 border-ink-700"
      }`}
    >
      {v}
      {target ? <span className="text-ink-500">/{target}</span> : null}
    </button>
  );
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}
