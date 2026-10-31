import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useHabitsUi } from "@/store/habits";
import { HabitTracker } from "@/components/HabitTracker";

/** Overlay shell (Ctrl+H) around the unified habit tracker. */
export function HabitsPane() {
  const open = useHabitsUi((s) => s.open);
  const hide = useHabitsUi((s) => s.hide);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") hide(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, hide]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }}
          className="fixed inset-0 z-50 flex items-stretch justify-end bg-ink-950/55 backdrop-blur-sm"
          onMouseDown={(e) => { if (e.target === e.currentTarget) hide(); }}
        >
          <motion.div
            initial={{ x: 32, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 32, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="habits-pane w-[min(720px,96vw)] h-full glass glass-modal border-l border-ink-700/60 flex flex-col"
          >
            <div className="flex items-center justify-end px-3 pt-3">
              <button onClick={hide} className="icon-button" aria-label="Close habits"><X size={16} /></button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-5">
              <HabitTracker />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
