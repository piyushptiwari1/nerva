import { useEffect, useState } from "react";

/**
 * First-run tutorial. Shows once per install (localStorage gate) and can be
 * re-opened any time via the "?" button in the command bar or `nerva help`
 * from the palette.
 *
 * Pure overlay — no IPC. State is local + a single bool in localStorage.
 */

const STORAGE_KEY = "nerva.tutorial.seen.v1";

interface Step {
  title: string;
  body: string;
  shortcut?: string;
}

const STEPS: Step[] = [
  {
    title: "Welcome to Nerva",
    body:
      "A focus workspace that survives reboots. Timers, tasks and notes are saved per workspace and replayed when you launch the app — nothing is lost on crash.",
  },
  {
    title: "Workspaces",
    body:
      "Each workspace keeps its own tasks, notes and timers. Switch from the left rail. Hit the '+' next to Workspaces to create one for each project, mood or context.",
  },
  {
    title: "Spawn timers",
    body:
      "Tap '+ New timer' on the centre stage. Timers run on wall-clock time — even if you close the laptop or reboot mid-session, the clock keeps ticking. Click the dial to pause / resume.",
    shortcut: "Spawn from palette: type 't 25m focus'",
  },
  {
    title: "Tasks",
    body:
      "Add a task in the left rail. Drag the ⋮⋮ handle to reorder, double-click the title to rename, click the box to mark done. The list is scoped to the active workspace.",
  },
  {
    title: "Persistent notes",
    body:
      "Every keystroke autosaves. Toggle View / Edit for Markdown preview. Hit 'Pop' to break the current note out as an always-on-top sticky window — grab the amber header to drag it anywhere on screen.",
  },
  {
    title: "Habits & streaks",
    body:
      "Track daily habits (yes/no, counts, or amounts) with a 12-week heatmap, weekday breakdown, and 30-day sparkline. Skip-days preserve your streak — no guilt-tripping when life happens.",
    shortcut: "Ctrl + H",
  },
  {
    title: "Floating timer widget",
    body:
      "From the palette, run 'widget timer' to open a tiny always-on-top timer. Grab the dark header bar (⋮⋮) to position it on top of your code, browser or call window.",
  },
  {
    title: "Command palette",
    body:
      "Everything is one shortcut away. Search notes, spawn timers, switch workspaces, open settings — type to filter.",
    shortcut: "Ctrl + K",
  },
  {
    title: "Settings & diagnostics",
    body:
      "Tune ambient noise, focus mode, hotkeys and inspect crash logs from Settings. Open any time with Ctrl + , — the editor convention.",
    shortcut: "Ctrl + ,",
  },
  {
    title: "You're ready",
    body:
      "Pin a workspace, start a timer, dump thoughts into a note. Nerva is the matte canvas — your work is the gloss. Re-open this tour from the command palette → 'help'.",
  },
];

export function Tutorial({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!open) setStep(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" || e.key === "Enter") next();
      else if (e.key === "ArrowLeft") prev();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step]);

  if (!open) return null;

  const isLast = step === STEPS.length - 1;
  const s = STEPS[step];

  function next() {
    if (isLast) finish();
    else setStep((i) => Math.min(i + 1, STEPS.length - 1));
  }
  function prev() {
    setStep((i) => Math.max(i - 1, 0));
  }
  function finish() {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) finish();
      }}
    >
      <div className="w-[min(560px,92vw)] rounded-2xl bg-ink-900 border border-ink-700 shadow-2xl overflow-hidden">
        <header className="px-5 py-3 flex items-center justify-between border-b border-ink-700/60">
          <span className="text-[11px] uppercase tracking-widest text-ink-300">
            Quick tour · {step + 1} / {STEPS.length}
          </span>
          <button
            onClick={finish}
            className="text-ink-300 hover:text-ink-100 text-sm"
            title="Skip tour"
          >
            Skip
          </button>
        </header>

        <div className="px-6 py-6">
          <h2 className="text-xl font-semibold text-ink-100 mb-2">{s.title}</h2>
          <p className="text-sm leading-relaxed text-ink-200">{s.body}</p>
          {s.shortcut && (
            <p className="mt-3 text-xs text-accent-glow">
              <span className="px-1.5 py-0.5 rounded bg-accent/20 border border-accent/30 font-mono">
                {s.shortcut}
              </span>
            </p>
          )}
        </div>

        <div className="px-5 py-3 flex items-center justify-between border-t border-ink-700/60 bg-ink-950/40">
          <div className="flex gap-1">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                aria-label={`Go to step ${i + 1}`}
                className={`h-1.5 rounded-full transition-all ${
                  i === step ? "w-6 bg-accent" : "w-1.5 bg-ink-600 hover:bg-ink-500"
                }`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={prev}
              disabled={step === 0}
              className="text-xs px-3 py-1.5 rounded-md hairline hover:bg-ink-800 disabled:opacity-40"
            >
              Back
            </button>
            <button
              onClick={next}
              className="text-xs px-3 py-1.5 rounded-md bg-accent/30 hover:bg-accent/50 text-accent-glow"
            >
              {isLast ? "Get started" : "Next →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** True if the tutorial has never been completed/skipped on this install. */
export function tutorialShouldAutoOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "1";
  } catch {
    return false;
  }
}
