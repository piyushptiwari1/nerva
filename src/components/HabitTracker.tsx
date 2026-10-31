import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, Check, Flame, Minus, Pencil, Plus, Trash2, X } from "lucide-react";
import { ipc, type Habit, type HabitEntry, type HabitKind, type HabitStats } from "@/lib/ipc";
import { useApp } from "@/store/app";
import { inWorkspace } from "@/lib/workspaces";
import { isMobile } from "@/lib/platform";
import { haptic } from "@/lib/haptics";
import { SectionHead } from "@/components/SectionHead";
import { Heatmap, isoMinusDays, todayIso } from "@/components/habitHeat";
import { useReminders } from "@/store/reminders";

const PALETTE = ["#7c9cff", "#e8b86d", "#7dd6a8", "#d27dff", "#7de8e0", "#ffd07d", "#9ce87d", "#ff9a8b", "#b3a8ff"];
/** Lally et al. 2010 median for a habit becoming automatic; the book quotes it. */
const MILESTONES = [7, 21, 66, 100, 365];

type Sheet = { kind: "new" } | { kind: "detail"; id: string } | { kind: "edit"; id: string } | null;

/**
 * One habit surface for every platform: tap the ring to log today, tap the
 * row for history and the Atomic Habits view (never miss twice, cue, tiny
 * version, identity). Creating and editing happen in a sheet, never in a
 * second list.
 */
export function HabitTracker({ compact = false }: { compact?: boolean }) {
  const workspaceId = useApp((s) => s.active?.id ?? null);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [today, setToday] = useState(() => todayIso());
  const [todayMap, setTodayMap] = useState<Record<string, HabitEntry | null>>({});
  const [stats, setStats] = useState<Record<string, HabitStats>>({});
  const [sheet, setSheet] = useState<Sheet>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const day = todayIso();
    setToday(day);
    let list: Habit[] = [];
    try { list = await ipc.habitList(); } catch { return; }
    setHabits(list);
    const live = list.filter((h) => !h.archived);
    const [entries, statRows] = await Promise.all([
      Promise.all(live.map(async (h) => {
        try { const e = await ipc.habitEntries({ habit_id: h.id, from_day: day, to_day: day }); return [h.id, e[0] ?? null] as const; }
        catch { return [h.id, null] as const; }
      })),
      Promise.all(live.map(async (h) => {
        try { return [h.id, await ipc.habitStats({ habit_id: h.id, today: day })] as const; }
        catch { return [h.id, null] as const; }
      })),
    ]);
    setTodayMap(Object.fromEntries(entries));
    setStats(Object.fromEntries(statRows.filter((r): r is readonly [string, HabitStats] => r[1] !== null)));
  }, []);

  useEffect(() => {
    void refresh();
    let unlisten: Array<() => void> = [];
    let cancelled = false;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const subs = await Promise.all([
          listen("habit:changed", () => void refresh()),
          listen("workspace:activated", () => void refresh()),
        ]);
        if (cancelled) subs.forEach((u) => u()); else unlisten = subs;
      } catch { /* outside Tauri */ }
    })();
    const onVis = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { cancelled = true; unlisten.forEach((u) => u()); document.removeEventListener("visibilitychange", onVis); };
  }, [refresh]);

  const visible = habits.filter((h) => !h.archived && inWorkspace(h, workspaceId));
  const doneCount = visible.filter((h) => isDone(h, todayMap[h.id] ?? null)).length;

  async function log(h: Habit, mode: "toggle" | "inc" | "dec") {
    if (busy) return;
    setBusy(h.id);
    haptic.select();
    try {
      const cur = todayMap[h.id] ?? null;
      const before = stats[h.id]?.current_streak ?? 0;
      let nowDone = false;
      if (h.kind === "bool") {
        if (cur && !cur.skipped && cur.value >= 1) await ipc.habitClear({ habit_id: h.id, day: today });
        else { await ipc.habitLog({ habit_id: h.id, day: today, value: 1 }); nowDone = true; }
      } else {
        const target = h.target ?? 1;
        const step = h.kind === "count" ? 1 : Math.max(1, Math.round(target / 4));
        const base = cur && !cur.skipped ? cur.value : 0;
        const next = Math.max(0, base + (mode === "dec" ? -step : step));
        if (next === 0) await ipc.habitClear({ habit_id: h.id, day: today });
        else await ipc.habitLog({ habit_id: h.id, day: today, value: next });
        nowDone = next >= target && base < target;
      }
      await refresh();
      if (nowDone) {
        const after = before + 1;
        if (MILESTONES.includes(after)) { haptic.celebrate(); setToast(`${after} days — ${milestoneLine(after)}`); }
        else { haptic.complete(); setToast(after > 1 ? `Day ${after} of ${h.name}` : `${h.name} — day one`); }
        window.setTimeout(() => setToast(null), 2600);
      }
    } catch (e) {
      haptic.error();
      setToast(String(e)); window.setTimeout(() => setToast(null), 3000);
    } finally { setBusy(null); }
  }

  async function skipToday(h: Habit) {
    haptic.warn();
    await ipc.habitLog({ habit_id: h.id, day: today, value: 0, skipped: true });
    await refresh();
  }

  const identity = visible.map((h) => h.identity).find(Boolean);

  return (
    <div className="habit-tracker flex flex-col min-h-0">
      <SectionHead
        title="Habits"
        count={visible.length}
        sub={visible.length ? `${doneCount} of ${visible.length} done today${identity ? ` · ${identity}` : ""}` : "Small votes for the person you want to be"}
        actions={
          <button onClick={() => { haptic.tap(); setSheet({ kind: "new" }); }} className="btn-primary" aria-label="New habit">
            <Plus size={16} /> New habit
          </button>
        }
      />

      {visible.length === 0 ? (
        <button onClick={() => setSheet({ kind: "new" })} className="habit-empty">
          <span className="text-[15px] font-semibold text-ink-100">Start with one tiny habit</span>
          <span className="text-[13px] text-ink-400">Two minutes a day beats a perfect plan. Tap to add your first.</span>
        </button>
      ) : (
        <ul className="habit-list" aria-label="Habits">
          {(compact ? visible.slice(0, 6) : visible).map((h) => {
            const cur = todayMap[h.id] ?? null;
            const st = stats[h.id];
            const done = isDone(h, cur);
            const progress = progressOf(h, cur);
            const risk = (st?.misses_in_a_row ?? 0) >= 1 && !done;
            return (
              <li key={h.id} className={`habit-row ${done ? "is-done" : ""}`}>
                <button
                  onClick={() => void log(h, "toggle")}
                  disabled={busy === h.id}
                  className="habit-ring"
                  aria-label={done ? `${h.name}: done today. Tap to undo` : `${h.name}: log today`}
                  style={{ "--habit-color": h.color, "--habit-progress": progress } as React.CSSProperties}
                >
                  <svg viewBox="0 0 44 44" aria-hidden="true">
                    <circle cx="22" cy="22" r="19" className="habit-ring-track" />
                    <circle cx="22" cy="22" r="19" className="habit-ring-fill" pathLength={100} />
                  </svg>
                  <AnimatePresence initial={false} mode="wait">
                    {done ? (
                      <motion.span key="done" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={{ type: "spring", stiffness: 520, damping: 26 }} className="habit-ring-icon">
                        <Check size={18} strokeWidth={3} />
                      </motion.span>
                    ) : h.kind !== "bool" && cur && !cur.skipped && cur.value > 0 ? (
                      <motion.span key="val" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="habit-ring-value tnum">{fmt(cur.value)}</motion.span>
                    ) : (
                      <motion.span key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="habit-ring-dot" />
                    )}
                  </AnimatePresence>
                </button>
                <button onClick={() => { haptic.tap(); setSheet({ kind: "detail", id: h.id }); }} className="habit-body" aria-label={`${h.name}. Open history`}>
                  <span className="habit-name">{h.name}</span>
                  <span className="habit-meta">
                    {h.cue ? <span className="truncate">{h.cue}</span> : h.kind !== "bool" && h.target ? <span className="tnum">{fmt(cur && !cur.skipped ? cur.value : 0)} / {fmt(h.target)}{h.unit ? ` ${h.unit}` : ""}</span> : <span>{st?.completion_30d != null ? `${Math.round(st.completion_30d * 100)}% this month` : ""}</span>}
                  </span>
                </button>
                <div className="habit-side">
                  {st && st.current_streak > 0 && (
                    <span className="habit-streak" title="Current streak">
                      <Flame size={14} /> <span className="tnum">{st.current_streak}</span>
                    </span>
                  )}
                  {risk && <span className="habit-risk" title={`${st!.misses_in_a_row} missed in a row — never miss twice`}>{st!.misses_in_a_row >= 2 ? "Missed twice" : "Don't miss twice"}</span>}
                  {h.kind !== "bool" && !done && (
                    <button onClick={() => void log(h, "inc")} className="habit-plus" aria-label={`Add to ${h.name}`}><Plus size={18} /></button>
                  )}
                </div>
              </li>
            );
          })}
          {compact && visible.length > 6 && (
            <li><button onClick={() => setSheet({ kind: "new" })} className="text-[12px] text-ink-400 px-2 py-2">+{visible.length - 6} more in the full tracker</button></li>
          )}
        </ul>
      )}

      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="habit-toast" role="status">
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {sheet?.kind === "new" && (
          <HabitEditorSheet key="new" onClose={() => setSheet(null)} onSaved={async () => { setSheet(null); await refresh(); }} />
        )}
        {sheet?.kind === "edit" && (
          <HabitEditorSheet key={`edit-${sheet.id}`} habit={habits.find((h) => h.id === sheet.id)} onClose={() => setSheet({ kind: "detail", id: sheet.id })} onSaved={async () => { setSheet({ kind: "detail", id: sheet.id }); await refresh(); }} />
        )}
        {sheet?.kind === "detail" && habits.find((h) => h.id === sheet.id) && (
          <HabitDetailSheet
            key={`detail-${sheet.id}`}
            habit={habits.find((h) => h.id === sheet.id)!}
            stats={stats[sheet.id]}
            today={today}
            entry={todayMap[sheet.id] ?? null}
            onClose={() => setSheet(null)}
            onEdit={() => setSheet({ kind: "edit", id: sheet.id })}
            onLog={(mode) => void log(habits.find((h) => h.id === sheet.id)!, mode)}
            onSkip={() => void skipToday(habits.find((h) => h.id === sheet.id)!)}
            onDeleted={async () => { setSheet(null); await refresh(); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function isDone(h: Habit, cur: HabitEntry | null): boolean {
  if (!cur || cur.skipped) return false;
  return cur.value >= (h.target ?? (h.kind === "bool" ? 1 : 0.0001));
}
function progressOf(h: Habit, cur: HabitEntry | null): number {
  if (!cur || cur.skipped) return 0;
  const t = h.target ?? (h.kind === "bool" ? 1 : cur.value || 1);
  return Math.max(0, Math.min(1, cur.value / t));
}
function fmt(n: number): string { return Number.isInteger(n) ? String(n) : n.toFixed(1); }
function milestoneLine(n: number): string {
  return n === 7 ? "a full week. The chain is real." : n === 21 ? "three weeks. It's becoming who you are." : n === 66 ? "the point where most habits turn automatic." : n === 100 ? "a hundred. Remarkable." : "a year. Unstoppable.";
}

// ── Sheets ────────────────────────────────────────────────────────────────

function Sheet({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const mobile = isMobile();
  return (
    <>
      <motion.div className="mobile-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div
        role="dialog"
        aria-label={title}
        className={mobile ? "mobile-sheet" : `habit-dialog popover ${wide ? "habit-dialog-wide" : ""}`}
        initial={mobile ? { y: "100%" } : { opacity: 0, scale: 0.97, y: 8 }}
        animate={mobile ? { y: 0 } : { opacity: 1, scale: 1, y: 0 }}
        exit={mobile ? { y: "100%" } : { opacity: 0, scale: 0.98, y: 6 }}
        transition={{ type: "spring", stiffness: 420, damping: 38 }}
      >
        {mobile && <div className="mobile-sheet-grip" aria-hidden="true" />}
        <div className="flex items-center gap-2 mb-2">
          <div className="mobile-sheet-title flex-1 !mb-0">{title}</div>
          <button onClick={onClose} className="icon-button-sm" aria-label="Close"><X size={16} /></button>
        </div>
        {children}
      </motion.div>
    </>
  );
}

function HabitEditorSheet({ habit, onClose, onSaved }: { habit?: Habit; onClose: () => void; onSaved: () => Promise<void> }) {
  const active = useApp((s) => s.active);
  const [name, setName] = useState(habit?.name ?? "");
  const [kind, setKind] = useState<HabitKind>(habit?.kind ?? "bool");
  const [target, setTarget] = useState(habit?.target ? String(habit.target) : "");
  const [unit, setUnit] = useState(habit?.unit ?? "");
  const [color, setColor] = useState(habit?.color ?? PALETTE[Math.floor(Math.random() * PALETTE.length)]);
  const [cue, setCue] = useState(habit?.cue ?? "");
  const [tiny, setTiny] = useState(habit?.tiny ?? "");
  const [identity, setIdentity] = useState(habit?.identity ?? "");
  const [reminder, setReminder] = useState(habit?.reminder_hhmm ?? "");
  const [more, setMore] = useState(!!(habit?.cue || habit?.tiny || habit?.identity || habit?.reminder_hhmm));
  const [err, setErr] = useState<string | null>(null);
  const refreshReminders = useReminders((s) => s.refresh);

  async function save() {
    const n = name.trim();
    if (!n) { setErr("Give the habit a name"); return; }
    const t = kind === "bool" ? null : target.trim() ? Number(target) : null;
    if (t !== null && (!Number.isFinite(t) || t <= 0)) { setErr("Target must be a positive number"); return; }
    try {
      const payload = { name: n, target: t, unit: kind === "bool" ? null : unit.trim() || null, color, cue: cue.trim() || null, tiny: tiny.trim() || null, identity: identity.trim() || null, reminder_hhmm: reminder || null };
      const saved = habit
        ? await ipc.habitUpdate({ id: habit.id, ...payload })
        : await ipc.habitCreate({ kind, workspace_id: active?.id, ...payload });
      await syncHabitReminder(saved, active?.id ?? null);
      await refreshReminders();
      haptic.complete();
      await onSaved();
    } catch (e) { haptic.error(); setErr(String(e)); }
  }

  return (
    <Sheet title={habit ? "Edit habit" : "New habit"} onClose={onClose}>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void save()} placeholder="Read 10 pages" className="field mobile-wide text-[17px] font-semibold" aria-label="Habit name" />
      {!habit && (
        <>
          <div className="mobile-sheet-label">Track as</div>
          <div className="mobile-segment" role="radiogroup" aria-label="Kind">
            {([["bool", "Done / not"], ["count", "Count"], ["amount", "Amount"]] as const).map(([k, label]) => (
              <button key={k} role="radio" aria-checked={kind === k} onClick={() => { haptic.tap(); setKind(k); }} className={`mobile-segment-item ${kind === k ? "is-active" : ""}`}>{label}</button>
            ))}
          </div>
        </>
      )}
      {kind !== "bool" && (
        <div className="flex gap-2 mt-2">
          <input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" placeholder={kind === "count" ? "Target, e.g. 8" : "Target, e.g. 30"} className="field flex-1 tnum" aria-label="Daily target" />
          <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder={kind === "count" ? "glasses" : "min"} className="field w-28" aria-label="Unit" />
        </div>
      )}
      <div className="mobile-sheet-label">Colour</div>
      <div className="habit-palette" role="radiogroup" aria-label="Colour">
        {PALETTE.map((c) => (
          <button key={c} role="radio" aria-checked={color === c} onClick={() => { haptic.tap(); setColor(c); }} className={`habit-swatch ${color === c ? "is-active" : ""}`} style={{ background: c }} aria-label={c} />
        ))}
      </div>

      <button onClick={() => setMore((v) => !v)} className="habit-more" aria-expanded={more}>
        {more ? "Hide" : "Make it stick"} <span className="text-ink-500">· cue, two-minute version, reminder</span>
      </button>
      <AnimatePresence initial={false}>
        {more && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mobile-sheet-label">Cue <span className="habit-hint">make it obvious</span></div>
            <input value={cue} onChange={(e) => setCue(e.target.value)} placeholder="After I pour my morning coffee…" className="field mobile-wide" aria-label="Cue" />
            <div className="mobile-sheet-label">Two-minute version <span className="habit-hint">make it easy</span></div>
            <input value={tiny} onChange={(e) => setTiny(e.target.value)} placeholder="Open the book and read one line" className="field mobile-wide" aria-label="Two-minute version" />
            <div className="mobile-sheet-label">Identity <span className="habit-hint">who this makes you</span></div>
            <input value={identity} onChange={(e) => setIdentity(e.target.value)} placeholder="I'm a reader" className="field mobile-wide" aria-label="Identity" />
            <div className="mobile-sheet-label">Daily reminder</div>
            <div className="flex gap-2 items-center">
              <input type="time" value={reminder} onChange={(e) => setReminder(e.target.value)} className="field tnum" aria-label="Reminder time" />
              {reminder && <button onClick={() => setReminder("")} className="icon-button" aria-label="Clear reminder"><X size={16} /></button>}
              <span className="text-[12px] text-ink-400">Skipped automatically once today is logged.</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {err && <div className="text-[12px] text-red-400 mt-2">{err}</div>}
      <div className="mobile-sheet-actions mt-4">
        <button onClick={() => void save()} className="btn-primary mobile-wide">{habit ? "Save" : "Add habit"}</button>
      </div>
    </Sheet>
  );
}

/** Daily habit reminders ride on the reminders engine, keyed by task_id "habit:<id>". */
async function syncHabitReminder(h: Habit, workspaceId: string | null) {
  const existing = (await ipc.reminderList()).filter((r) => r.task_id === `habit:${h.id}`);
  if (!h.reminder_hhmm) {
    await Promise.all(existing.map((r) => ipc.reminderDelete(r.id)));
    return;
  }
  const [hh, mm] = h.reminder_hhmm.split(":").map(Number);
  const due = new Date(); due.setHours(hh, mm, 0, 0);
  if (due.getTime() <= Date.now()) due.setDate(due.getDate() + 1);
  const title = h.cue ? `${h.name} — ${h.cue}` : h.name;
  if (existing.length) {
    await ipc.reminderUpdate({ id: existing[0].id, title, due_ms: due.getTime(), repeat: "daily" });
    await Promise.all(existing.slice(1).map((r) => ipc.reminderDelete(r.id)));
  } else {
    await ipc.reminderCreate({ title, due_ms: due.getTime(), repeat: "daily", task_id: `habit:${h.id}`, workspace_id: workspaceId ?? undefined });
  }
}

function HabitDetailSheet({ habit, stats, today, entry, onClose, onEdit, onLog, onSkip, onDeleted }: {
  habit: Habit; stats?: HabitStats; today: string; entry: HabitEntry | null;
  onClose: () => void; onEdit: () => void; onLog: (mode: "toggle" | "inc" | "dec") => void; onSkip: () => void; onDeleted: () => Promise<void>;
}) {
  const [entries, setEntries] = useState<HabitEntry[]>([]);
  const from = isoMinusDays(7 * 12 - 1);
  useEffect(() => { void ipc.habitEntries({ habit_id: habit.id, from_day: from, to_day: today }).then(setEntries).catch(() => setEntries([])); }, [habit.id, from, today]);
  const target = habit.target ?? (habit.kind === "bool" ? 1 : 0.0001);
  const done = isDone(habit, entry);
  const misses = stats?.misses_in_a_row ?? 0;
  const nextMilestone = MILESTONES.find((m) => m > (stats?.current_streak ?? 0));
  const weekday = useMemo(() => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], []);

  async function remove() {
    if (!window.confirm(`Delete “${habit.name}” and its history?`)) return;
    haptic.warn();
    await ipc.habitDelete(habit.id);
    const linked = (await ipc.reminderList()).filter((r) => r.task_id === `habit:${habit.id}`);
    await Promise.all(linked.map((r) => ipc.reminderDelete(r.id)));
    await onDeleted();
  }

  return (
    <Sheet title={habit.name} onClose={onClose} wide>
      {habit.identity && <div className="text-[13px] text-ink-400 -mt-1 mb-2">“{habit.identity}”</div>}

      {/* Today */}
      <div className="habit-today" style={{ "--habit-color": habit.color } as React.CSSProperties}>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] uppercase tracking-wider text-ink-400">Today</div>
          <div className="text-[18px] font-semibold text-ink-100">
            {done ? "Done" : entry?.skipped ? "Skipped" : habit.kind === "bool" ? "Not yet" : `${fmt(entry && !entry.skipped ? entry.value : 0)} / ${fmt(habit.target ?? 0)}${habit.unit ? ` ${habit.unit}` : ""}`}
          </div>
          {!done && habit.tiny && <div className="text-[13px] text-ink-300 mt-1">Short on time? <span className="text-ink-100">{habit.tiny}</span></div>}
        </div>
        <div className="flex items-center gap-1.5">
          {habit.kind !== "bool" && <button onClick={() => onLog("dec")} className="icon-button" aria-label="Less"><Minus size={18} /></button>}
          <button onClick={() => onLog(habit.kind === "bool" ? "toggle" : "inc")} className={`btn-primary ${habit.kind === "bool" ? "px-5" : ""}`}>
            {habit.kind === "bool" ? (done ? <><X size={16} /> Undo</> : <><Check size={16} /> Done</>) : <><Plus size={16} /> {habit.kind === "count" ? "1" : fmt(Math.max(1, Math.round((habit.target ?? 4) / 4)))}</>}
          </button>
          {!done && !entry?.skipped && <button onClick={onSkip} className="btn" title="Skip keeps your streak intact">Skip</button>}
        </div>
      </div>

      {/* Never miss twice */}
      <div className="habit-stats">
        <Stat label="Streak" value={String(stats?.current_streak ?? 0)} accent={(stats?.current_streak ?? 0) > 0 ? habit.color : undefined} icon={<Flame size={14} />} />
        <Stat label="Misses in a row" value={String(misses)} tone={misses >= 2 ? "danger" : misses === 1 ? "warn" : "ok"} hint={misses >= 2 ? "Never miss twice. Today is the one to win." : misses === 1 ? "One miss is an accident. Get back on today." : "On track"} />
        <Stat label="Best" value={String(stats?.best_streak ?? 0)} />
        <Stat label="30 days" value={`${Math.round((stats?.completion_30d ?? 0) * 100)}%`} />
      </div>
      {nextMilestone && stats && (
        <div className="habit-milestone">
          <div className="habit-milestone-bar"><span style={{ width: `${Math.min(100, (stats.current_streak / nextMilestone) * 100)}%`, background: habit.color }} /></div>
          <div className="text-[12px] text-ink-400 mt-1">{nextMilestone - stats.current_streak} day{nextMilestone - stats.current_streak === 1 ? "" : "s"} to {nextMilestone}{nextMilestone === 66 ? " — when habits turn automatic" : ""}</div>
        </div>
      )}

      <div className="mt-3">
        <Heatmap entries={entries} fromDay={from} toDay={today} target={target} color={habit.color} />
      </div>

      {stats && (
        <div className="mt-3">
          <div className="text-[12px] uppercase tracking-wider text-ink-400 mb-1.5">By weekday</div>
          <div className="habit-weekdays">
            {stats.weekday_rate.map((r, i) => (
              <div key={i} className="habit-weekday">
                <div className="habit-weekday-bar"><span style={{ height: `${Math.max(4, r * 100)}%`, background: habit.color, opacity: 0.35 + 0.65 * r }} /></div>
                <div className="text-[11px] text-ink-400">{weekday[i]}</div>
              </div>
            ))}
          </div>
          <div className="text-[12px] text-ink-500 mt-2">{stats.total_completions} completions in {stats.days_tracked} days{stats.last_completed_day && stats.last_completed_day !== today ? ` · last on ${stats.last_completed_day}` : ""}</div>
        </div>
      )}

      {(habit.cue || habit.reminder_hhmm) && (
        <div className="text-[13px] text-ink-300 mt-3 flex flex-col gap-1">
          {habit.cue && <div><span className="text-ink-500">Cue</span> · {habit.cue}</div>}
          {habit.reminder_hhmm && <div className="flex items-center gap-1"><Bell size={13} className="text-ink-500" /> Daily at {habit.reminder_hhmm}</div>}
        </div>
      )}

      <div className="flex gap-2 mt-4">
        <button onClick={onEdit} className="btn flex-1"><Pencil size={16} /> Edit</button>
        <button onClick={() => void remove()} className="btn text-danger"><Trash2 size={16} /></button>
      </div>
    </Sheet>
  );
}

function Stat({ label, value, hint, accent, tone, icon }: { label: string; value: string; hint?: string; accent?: string; tone?: "ok" | "warn" | "danger"; icon?: React.ReactNode }) {
  return (
    <div className={`habit-stat ${tone ? `is-${tone}` : ""}`} title={hint}>
      <div className="text-[11px] uppercase tracking-wider text-ink-400">{label}</div>
      <div className="habit-stat-value display-num" style={accent ? { color: accent } : undefined}>{icon}{value}</div>
      {hint && <div className="habit-stat-hint">{hint}</div>}
    </div>
  );
}
