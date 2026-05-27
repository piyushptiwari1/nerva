import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ipc,
  type Habit,
  type HabitEntry,
  type HabitKind,
  type HabitStats,
} from "@/lib/ipc";
import { useHabitsUi } from "@/store/habits";

/**
 * HabitsPane — daily habit tracker.
 *
 * Visual language matches the rest of Nerva: matte ink shell, `glass` panels,
 * accent-blue glow for affirmative state, deliberately soft red for misses.
 * Charts are hand-drawn SVG to avoid pulling a chart library.
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
      setHabits(await ipc.habitList());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, hide]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          className="fixed inset-0 z-50 flex items-stretch justify-end bg-ink-950/55 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) hide();
          }}
        >
          <motion.div
            initial={{ x: 32, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 32, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="w-[min(960px,96vw)] h-full bg-ink-900/95 border-l border-ink-700/60 backdrop-blur-md shadow-2xl flex flex-col"
          >
            <header className="px-5 py-3 border-b border-ink-700/50 flex items-center justify-between bg-gradient-to-b from-ink-800/40 to-transparent">
              <div className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-md bg-accent/20 border border-accent/30 grid place-items-center text-accent-glow text-[11px] font-semibold">
                  ✓
                </span>
                <div>
                  <h2 className="text-sm font-semibold text-ink-100 tracking-tight">
                    Habits
                  </h2>
                  <p className="text-[10.5px] text-ink-400 mt-0.5">
                    Daily tracker · skip-day honored · local-first
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowNew((v) => !v)}
                  className={`text-[11px] px-3 py-1.5 rounded-md transition-colors border ${
                    showNew
                      ? "bg-ink-800 text-ink-200 border-ink-700"
                      : "bg-accent/20 hover:bg-accent/30 text-accent-glow border-accent/30"
                  }`}
                >
                  {showNew ? "Cancel" : "+ New habit"}
                </button>
                <span className="text-[10px] text-ink-500 mx-1">
                  <kbd className="border border-ink-700 rounded px-1 py-0.5">
                    Esc
                  </kbd>
                </span>
                <button
                  onClick={hide}
                  className="text-ink-400 hover:text-ink-100 hover:bg-ink-800 w-7 h-7 rounded-md grid place-items-center transition-colors"
                  title="Close"
                >
                  ×
                </button>
              </div>
            </header>

            <AnimatePresence initial={false}>
              {showNew && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="overflow-hidden border-b border-ink-700/50"
                >
                  <NewHabitForm
                    onCreated={async () => {
                      setShowNew(false);
                      await refresh();
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-3">
              {loading && habits.length === 0 && (
                <div className="text-xs text-ink-400 px-2">Loading…</div>
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
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── palette ────────────────────────────────────────────────────────────────
// Picked for the matte ink theme: cool blue (default), warm amber, rest-green,
// magenta, teal, sand, lime, coral, lavender. All sit comfortably against
// ink-900 with the alpha-ramp heatmap.
const PALETTE = [
  "#7c9cff", // accent blue
  "#e8b86d", // focus amber
  "#7dd6a8", // rest green
  "#d27dff", // magenta
  "#7de8e0", // teal
  "#ffd07d", // sand
  "#9ce87d", // lime
  "#ff9a8b", // coral
  "#b3a8ff", // lavender
];

// ────────────────────────────────────────────────────────────────────────────

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
    <div className="px-5 py-4 bg-ink-800/30 flex flex-col gap-3">
      <div className="flex gap-2">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Habit name — e.g. Meditate, Push-ups, Water"
          className="flex-1 bg-ink-900/80 hairline rounded-md px-3 py-2 text-sm text-ink-100 placeholder:text-ink-500 focus:outline-none focus:border-accent/40"
        />
        <div className="flex rounded-md overflow-hidden hairline">
          {(["bool", "count", "amount"] as HabitKind[]).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`text-[11px] px-3 py-2 transition-colors ${
                kind === k
                  ? "bg-accent/25 text-accent-glow"
                  : "bg-ink-900/60 text-ink-300 hover:text-ink-100"
              }`}
            >
              {k === "bool" ? "Yes / No" : k === "count" ? "Count" : "Amount"}
            </button>
          ))}
        </div>
      </div>
      {kind !== "bool" && (
        <div className="flex gap-2">
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder={
              kind === "count"
                ? "Daily target (e.g. 20)"
                : "Daily target (e.g. 30)"
            }
            type="number"
            min={0}
            step={kind === "count" ? 1 : 0.1}
            className="flex-1 bg-ink-900/80 hairline rounded-md px-3 py-2 text-sm text-ink-100 placeholder:text-ink-500 focus:outline-none focus:border-accent/40"
          />
          <input
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder={kind === "count" ? "reps" : "min, ml, km…"}
            className="w-36 bg-ink-900/80 hairline rounded-md px-3 py-2 text-sm text-ink-100 placeholder:text-ink-500 focus:outline-none focus:border-accent/40"
          />
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-ink-400 mr-1">
          Color
        </span>
        {PALETTE.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            className={`w-5 h-5 rounded-full transition-transform ${
              color === c
                ? "ring-2 ring-offset-2 ring-offset-ink-900 ring-ink-100 scale-110"
                : "hover:scale-110"
            }`}
            style={{ background: c }}
            aria-label={`color ${c}`}
          />
        ))}
        <div className="flex-1" />
        <button
          onClick={submit}
          disabled={!name.trim() || busy}
          className="text-[11px] px-3 py-1.5 rounded-md bg-accent/30 hover:bg-accent/50 text-accent-glow border border-accent/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {busy ? "Adding…" : "Add habit"}
        </button>
      </div>
    </div>
  );
}

// ── date utils ─────────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────────────────────────

function HabitRow({
  habit,
  onChanged,
}: {
  habit: Habit;
  onChanged: () => void;
}) {
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
  const todayComplete =
    !!todayEntry && !todayEntry.skipped && todayEntry.value >= target;
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
    <motion.section
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className={`relative rounded-xl border bg-ink-900/60 p-4 transition-colors ${
        todayComplete
          ? "border-accent/30 shadow-[0_0_24px_-12px_rgba(124,156,255,0.5)]"
          : todaySkipped
            ? "border-ink-700/60"
            : "border-ink-700/50 hover:border-ink-600/60"
      }`}
    >
      {/* Color stripe on left edge keeps habits visually distinct at a glance. */}
      <span
        className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full"
        style={{ background: habit.color, opacity: 0.85 }}
      />

      <div className="flex items-start justify-between gap-4 mb-3 pl-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-ink-100 truncate flex items-center gap-2">
            {habit.name}
            {todayComplete && (
              <span className="text-[10px] font-medium text-accent-glow bg-accent/20 px-1.5 py-0.5 rounded">
                done today
              </span>
            )}
            {todaySkipped && (
              <span className="text-[10px] font-medium text-ink-300 bg-ink-700/60 px-1.5 py-0.5 rounded">
                skipped
              </span>
            )}
          </div>
          <div className="text-[11px] text-ink-400 mt-0.5">
            {habit.kind === "bool"
              ? "Yes / No daily"
              : habit.target != null
                ? `Target ${habit.target}${habit.unit ? " " + habit.unit : ""}/day`
                : `Any ${habit.unit ?? "amount"} counts`}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <TodayControls
            habit={habit}
            todayEntry={todayEntry}
            busy={busy}
            onLog={log}
            onClear={clear}
          />
          <button
            onClick={remove}
            className="text-ink-500 hover:text-danger w-7 h-7 grid place-items-center rounded-md hover:bg-ink-800 transition-colors"
            title="Delete habit"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-5 items-start pl-2">
        <Heatmap
          entries={entries}
          fromDay={from}
          toDay={today}
          target={target}
          color={habit.color}
        />
        {stats && <StatsBlock stats={stats} color={habit.color} habit={habit} />}
      </div>
    </motion.section>
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
      title="Skip today — your streak is preserved"
      className="text-[10.5px] px-2 py-1.5 rounded-md text-ink-300 hover:text-ink-100 hover:bg-ink-800 border border-ink-700/60 transition-colors disabled:opacity-40"
    >
      Skip
    </button>
  );
  const clearBtn = todayEntry ? (
    <button
      onClick={onClear}
      disabled={busy}
      title="Clear today's entry"
      className="w-7 h-7 grid place-items-center rounded-md text-ink-500 hover:text-ink-100 hover:bg-ink-800 transition-colors disabled:opacity-40"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 12a9 9 0 1 0 3-6.7" />
        <path d="M3 4v5h5" />
      </svg>
    </button>
  ) : null;

  if (habit.kind === "bool") {
    const done = !!todayEntry && !todayEntry.skipped && todayEntry.value >= 1;
    return (
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onLog(done ? 0 : 1)}
          disabled={busy}
          className={`text-[11px] px-3 py-1.5 rounded-md font-medium border transition-all disabled:opacity-50 ${
            done
              ? "bg-accent/30 text-accent-glow border-accent/40 shadow-[0_0_18px_-8px_rgba(124,156,255,0.7)]"
              : "bg-ink-800/80 text-ink-100 hover:bg-ink-700 border-ink-700"
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
    const met = habit.target != null && v >= habit.target;
    return (
      <div className="flex items-center gap-1.5">
        <div
          className={`flex items-center rounded-md overflow-hidden border ${
            met ? "border-accent/40" : "border-ink-700"
          }`}
        >
          <button
            onClick={() => onLog(Math.max(0, v - 1))}
            disabled={busy || v <= 0}
            className="px-2 py-1.5 text-ink-300 hover:bg-ink-700 hover:text-ink-100 disabled:opacity-30 transition-colors"
          >
            −
          </button>
          <span
            className={`text-sm font-mono tnum min-w-[3.5rem] text-center px-1 ${
              met ? "text-accent-glow" : "text-ink-100"
            }`}
          >
            {v}
            {habit.target != null && (
              <span className="text-ink-500 text-[10px]"> /{habit.target}</span>
            )}
          </span>
          <button
            onClick={() => onLog(v + 1)}
            disabled={busy}
            className="px-2 py-1.5 bg-accent/15 text-accent-glow hover:bg-accent/30 transition-colors disabled:opacity-50"
          >
            +
          </button>
        </div>
        {skipBtn}
        {clearBtn}
      </div>
    );
  }

  // amount
  const v = todayEntry && !todayEntry.skipped ? todayEntry.value : 0;
  const met = habit.target != null && v >= habit.target;
  return (
    <div className="flex items-center gap-1.5">
      <div
        className={`flex items-center gap-1 bg-ink-900 rounded-md border px-1 ${
          met ? "border-accent/40" : "border-ink-700"
        }`}
      >
        <input
          type="number"
          min={0}
          step={0.1}
          value={v}
          onChange={(e) => onLog(Number(e.target.value) || 0)}
          disabled={busy}
          className={`w-20 bg-transparent px-2 py-1.5 text-sm tnum text-right focus:outline-none ${
            met ? "text-accent-glow" : "text-ink-100"
          }`}
        />
        {habit.unit && (
          <span className="text-[10px] text-ink-400 pr-1.5">{habit.unit}</span>
        )}
      </div>
      {skipBtn}
      {clearBtn}
    </div>
  );
}

// ── analytics: heatmap, sparkline, weekday bars ────────────────────────────

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
  const byDay = useMemo(() => {
    const m = new Map<string, HabitEntry>();
    for (const e of entries) m.set(e.day, e);
    return m;
  }, [entries]);

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

  const monIndex = (iso: string) => {
    const d = new Date(iso + "T00:00:00").getDay();
    return (d + 6) % 7;
  };

  const cols: Array<Array<string | null>> = [];
  let col: Array<string | null> = [];
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
    if (!e) return "rgba(255,255,255,0.035)"; // no entry
    if (e.skipped) return "rgba(167,175,190,0.18)"; // soft neutral
    const ratio = Math.max(0, Math.min(1, e.value / target));
    if (ratio <= 0) return "rgba(232,125,125,0.14)";
    const alpha = 0.22 + 0.68 * ratio;
    return hexWithAlpha(color, alpha);
  }

  const cellSize = 12;
  const gap = 3;
  const width = cols.length * (cellSize + gap);
  const height = 7 * (cellSize + gap);

  return (
    <div className="overflow-x-auto">
      <div className="text-[10px] uppercase tracking-wider text-ink-400 mb-1.5">
        Last 12 weeks
      </div>
      <svg width={width} height={height + 16} className="block">
        {cols.map((c, ci) =>
          c.map((day, ri) => {
            const isToday = day === toDay;
            return (
              <rect
                key={`${ci}-${ri}`}
                x={ci * (cellSize + gap)}
                y={ri * (cellSize + gap)}
                width={cellSize}
                height={cellSize}
                rx={2.5}
                fill={cellFill(day)}
                stroke={isToday ? hexWithAlpha(color, 0.95) : "none"}
                strokeWidth={isToday ? 1.5 : 0}
              >
                {day && (
                  <title>{`${day}${describeEntry(byDay.get(day), target)}`}</title>
                )}
              </rect>
            );
          }),
        )}
        <text x={0} y={height + 13} fontSize={9} fill="#7a8494">
          {fromDay}
        </text>
        <text
          x={width}
          y={height + 13}
          fontSize={9}
          textAnchor="end"
          fill="#7a8494"
        >
          today
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
    <div className="flex flex-col gap-3 min-w-[268px]">
      <div className="grid grid-cols-4 gap-1.5">
        <Stat
          label="Streak"
          value={`${stats.current_streak}`}
          suffix="d"
          accent={stats.current_streak > 0 ? color : undefined}
        />
        <Stat label="Best" value={`${stats.best_streak}`} suffix="d" />
        <Stat
          label="30-day"
          value={`${Math.round(stats.completion_30d * 100)}`}
          suffix="%"
        />
        <Stat label="Total" value={`${stats.total_completions}`} />
      </div>
      <Sparkline data={stats.sparkline_30d} target={target} color={color} />
      <WeekdayBars rates={stats.weekday_rate} color={color} />
    </div>
  );
}

function Stat({
  label,
  value,
  suffix,
  accent,
}: {
  label: string;
  value: string;
  suffix?: string;
  accent?: string;
}) {
  return (
    <div className="bg-ink-800/50 hairline rounded-md px-2 py-1.5">
      <div className="text-[9.5px] uppercase tracking-wider text-ink-400">
        {label}
      </div>
      <div
        className="text-sm font-semibold tnum mt-0.5 leading-tight"
        style={{ color: accent ?? "#ecf0f6" }}
      >
        {value}
        {suffix && (
          <span className="text-[10px] text-ink-400 font-normal ml-0.5">
            {suffix}
          </span>
        )}
      </div>
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
  const innerW = 256;
  const h = 38;
  const max = Math.max(target, ...data, 1);
  const cellW = innerW / data.length;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-ink-400 mb-1">
        Last 30 days
      </div>
      <div className="bg-ink-800/40 hairline rounded-md p-1.5">
        <svg width={innerW} height={h} className="block">
          {target > 0 && target <= max && (
            <line
              x1={0}
              x2={innerW}
              y1={h - (target / max) * h + 0.5}
              y2={h - (target / max) * h + 0.5}
              stroke="rgba(255,255,255,0.15)"
              strokeDasharray="2 3"
            />
          )}
          {data.map((v, i) => {
            const bh = Math.max(2, (v / max) * h);
            const met = v >= target && target > 0;
            return (
              <rect
                key={i}
                x={i * cellW + 1}
                y={h - bh}
                width={Math.max(1.5, cellW - 2)}
                height={bh}
                rx={1.5}
                fill={met ? color : hexWithAlpha(color, 0.22)}
              />
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function WeekdayBars({ rates, color }: { rates: number[]; color: string }) {
  const labels = ["M", "T", "W", "T", "F", "S", "S"];
  const innerW = 256;
  const h = 38;
  const bw = innerW / 7;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-ink-400 mb-1">
        By weekday
      </div>
      <div className="bg-ink-800/40 hairline rounded-md p-1.5">
        <svg width={innerW} height={h + 13} className="block">
          {rates.map((r, i) => {
            const bh = Math.max(2, r * h);
            return (
              <g key={i}>
                <rect
                  x={i * bw + 3}
                  y={h - bh}
                  width={bw - 6}
                  height={bh}
                  rx={2}
                  fill={hexWithAlpha(color, 0.25 + 0.6 * r)}
                />
                <text
                  x={i * bw + bw / 2}
                  y={h + 11}
                  fontSize={9}
                  textAnchor="middle"
                  fill="#7a8494"
                >
                  {labels[i]}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="m-auto max-w-md text-center px-4 py-12">
      <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-accent/15 border border-accent/25 grid place-items-center text-accent-glow text-lg">
        ✓
      </div>
      <h3 className="text-base font-semibold text-ink-100 mb-2">
        Start with one habit
      </h3>
      <p className="text-sm leading-relaxed text-ink-300">
        Pick something small enough that you can't fail. Two push-ups, one
        sentence in a journal, a single glass of water. Show up daily;
        intensity comes later.
      </p>
      <button
        onClick={onAdd}
        className="mt-5 text-[11px] px-3 py-1.5 rounded-md bg-accent/25 hover:bg-accent/40 text-accent-glow border border-accent/30 transition-colors"
      >
        + Add your first habit
      </button>
      <p className="mt-4 text-[10.5px] text-ink-500">
        Skip-days preserved · no streak shaming · all data stays on this
        machine.
      </p>
    </div>
  );
}

// ── color helper ───────────────────────────────────────────────────────────

function hexWithAlpha(hex: string, a: number): string {
  if (!/^#?[0-9a-fA-F]{6}$/.test(hex.replace(/^#/, ""))) {
    return `rgba(124,156,255,${a})`;
  }
  const h = hex.replace(/^#/, "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
