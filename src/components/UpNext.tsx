import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BellPlus, BellRing, X } from "lucide-react";
import { useReminders } from "@/store/reminders";
import { useApp } from "@/store/app";
import type { Repeat, Upcoming } from "@/lib/ipc";
import { defaultDue, toLocalInput, whenLabel } from "@/lib/when";

/**
 * One-line "Up next" strip: the three soonest reminders/deadlines for the
 * active workspace and an inline "Remind me" composer. Lives at the top of
 * the Focus column so time-bound things sit next to the timer.
 */
export function UpNext() {
  const upcoming = useReminders((s) => s.upcoming);
  const create = useReminders((s) => s.create);
  const remove = useReminders((s) => s.remove);
  const active = useApp((s) => s.active);
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(() => toLocalInput(defaultDue()));
  const [repeat, setRepeat] = useState<Repeat>("none");
  const [err, setErr] = useState<string | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    const h = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(h);
  }, []);

  const mine = upcoming.filter((u) => !active || u.workspace_id === active.id);
  const shown = mine.slice(0, 3);
  const more = mine.length - shown.length;

  async function submit() {
    const t = title.trim();
    const ms = new Date(due).getTime();
    if (!t) return setErr("Give it a name");
    if (!Number.isFinite(ms) || ms < Date.now() - 60_000) return setErr("Pick a time in the future");
    try {
      await create({ title: t, due_ms: ms, repeat });
      setTitle("");
      setDue(toLocalInput(defaultDue()));
      setRepeat("none");
      setErr(null);
      setComposing(false);
    } catch (e) {
      setErr(String(e));
    }
  }

  return (
    <div className="up-next" data-testid="up-next">
      <div className="flex items-center gap-2 min-w-0">
        <BellRing size={14} className="text-accent-glow shrink-0" aria-hidden="true" />
        <span className="text-[12px] font-semibold text-ink-200 shrink-0">Up next</span>
        <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
          {shown.length === 0 && (
            <span className="text-[12px] text-ink-400 truncate">Nothing scheduled</span>
          )}
          {shown.map((u) => (
            <UpNextChip key={`${u.kind}:${u.id}`} item={u} onRemove={u.kind === "reminder" ? () => void remove(u.id) : undefined} />
          ))}
          {more > 0 && <span className="text-[11px] text-ink-500 shrink-0">+{more}</span>}
        </div>
        <button
          onClick={() => setComposing((v) => !v)}
          className={`control-chip ml-auto shrink-0 ${composing ? "is-active" : ""}`}
          aria-expanded={composing}
          title="Create a reminder"
        >
          <BellPlus size={14} aria-hidden="true" />
          <span className="hidden sm:inline">Remind me</span>
        </button>
      </div>

      <AnimatePresence initial={false}>
        {composing && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="flex flex-wrap items-center gap-2 pt-2.5">
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void submit(); if (e.key === "Escape") setComposing(false); }}
                placeholder="Remind me to…"
                className="field flex-1 min-w-[160px]"
                aria-label="Reminder title"
              />
              <input
                type="datetime-local"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                className="field tnum"
                aria-label="Reminder time"
              />
              <select value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)} className="field" aria-label="Repeat">
                <option value="none">Once</option>
                <option value="daily">Daily</option>
                <option value="weekdays">Weekdays</option>
                <option value="weekly">Weekly</option>
              </select>
              <button onClick={() => void submit()} className="btn-primary">Set</button>
              {err && <span className="text-[11px] text-red-400 basis-full">{err}</span>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function UpNextChip({ item, onRemove }: { item: Upcoming; onRemove?: () => void }) {
  const label = whenLabel(item.due_ms);
  const overdue = label === "overdue";
  return (
    <span
      className={`up-next-chip ${item.kind === "task" ? "is-task" : ""} ${overdue ? "is-overdue" : ""}`}
      title={`${item.kind === "task" ? "Task due" : "Reminder"} · ${new Date(item.due_ms).toLocaleString()}`}
    >
      <span className="truncate max-w-[140px]">{item.title}</span>
      <span className="tnum text-ink-400">{label}</span>
      {onRemove && (
        <button onClick={onRemove} className="up-next-x" aria-label={`Remove reminder ${item.title}`}>
          <X size={11} />
        </button>
      )}
    </span>
  );
}
