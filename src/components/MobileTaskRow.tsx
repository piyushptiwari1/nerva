import { useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useTransform, type PanInfo } from "framer-motion";
import { Check, Flag, CalendarClock, Trash2, X } from "lucide-react";
import type { Task, TaskPriority } from "@/lib/ipc";
import { toLocalInput, whenLabel } from "@/lib/when";
import { haptic } from "@/lib/haptics";

interface Props {
  task: Task;
  onToggle: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
  onSetPriority: (p: TaskPriority) => void;
  onSetDue: (ms: number | null) => void;
}

const PRIORITY: Array<{ id: TaskPriority; label: string; cls: string }> = [
  { id: "high", label: "High", cls: "bg-danger" },
  { id: "med", label: "Normal", cls: "bg-focus" },
  { id: "low", label: "Low", cls: "bg-ink-500" },
];

/**
 * Phone task row: 56px tall, a 44px check target, the title, and a due/priority
 * line. Tap the row for the detail sheet; swipe left to reveal Delete.
 * Reordering by drag is deliberately absent here — priority + due do that job.
 */
export function MobileTaskRow({ task, onToggle, onDelete, onRename, onSetPriority, onSetDue }: Props) {
  const x = useMotionValue(0);
  const revealOpacity = useTransform(x, [-96, -24], [1, 0]);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [due, setDue] = useState(task.due_ms ? toLocalInput(task.due_ms) : "");
  const dragged = useRef(false);
  const isDone = task.status === "done";
  const overdue = task.due_ms != null && task.due_ms < Date.now() && !isDone;

  function onDragEnd(_: unknown, info: PanInfo) {
    dragged.current = Math.abs(info.offset.x) > 8;
    if (info.offset.x < -120 || info.velocity.x < -600) {
      haptic.warn();
      onDelete();
    }
  }

  function openSheet() {
    if (dragged.current) { dragged.current = false; return; }
    haptic.tap();
    setTitle(task.title);
    setDue(task.due_ms ? toLocalInput(task.due_ms) : "");
    setOpen(true);
  }

  function save() {
    const t = title.trim();
    if (t && t !== task.title) onRename(t);
    const ms = due ? new Date(due).getTime() : null;
    if (ms !== task.due_ms) onSetDue(Number.isFinite(ms as number) ? ms : null);
    setOpen(false);
  }

  return (
    <>
      <div className="relative overflow-hidden rounded-xl">
        <motion.div className="absolute inset-y-0 right-0 flex items-center pr-5 text-danger" style={{ opacity: revealOpacity }} aria-hidden="true">
          <Trash2 size={20} />
        </motion.div>
        <motion.div
          drag={isDone ? false : "x"}
          dragConstraints={{ left: -140, right: 0 }}
          dragElastic={0.12}
          dragSnapToOrigin
          onDragEnd={onDragEnd}
          style={{ x }}
          className="mobile-task-row"
        >
          <button
            onClick={() => { if (isDone) haptic.select(); else haptic.complete(); onToggle(); }}
            className={`mobile-task-check ${isDone ? "is-done" : ""}`}
            aria-label={isDone ? `Mark ${task.title} as to do` : `Mark ${task.title} done`}
          >
            {isDone && <Check size={18} strokeWidth={3} />}
          </button>
          <button onClick={openSheet} className="mobile-task-body" aria-label={`${task.title}. Open details`}>
            <span className={`mobile-task-title ${isDone ? "is-done" : ""}`}>{task.title}</span>
            {(task.due_ms != null || task.priority !== "med") && !isDone && (
              <span className="mobile-task-meta">
                {task.priority !== "med" && (
                  <span className={`mobile-task-flag ${task.priority === "high" ? "text-danger" : "text-ink-400"}`}>
                    <Flag size={12} /> {task.priority === "high" ? "High" : "Low"}
                  </span>
                )}
                {task.due_ms != null && (
                  <span className={`mobile-task-due ${overdue ? "text-danger" : "text-ink-400"}`}>
                    <CalendarClock size={12} /> {whenLabel(task.due_ms)}
                  </span>
                )}
              </span>
            )}
          </button>
        </motion.div>
      </div>

      <AnimatePresence>
        {open && (
          <>
            <motion.div className="mobile-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
            <motion.div
              role="dialog"
              aria-label="Task details"
              className="mobile-sheet"
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 420, damping: 38 }}
            >
              <div className="mobile-sheet-grip" aria-hidden="true" />
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") save(); }}
                className="field mobile-wide text-[17px] font-semibold"
                aria-label="Task title"
              />
              <div className="mobile-sheet-label">Priority</div>
              <div className="mobile-segment" role="radiogroup" aria-label="Priority">
                {PRIORITY.map((p) => (
                  <button
                    key={p.id}
                    role="radio"
                    aria-checked={task.priority === p.id}
                    onClick={() => onSetPriority(p.id)}
                    className={`mobile-segment-item ${task.priority === p.id ? "is-active" : ""}`}
                  >
                    <span className={`mobile-task-dot ${p.cls}`} aria-hidden="true" /> {p.label}
                  </button>
                ))}
              </div>
              <div className="mobile-sheet-label">Due</div>
              <div className="flex gap-2">
                <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className="field flex-1 tnum" aria-label="Due date and time" />
                {due && (
                  <button onClick={() => setDue("")} className="icon-button" aria-label="Clear due date"><X size={18} /></button>
                )}
              </div>
              <div className="mobile-sheet-actions mt-4">
                <button onClick={save} className="btn-primary mobile-wide">Save</button>
                <button
                  onClick={() => { if (isDone || window.confirm(`Delete “${task.title}”?`)) { setOpen(false); onDelete(); } }}
                  className="btn mobile-wide text-danger"
                >
                  <Trash2 size={18} /> Delete task
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
