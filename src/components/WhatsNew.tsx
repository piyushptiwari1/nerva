import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ipc } from "@/lib/ipc";
import { changelogFor, GITHUB_REPO, plain, type ChangelogEntry } from "@/lib/changelog";
import { useSettingsUi } from "@/store/settings";

const K_SEEN = "nerva.whatsnew.seen";

/**
 * "What's new" — shown once after each update (main window only). Reads the
 * bundled CHANGELOG.md for the running version. Ends with two asks: star the
 * repo, leave a rating. First-ever launch is skipped (the tutorial owns it).
 */
export function WhatsNew() {
  const [entry, setEntry] = useState<ChangelogEntry | null>(null);
  const [version, setVersion] = useState("");
  const openSettingsOn = useSettingsUi((s) => s.openOn);
  const forced = useWhatsNew((s) => s.open);
  const close = useWhatsNew((s) => s.hide);

  useEffect(() => {
    let alive = true;
    ipc
      .runtime()
      .then((r) => {
        if (!alive) return;
        setVersion(r.version);
        const seen = localStorage.getItem(K_SEEN);
        if (seen === null) {
          // Fresh install: nothing to compare against.
          localStorage.setItem(K_SEEN, r.version);
          return;
        }
        if (seen !== r.version) {
          const e = changelogFor(r.version);
          localStorage.setItem(K_SEEN, r.version);
          if (e) {
            setEntry(e);
            useWhatsNew.getState().show();
          }
        }
      })
      .catch(() => void 0);
    return () => {
      alive = false;
    };
  }, []);

  // Palette "What's new" → show the current version's notes on demand.
  useEffect(() => {
    if (forced && !entry && version) setEntry(changelogFor(version));
  }, [forced, entry, version]);

  useEffect(() => {
    if (!forced) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [forced, close]);

  const show = forced && entry;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/60 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
          role="dialog"
          aria-label="What's new"
        >
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className="w-[560px] max-w-[94vw] max-h-[80vh] glass rounded-xl border border-ink-700/60 overflow-hidden flex flex-col"
          >
            <header className="px-5 py-3 border-b border-ink-700/40 flex items-center gap-3">
              <span className="w-7 h-7 rounded-md bg-accent/20 border border-accent/30 grid place-items-center text-accent-glow text-xs font-semibold">
                ✦
              </span>
              <div>
                <div className="text-sm font-medium text-ink-100">What's new in Nerva {entry.version}</div>
                <div className="text-[11px] text-ink-400">
                  Nerva by Bytical{entry.date ? ` · ${entry.date}` : ""}
                </div>
              </div>
              <button
                onClick={close}
                className="ml-auto text-ink-400 hover:text-ink-100 text-base leading-none"
                aria-label="Close"
                title="Close (Esc)"
              >
                ×
              </button>
            </header>
            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-4">
              {entry.sections.map((s) => (
                <section key={s.heading}>
                  <h3 className="text-[11px] uppercase tracking-wider text-ink-400 mb-1.5">{s.heading}</h3>
                  <ul className="flex flex-col gap-1.5">
                    {s.items.map((it, i) => (
                      <li key={i} className="text-sm text-ink-200 leading-snug flex gap-2">
                        <span className="text-accent-glow mt-[3px] text-[8px]">●</span>
                        <span>{plain(it)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
            <footer className="px-5 py-3 border-t border-ink-700/40 bg-ink-900/40 flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-ink-400 mr-auto">
                Enjoying Nerva? Two small things help a lot:
              </span>
              <a
                href={GITHUB_REPO}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs px-3 py-1.5 rounded-md hairline hover:bg-ink-800 text-ink-100"
              >
                ★ Star on GitHub
              </a>
              <button
                onClick={() => {
                  close();
                  openSettingsOn("feedback");
                }}
                className="text-xs px-3 py-1.5 rounded-md bg-accent/20 hover:bg-accent/30 text-accent-glow"
              >
                Rate Nerva
              </button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Tiny store so the command palette can re-open the dialog.
import { create } from "zustand";
interface WhatsNewUi {
  open: boolean;
  show: () => void;
  hide: () => void;
}
export const useWhatsNew = create<WhatsNewUi>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));
