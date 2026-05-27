import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

/**
 * Global keyboard cheatsheet. Opens with `?` (Shift+/) anywhere except inside
 * input fields. Lists every interactive shortcut so users don't have to
 * memorize the palette to discover them.
 */
export function KeyboardCheatsheet() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Skip when focus is in a text field — otherwise typing `?` in notes
      // would pop the overlay.
      const tag = (e.target as HTMLElement | null)?.tagName;
      const editable = (e.target as HTMLElement | null)?.isContentEditable;
      if (tag === "INPUT" || tag === "TEXTAREA" || editable) return;
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.1 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/60 backdrop-blur-sm"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className="w-[640px] max-w-[94vw] glass rounded-xl border border-ink-700/60 overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-ink-700/40 flex items-center">
              <span className="text-sm font-medium text-ink-100">Keyboard shortcuts</span>
              <span className="ml-auto text-[10px] text-ink-500">
                <kbd className="border border-ink-700 rounded px-1">Esc</kbd> close
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-1 p-4 text-[12px]">
              {SECTIONS.map((sec) => (
                <div key={sec.title} className="break-inside-avoid">
                  <div className="text-[10px] uppercase tracking-wider text-ink-500 mb-1.5 mt-2 first:mt-0">
                    {sec.title}
                  </div>
                  <ul className="flex flex-col gap-1">
                    {sec.items.map((it) => (
                      <li key={it.label} className="flex items-baseline gap-2">
                        <Keys combo={it.combo} />
                        <span className="text-ink-300">{it.label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Keys({ combo }: { combo: string[] }) {
  return (
    <span className="flex items-center gap-1 shrink-0">
      {combo.map((k, i) => (
        <kbd
          key={i}
          className="text-[10px] px-1.5 py-0.5 rounded border border-ink-700 bg-ink-900/60 text-ink-200 font-mono"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}

const SECTIONS = [
  {
    title: "Global",
    items: [
      { combo: ["?"], label: "This cheatsheet" },
      { combo: ["Ctrl", "K"], label: "Command palette" },
      { combo: ["Ctrl", ","], label: "Settings" },
    ],
  },
  {
    title: "Command palette",
    items: [
      { combo: ["↑", "↓"], label: "Navigate" },
      { combo: ["Enter"], label: "Run action" },
      { combo: ["Tab"], label: "Cycle results" },
      { combo: ["?", "…"], label: "Ask Nerva from palette" },
      { combo: ["Esc"], label: "Dismiss" },
    ],
  },
  {
    title: "Ask Nerva",
    items: [
      { combo: ["Ctrl", "↵"], label: "Send prompt" },
      { combo: ["Esc"], label: "Stop / close" },
    ],
  },
  {
    title: "Tasks",
    items: [
      { combo: ["Dbl-click"], label: "Rename inline" },
      { combo: ["Drag"], label: "Reorder" },
      { combo: ["Enter"], label: "Add task" },
    ],
  },
];
