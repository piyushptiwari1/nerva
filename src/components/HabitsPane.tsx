import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ipc,
  type Habit,
  type HabitEntry,
  type HabitKind,
  type HabitStats,
} from "@/lib/ipc";
import { useHabitsUi } from "@/store/habits";

/**
 * HabitsPane — the daily habit tracker.
 *
 * Design choices, distilled from common complaints about every shipping
 * habit-tracker app:
 *  - Skip-day support: vacation/sickness doesn't shame you out of your streak.
 *  - No paywalls, no quota: any number of habits, three kinds covering every
 *    real-world use (yes/no, integer reps, free numeric amount).
 *  - One screen, no menu-diving: today log + 84-day heatmap + stats inline.
 *  - Soft progress framing: completion % and skip-aware streak shown together,
 *    no scary red "lost streak" banners.
 *  - Local-first: everything is event-sourced into the same SQLite log as the
 *    rest of Nerva, no sync server, no account.
 */
export function HabitsPane() {
  const open = useHabitsUi((s) => s.open);
  const hide = useHabitsUi((s) => s.hide);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [loading, setLoading] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await ipc.habitList();
      setHabits(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, hide]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-stretch justify-end bg-ink-950/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && hide()}
    >
      <div className="w-[min(960px,96vw)] h-full bg-ink-900 border-l border-ink-700 shadow-2xl flex flex-col">
        <header className="px-5 py-3 border-b border-ink-700 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink-100">Habits</h2>
            <p className="text-[11px] text-ink-300 mt-0.5">
              Daily tracker · skip-day honored · all data stays local
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowNew((v) => !v)}
              className="text-xs px-3 py-1.5 rounded-md bg-accent/25 hover:bg-accent/40 text-accent-glow"
            >
              {showNew ? "Cancel" : "+ New habit"}
            </button>
            <button
              onClick={hide}
              className="text-ink-300 hover:text-ink-100 text-base px-1"
              title="Close (Esc)"
            >
              ×
            </button>
          </div>
        </header>

        {showNew && (
          <NewHabitForm
            onCreated={async () => {
              setShowNew(false);
              await refresh();
            }}
          />
        )}

        <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-3">
          {loading && habits.length === 0 && (
            <div className="text-xs text-ink-300 px-2">Loading…</div>
          )}
          {!loading && habits.length === 0 && !showNew && (
            <EmptyState onAdd={() => setShowNew(true)} />
          )}
          {habits
            .filter((h) => !h.archived)
            .map((h) => (
              <HabitRow key={h.id} habit={h} onChanged={refresh} />
            ))}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────

const PALETTE = [
  "#7c9cff", "#a8bdff", "#e8b86d", "#7dd6a8", "#e87d7d",
  "#d27dff", "#7de8e0", "#ffd07d", "#9ce87d",
];

function NewHabitForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<HabitKind>("bool");
  const [target, setTarget] = useState<string>("");
  const [unit, setUnit] = useState("");
  const [color, setColor] = useState(PALETTE[0]);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await ipc.habitCreate({
        name: name.trim(),
        kind,
        target: kind === "bool" ? null : target ? Number(target) : null,
        unit: kind === "bool" ? null : unit || null,
        color,
      });
      setName("");
      setTarget("");
      setUnit("");
      onCreated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-5 py-4 border-b border-ink-700 bg-ink-800/40 flex flex-col gap-3">
      <div className="flex gap-2">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Habit name (e.g. Meditate, Push-ups, Water)"
          className="flex-1 bg-ink-800 hairline rounded-md px-3 py-2 text-sm text-ink-100 placeholder:text-ink-400"
        />
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as HabitKind)}
          className="bg-ink-800 hairline rounded-md px-2 py-2 text-sm text-ink-100"
        >
          <option value="bool">Yes / No</option>
          <option value="count">Count</option>
          <option value="amount">Amount</option>
        </select>
      </div>
      {kind !== "bool" && (
        <div className="flex gap-2">
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder={kind === "count" ? "Daily target (optional, e.g. 20)" : "Daily target (e.g. 30)"}
            type="number"
            min={0}
            step={kind === "count" ? 1 : 0.1}
            className="flex-1 bg-ink-800 hairline rounded-md px-3 py-2 text-sm text-ink-100 placeholder:text-ink-400"
          />
          <input
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder={kind === "count" ? "reps" : "min, ml, km, …"}
            className="w-32 bg-ink-800 hairline rounded-md px-3 py-2 text-sm text-ink-100 placeholder:text-ink-400"
          />
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-ink-300">Color</span>
        {PALETTE.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            className={`w-5 h-5 rounded-full border ${
              color === c ? "border-ink-100" : "border-transparent"
            }`}
            style={{ background: c }}
            aria-label={`color ${c}`}
          />
        ))}
        <div className="flex-1" />
        <button
          onClick={submit}
          disabled={!name.trim() || busy}
          className="text-xs px-3 py-1.5 rounded-md bg-accent/30 hover:bg-accent/50 text-accent-glow disabled:opacity-40"
        >
          {busy ? "Adding…" : "Add habit"}
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function isoMinusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function HabitRow({ habit, onChanged }: { habit: Habit; onChanged: () => void }) {
  const [entries, setEntries] = useState<HabitEntry[]>([]);
  const [stats, setStats] = useState<HabitStats | null>(null);
  const [busy, setBusy] = useState(false);

  const today = useMemo(() => todayIso(), []);
  const from = useMemo(() => isoMinusDays(83), []); // 84 days = 12 weeks

  const refresh = useCallback(async () => {
    const [e, s] = await Promise.all([
      ipc.habitEntries({ habit_id: habit.id, from_day: from, to_day: today }),
      ipc.habitStats({ habit_id: habit.id, today }),
    ]);
    setEntries(e);
    setStats(s);
  }, [habit.id, from, today]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const todayEntry = entries.find((e) => e.day === today) ?? null;
  const target = habit.target ?? (habit.kind === "bool" ? 1 : 0.0001);
  const todayComplete = todayEntry && !todayEntry.skipped && todayEntry.value >= target;
  const todaySkipped = todayEntry?.skipped === true;

  async function log(value: number, skipped = false) {
    if (busy) return;
    setBusy(true);
    try {
      await ipc.habitLog({ habit_id: habit.id, day: today, value, skipped });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (busy) return;
    setBusy(true);
    try {
      await ipc.habitClear({ habit_id: habit.id, day: today });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete habit "${habit.name}" and all its history?`)) return;
    await ipc.habitDelete(habit.id);
    onChanged();
  }

  return (
    <section className="rounded-xl border border-ink-700 bg-ink-900/60 p-4">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="w-3 h-3 rounded-full shrink-0"
            style={{ background: habit.color }}
          />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-ink-100 truncate">
              {habit.name}
            </div>
            <div className="text-[11px] text-ink-300 mt-0.5">
              {habit.kind === "bool"
                ? "Yes / No daily"
                : habit.target != null
                  ? `Target: ${habit.target}${habit.unit ? " " + habit.unit : ""}/day`
                  : `Any ${habit.unit ?? "amount"} counts`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <TodayControls
            habit={habit}
            todayEntry={todayEntry}
            busy={busy}
            onLog={log}
            onClear={clear}
          />
          <button
            onClick={remove}
            className="text-ink-400 hover:text-danger text-sm leading-none px-1"
            title="Delete habit"
          >
            🗑
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 items-start">
        <Heatmap
          entries={entries}
          fromDay={from}
          toDay={today}
          target={target}
          color={habit.color}
        />
        {stats && <StatsBlock stats={stats} color={habit.color} habit={habit} />}
      </div>

      {todaySkipped && (
        <div className="mt-3 text-[11px] text-ink-300">
          Marked as skipped for today — your streak is preserved.
        </div>
      )}
      {todayComplete && (
        <div className="mt-3 text-[11px] text-accent-glow">
          Done for today ✓
        </div>
      )}
    </section>
  );
}

// ── per-kind today controls ────────────────────────────────────────────────

function TodayControls({
  habit,
  todayEntry,
  busy,
  onLog,
  onClear,
}: {
  habit: Habit;
  todayEntry: HabitEntry | null;
  busy: boolean;
  onLog: (value: number, skipped?: boolean) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const skipBtn = (
    <button
      onClick={() => onLog(0, true)}
      disabled={busy}
      title="Skip today (preserves streak)"
      className="text-[11px] px-2 py-1 rounded-md hairline text-ink-200 hover:bg-ink-700 disabled:opacity-50"
    >
      Skip
    </button>
  );
  const clearBtn = todayEntry ? (
    <button
      onClick={onClear}
      disabled={busy}
      title="Clear today's entry"
      className="text-[11px] px-2 py-1 rounded-md text-ink-400 hover:text-ink-100 disabled:opacity-50"
    >
      ⟲
    </button>
  ) : null;

  if (habit.kind === "bool") {
    const done = !!todayEntry && !todayEntry.skipped && todayEntry.value >= 1;
    return (
      <div className="flex items-center gap-1">
        <button
          onClick={() => onLog(done ? 0 : 1)}
          disabled={busy}
          className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors disabled:opacity-50 ${
            done
              ? "bg-accent/40 text-accent-glow border border-accent/40"
              : "bg-ink-800 text-ink-200 hover:bg-ink-700 border border-ink-700"
          }`}
        >
          {done ? "✓ Done" : "Mark done"}
        </button>
        {skipBtn}
        {clearBtn}
      </div>
    );
  }

  if (habit.kind === "count") {
    const v = todayEntry && !todayEntry.skipped ? todayEntry.value : 0;
    return (
      <div className="flex items-center gap-1">
        <button
          onClick={() => onLog(Math.max(0, v - 1))}
          disabled={busy || v <= 0}
          className="text-xs px-2 py-1 rounded-md hairline hover:bg-ink-700 disabled:opacity-30"
        >
          −1
        </button>
        <span className="text-sm font-mono tnum text-ink-100 min-w-[3.5rem] text-center">
          {v}
          {habit.target != null && (
            <span className="text-ink-400 text-[10px]"> /{habit.target}</span>
          )}
        </span>
        <button
          onClick={() => onLog(v + 1)}
          disabled={busy}
          className="text-xs px-2 py-1 rounded-md bg-accent/25 hover:bg-accent/40 text-accent-glow disabled:opacity-50"
        >
          +1
        </button>
        {skipBtn}
        {clearBtn}
      </div>
    );
  }

  // amount
  const v = todayEntry && !todayEntry.skipped ? todayEntry.value : 0;
  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        min={0}
        step={0.1}
        value={v}
        onChange={(e) => onLog(Number(e.target.value) || 0)}
        disabled={busy}
        className="w-20 bg-ink-800 hairline rounded-md px-2 py-1 text-sm text-ink-100 text-right tnum"
      />
      {habit.unit && (
        <span className="text-[11px] text-ink-300">{habit.unit}</span>
      )}
      {skipBtn}
      {clearBtn}
    </div>
  );
}

// ── visual analytics ───────────────────────────────────────────────────────

function Heatmap({
  entries,
  fromDay,
  toDay,
  target,
  color,
}: {
  entries: HabitEntry[];
  fromDay: string;
  toDay: string;
  target: number;
  color: string;
}) {
  // Build a Map day→entry for O(1) lookup as we iterate.
  const byDay = useMemo(() => {
    const m = new Map<string, HabitEntry>();
    for (const e of entries) m.set(e.day, e);
    return m;
  }, [entries]);

  // Generate every day in the range, oldest → newest.
  const days = useMemo(() => {
    const out: string[] = [];
    const cur = new Date(fromDay + "T00:00:00");
    const end = new Date(toDay + "T00:00:00");
    while (cur <= end) {
      out.push(
        `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(
          cur.getDate(),
        ).padStart(2, "0")}`,
      );
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }, [fromDay, toDay]);

  // Bucket into columns of 7 (week). Pad the leading column so Mon is row 0.
  // JS getDay: 0=Sun..6=Sat → remap to Mon=0..Sun=6.
  const monIndex = (iso: string) => {
    const d = new Date(iso + "T00:00:00").getDay();
    return (d + 6) % 7;
  };

  const cols: Array<Array<string | null>> = [];
  let col: Array<string | null> = [];
  // pad the first column
  if (days.length > 0) {
    const offset = monIndex(days[0]);
    for (let i = 0; i < offset; i++) col.push(null);
  }
  for (const d of days) {
    col.push(d);
    if (col.length === 7) {
      cols.push(col);
      col = [];
    }
  }
  if (col.length > 0) {
    while (col.length < 7) col.push(null);
    cols.push(col);
  }

  function cellFill(day: string | null): string {
    if (!day) return "transparent";
    const e = byDay.get(day);
    if (!e) return "rgba(255,255,255,0.04)"; // no entry
    if (e.skipped) return "rgba(255,255,255,0.10)"; // neutral
    const ratio = Math.max(0, Math.min(1, e.value / target));
    if (ratio <= 0) return "rgba(232,125,125,0.18)"; // miss
    // intensity ramp using habit color
    const alpha = 0.25 + 0.65 * ratio;
    return hexWithAlpha(color, alpha);
  }

  const cellSize = 12;
  const gap = 3;
  const width = cols.length * (cellSize + gap);
  const height = 7 * (cellSize + gap);

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height + 14} className="block">
        {cols.map((c, ci) =>
          c.map((day, ri) => (
            <rect
              key={`${ci}-${ri}`}
              x={ci * (cellSize + gap)}
              y={ri * (cellSize + gap)}
              width={cellSize}
              height={cellSize}
              rx={2}
              fill={cellFill(day)}
            >
              {day && <title>{`${day}${describeEntry(byDay.get(day), target)}`}</title>}
            </rect>
          )),
        )}
        <text x={0} y={height + 11} fontSize={9} fill="#8a93a3">
          {fromDay}
        </text>
        <text
          x={width}
          y={height + 11}
          fontSize={9}
          textAnchor="end"
          fill="#8a93a3"
        >
          {toDay} · today
        </text>
      </svg>
    </div>
  );
}

function describeEntry(e: HabitEntry | undefined, target: number): string {
  if (!e) return " · no entry";
  if (e.skipped) return " · skipped";
  if (e.value >= target) return ` · done (${e.value})`;
  return ` · ${e.value} / ${target}`;
}

function StatsBlock({
  stats,
  color,
  habit,
}: {
  stats: HabitStats;
  color: string;
  habit: Habit;
}) {
  const target = habit.target ?? (habit.kind === "bool" ? 1 : 0.0001);
  return (
    <div className="flex flex-col gap-3 min-w-[260px]">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Streak" value={`${stats.current_streak}d`} />
        <Stat label="Best" value={`${stats.best_streak}d`} />
        <Stat label="30-day" value={`${Math.round(stats.completion_30d * 100)}%`} />
        <Stat label="All-time" value={`${Math.round(stats.completion_all * 100)}%`} />
      </div>
      <Sparkline data={stats.sparkline_30d} target={target} color={color} />
      <WeekdayBars rates={stats.weekday_rate} color={color} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-ink-800/60 rounded-md px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-ink-300">{label}</div>
      <div className="text-base font-semibold tnum text-ink-100 mt-0.5">{value}</div>
    </div>
  );
}

function Sparkline({
  data,
  target,
  color,
}: {
  data: number[];
  target: number;
  color: string;
}) {
  const w = 260;
  const h = 36;
  const max = Math.max(target, ...data, 1);
  const bw = w / data.length;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-ink-300 mb-1">
        Last 30 days
      </div>
      <svg width={w} height={h} className="block">
        {/* target line */}
        {target > 0 && target <= max && (
          <line
            x1={0}
            x2={w}
            y1={h - (target / max) * h}
            y2={h - (target / max) * h}
            stroke="rgba(255,255,255,0.18)"
            strokeDasharray="2 3"
          />
        )}
        {data.map((v, i) => {
          const bh = Math.max(1, (v / max) * h);
          const met = v >= target && target > 0;
          return (
            <rect
              key={i}
              x={i * bw + 1}
              y={h - bh}
              width={Math.max(1, bw - 2)}
              height={bh}
              rx={1}
              fill={met ? color : "rgba(255,255,255,0.15)"}
            />
          );
        })}
      </svg>
    </div>
  );
}

function WeekdayBars({ rates, color }: { rates: number[]; color: string }) {
  const labels = ["M", "T", "W", "T", "F", "S", "S"];
  const w = 260;
  const h = 40;
  const bw = w / 7;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-ink-300 mb-1">
        By weekday
      </div>
      <svg width={w} height={h + 12} className="block">
        {rates.map((r, i) => {
          const bh = Math.max(1, r * h);
          return (
            <g key={i}>
              <rect
                x={i * bw + 3}
                y={h - bh}
                width={bw - 6}
                height={bh}
                rx={2}
                fill={hexWithAlpha(color, 0.6)}
              />
              <text
                x={i * bw + bw / 2}
                y={h + 10}
                fontSize={9}
                textAnchor="middle"
                fill="#8a93a3"
              >
                {labels[i]}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="m-auto max-w-md text-center px-4 py-12 text-ink-300">
      <h3 className="text-base font-semibold text-ink-100 mb-2">
        Start with one habit
      </h3>
      <p className="text-sm leading-relaxed">
        Pick something small enough that you can't fail. Two push-ups, one
        sentence in a journal, a single glass of water. Show up daily;
        intensity comes later.
      </p>
      <button
        onClick={onAdd}
        className="mt-5 text-xs px-3 py-1.5 rounded-md bg-accent/30 hover:bg-accent/50 text-accent-glow"
      >
        + Add your first habit
      </button>
      <p className="mt-4 text-[11px] text-ink-400">
        Skip-day support, no streak shaming, no paywalls. All data stays on
        your machine.
      </p>
    </div>
  );
}

// ── color helper ───────────────────────────────────────────────────────────

function hexWithAlpha(hex: string, a: number): string {
  // Accepts #rrggbb. Returns rgba() string with given alpha.
  if (!/^#?[0-9a-fA-F]{6}$/.test(hex.replace(/^#/, ""))) {
    return `rgba(124,156,255,${a})`;
  }
  const h = hex.replace(/^#/, "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
