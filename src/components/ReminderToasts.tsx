import { AnimatePresence, motion } from "framer-motion";
import { BellRing, CalendarClock, Check, X } from "lucide-react";
import { useReminders } from "@/store/reminders";
import { useApp } from "@/store/app";

/**
 * In-app banners for reminders and deadlines that just fired. The OS
 * notification is the wake-up call; this is where you act on it without
 * leaving the window: snooze, mark done, or dismiss.
 */
export function ReminderToasts() {
  const toasts = useReminders((s) => s.toasts);
  const snooze = useReminders((s) => s.snooze);
  const done = useReminders((s) => s.done);
  const dismiss = useReminders((s) => s.dismissToast);
  const toggleTask = useApp((s) => s.toggleTask);

  return (
    <div className="fixed right-4 bottom-4 z-[60] flex flex-col gap-2 w-[340px] max-w-[calc(100vw-2rem)] pointer-events-none" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={`${t.kind}:${t.id}`}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 32, mass: 0.7 }}
            className="popover rounded-xl p-3 pointer-events-auto"
            role="status"
          >
            <div className="flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-accent/15 text-accent-glow grid place-items-center shrink-0">
                {t.kind === "task" ? <CalendarClock size={16} /> : <BellRing size={16} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] uppercase tracking-wider text-ink-400">
                  {t.kind === "task" ? "Task due" : "Reminder"}
                </div>
                <div className="text-[14px] font-semibold text-ink-100 leading-snug break-words">{t.title}</div>
              </div>
              <button onClick={() => dismiss(t.id)} className="icon-button-sm" aria-label="Dismiss">
                <X size={13} />
              </button>
            </div>
            <div className="flex items-center gap-1.5 mt-2.5">
              {t.kind === "reminder" ? (
                <>
                  <button onClick={() => void snooze(t.id, 10)} className="btn">Snooze 10m</button>
                  <button onClick={() => void snooze(t.id, 60)} className="btn">1h</button>
                  <button onClick={() => void done(t.id)} className="btn-primary ml-auto">
                    <Check size={14} /> Done
                  </button>
                </>
              ) : (
                <button
                  onClick={() => { void toggleTask(t.id); dismiss(t.id); }}
                  className="btn-primary ml-auto"
                >
                  <Check size={14} /> Mark done
                </button>
              )}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
