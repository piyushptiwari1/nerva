import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useApp } from "@/store/app";
import { usePalette } from "@/store/palette";
import { useSettingsUi } from "@/store/settings";
import { useHabitsUi } from "@/store/habits";
import { useTutorial } from "@/store/tutorial";
import { useTheme } from "@/store/theme";
import { ipc } from "@/lib/ipc";

interface Action {
  id: string;
  /** Bucket header — items group by category in the UI. */
  group: "Timers" | "Tasks" | "Notes" | "Workspaces" | "System" | "Create";
  title: string;
  subtitle?: string;
  /** Glyph drawn in the leading slot — a single character. */
  glyph: string;
  /** Lower-case haystack the fuzzy matcher searches against. */
  keywords: string;
  run: () => Promise<void> | void;
}

const PRESETS = [
  { label: "25m Focus", ms: 25 * 60_000, color: "#7c9cff" },
  { label: "50m Deep", ms: 50 * 60_000, color: "#a8bdff" },
  { label: "90m Deep Work", ms: 90 * 60_000, color: "#e8b86d" },
  { label: "5m Break", ms: 5 * 60_000, color: "#7dd6a8" },
];

export function CommandPalette() {
  const open = usePalette((s) => s.open);
  const setOpen = usePalette((s) => s.set);
  const askNerva = usePalette((s) => s.ask);
  const askHistory = usePalette((s) => s.askHistory);
  const { workspaces, active, timers, notes, tasks, focus } = useApp();
  const refreshTimers = useApp((s) => s.refreshTimers);
  const refreshTasks = useApp((s) => s.refreshTasks);
  const refreshNotes = useApp((s) => s.refreshNotes);
  const refreshMomentum = useApp((s) => s.refreshMomentum);
  const setDnd = useApp((s) => s.setDnd);
  const openSettings = useSettingsUi((s) => s.setOpen);
  const openHabits = useHabitsUi((s) => s.show);
  const showTutorial = useTutorial((s) => s.show);
  const theme = useTheme((s) => s.theme);
  const toggleTheme = useTheme((s) => s.toggleTheme);
  const audio = useApp((s) => s.audio);
  const setAmbient = useApp((s) => s.setAmbient);
  const testAudio = useApp((s) => s.testAudio);
  const activateWorkspace = useApp((s) => s.activateWorkspace);
  const createTask = useApp((s) => s.createTask);
  const toggleTask = useApp((s) => s.toggleTask);

  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus input + reset query whenever the palette opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      // Wait a frame so the input is mounted.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const actions = useMemo<Action[]>(() => {
    const out: Action[] = [];

    // --- Timers ---
    for (const t of timers) {
      const isRunning = t.status === "running";
      const isPaused = t.status === "paused";
      out.push({
        id: `timer.toggle.${t.id}`,
        group: "Timers",
        glyph: "⏱",
        title: isRunning ? `Pause "${t.name}"` : isPaused ? `Resume "${t.name}"` : `Start "${t.name}"`,
        subtitle: `${Math.round(t.remaining_ms / 60_000)}m remaining`,
        keywords: `timer ${t.name} ${t.status}`.toLowerCase(),
        run: async () => {
          if (isRunning) await ipc.timerPause(t.id);
          else if (isPaused) await ipc.timerResume(t.id);
          else await ipc.timerStart(t.id);
          await refreshTimers();
        },
      });
      out.push({
        id: `timer.reset.${t.id}`,
        group: "Timers",
        glyph: "↺",
        title: `Reset "${t.name}"`,
        keywords: `timer reset ${t.name}`.toLowerCase(),
        run: async () => {
          await ipc.timerReset(t.id);
          await refreshTimers();
        },
      });
    }

    // --- Tasks (scoped to active workspace, like the panel) ---
    const scopedTasks = active
      ? tasks.filter((t) => t.workspace_id === active.id || !t.workspace_id)
      : tasks;
    for (const t of scopedTasks) {
      out.push({
        id: `task.toggle.${t.id}`,
        group: "Tasks",
        glyph: t.status === "done" ? "✓" : "○",
        title: t.status === "done" ? `Reopen "${t.title}"` : `Complete "${t.title}"`,
        keywords: `task ${t.title} ${t.status}`.toLowerCase(),
        run: async () => {
          await toggleTask(t.id);
        },
      });
    }

    // --- Notes ---
    for (const n of notes.slice(0, 20)) {
      out.push({
        id: `note.open.${n.id}`,
        group: "Notes",
        glyph: "✎",
        title: n.title || "Untitled",
        subtitle: `Open in sticky window`,
        keywords: `note ${n.title}`.toLowerCase(),
        run: async () => {
          await ipc.openSticky(n.id);
        },
      });
    }

    // --- Workspaces ---
    for (const w of workspaces) {
      if (active?.id === w.id) continue;
      out.push({
        id: `ws.activate.${w.id}`,
        group: "Workspaces",
        glyph: "◆",
        title: `Switch to "${w.name}"`,
        keywords: `workspace ${w.name}`.toLowerCase(),
        run: async () => {
          await activateWorkspace(w.id);
        },
      });
    }

    // --- Create (timer presets + task draft if query non-empty) ---
    for (const p of PRESETS) {
      out.push({
        id: `create.timer.${p.label}`,
        group: "Create",
        glyph: "+",
        title: `New timer · ${p.label}`,
        keywords: `new timer ${p.label} ${p.ms / 60_000}m`.toLowerCase(),
        run: async () => {
          const t = await ipc.timerCreate({
            name: p.label, duration_ms: p.ms, color: p.color,
          });
          await ipc.timerStart(t.id);
          await refreshTimers();
        },
      });
    }
    const draft = query.trim();
    if (draft) {
      out.push({
        id: `create.task.${draft}`,
        group: "Create",
        glyph: "+",
        title: `New task: "${draft}"`,
        // High-priority keyword so it ranks where the user is typing.
        keywords: `new task ${draft}`.toLowerCase(),
        run: async () => {
          await createTask(draft);
          await refreshMomentum();
        },
      });
    }

    // --- Ask Nerva (local LLM) ---
    // `?`-prefix lifts the typed text into a ready-to-send prompt; the bare
    // action opens the pane empty for free-form prompting.
    const askDraft = draft.startsWith("?") ? draft.slice(1).trim() : "";
    if (askDraft) {
      out.push({
        id: `ai.ask.draft`,
        group: "Create",
        glyph: "✦",
        title: `Ask Nerva: "${askDraft}"`,
        subtitle: "stream a reply from your local LLM",
        keywords: `ask nerva ai ${askDraft}`.toLowerCase(),
        run: () => askNerva(askDraft),
      });
    }
    out.push({
      id: "ai.ask",
      group: "System",
      glyph: "✦",
      title: "Ask Nerva…",
      subtitle: "open the local-LLM pane",
      keywords: "ask nerva ai llm chat question".toLowerCase(),
      run: () => askNerva(""),
    });
    out.push({
      id: "ai.recap",
      group: "System",
      glyph: "✦",
      title: "Recap today",
      subtitle: "summarize today's events, timers, and tasks",
      keywords: "recap summary today summarize day".toLowerCase(),
      run: () =>
        askNerva(
          "Give me a brief recap of what I did today. Highlight completed " +
            "timers, tasks I finished, and one suggestion for what to do next " +
            "based on what's open.",
        ),
    });
    out.push({
      id: "ai.history",
      group: "System",
      glyph: "✦",
      title: "Ask history",
      subtitle: "browse recent exchanges with Nerva",
      keywords: "ask history past previous conversations exchanges log".toLowerCase(),
      run: () => askHistory(),
    });

    // --- System ---
    if (focus?.supported) {
      out.push({
        id: "system.dnd",
        group: "System",
        glyph: focus.dnd ? "●" : "○",
        title: focus.dnd ? "Turn off Do Not Disturb" : "Turn on Do Not Disturb",
        keywords: "dnd do not disturb focus silence notifications".toLowerCase(),
        run: async () => setDnd(!focus.dnd),
      });
    }
    out.push({
      id: "system.settings",
      group: "System",
      glyph: "⚙",
      title: "Settings",
      subtitle: "AI · timers · audio · focus  ·  Ctrl+,",
      keywords: "settings preferences config ollama endpoint model audio focus dnd".toLowerCase(),
      run: () => openSettings(true),
    });
    out.push({
      id: "system.habits",
      group: "System",
      glyph: "✓",
      title: "Open habits tracker",
      subtitle: "daily check-ins · heatmap · streaks  ·  Ctrl+H",
      keywords: "habits habit tracker streak daily routine checkin chart heatmap".toLowerCase(),
      run: () => openHabits(),
    });
    out.push({
      id: "system.theme",
      group: "System",
      glyph: theme === "dark" ? "☼" : "☾",
      title: theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
      subtitle: "palette flips instantly · persisted",
      keywords: "theme dark light mode appearance contrast".toLowerCase(),
      run: () => toggleTheme(),
    });
    out.push({
      id: "widget.habits",
      group: "System",
      glyph: "❑",
      title: "Pop out habits widget",
      subtitle: "floating always-on-top mini tracker",
      keywords: "widget habits popout floating tracker".toLowerCase(),
      run: () => ipc.openHabitsWidget(),
    });
    out.push({
      id: "widget.tasks",
      group: "System",
      glyph: "❑",
      title: "Pop out tasks widget",
      subtitle: "floating always-on-top mini task list",
      keywords: "widget tasks popout floating todo".toLowerCase(),
      run: () => ipc.openTasksWidget(),
    });
    // Ambient noise quick toggles — surface only as palette actions since the
    // Settings pane already has the full picker; here we want one-keystroke
    // start/stop without leaving flow.
    if (audio?.available) {
      const kinds: Array<{ id: "pink" | "brown" | "white"; label: string }> = [
        { id: "pink", label: "Pink" },
        { id: "brown", label: "Brown" },
        { id: "white", label: "White" },
      ];
      for (const k of kinds) {
        out.push({
          id: `ambient.${k.id}`,
          group: "System",
          glyph: "♒",
          title: `Play ${k.label} noise`,
          subtitle: audio.ambient === k.id ? "currently playing" : undefined,
          keywords: `ambient noise ${k.id} background focus`.toLowerCase(),
          run: () => setAmbient(k.id),
        });
      }
      if (audio.ambient !== null) {
        out.push({
          id: "ambient.off",
          group: "System",
          glyph: "♒",
          title: "Stop ambient noise",
          keywords: "ambient noise off stop silence".toLowerCase(),
          run: () => setAmbient(null),
        });
      }
    }
    out.push({
      id: "system.timer-widget",
      group: "System",
      glyph: "▣",
      title: "Open floating timer widget",
      keywords: "widget timer floating window".toLowerCase(),
      run: () => ipc.openTimerWidget(),
    });
    out.push({
      id: "system.audio-test",
      group: "System",
      glyph: "♪",
      title: "Test completion ding",
      keywords: "audio sound test ding".toLowerCase(),
      run: () => testAudio(),
    });
    out.push({
      id: "system.refresh",
      group: "System",
      glyph: "⟳",
      title: "Refresh all panels",
      keywords: "refresh reload sync".toLowerCase(),
      run: async () => {
        await Promise.all([refreshTimers(), refreshTasks(), refreshNotes(), refreshMomentum()]);
      },
    });
    out.push({
      id: "system.help",
      group: "System",
      glyph: "?",
      title: "Show quick tour",
      subtitle: "first-run walkthrough — re-openable any time",
      keywords: "help tour tutorial walkthrough onboarding intro guide".toLowerCase(),
      run: () => showTutorial(),
    });
    out.push({
      id: "system.updates",
      group: "System",
      glyph: "⇪",
      title: "Check for updates",
      subtitle: "downloads + verifies signed release if newer",
      keywords: "update updates upgrade version download install latest".toLowerCase(),
      run: async () => {
        try {
          const [{ check }, { relaunch }] = await Promise.all([
            import("@tauri-apps/plugin-updater"),
            import("@tauri-apps/plugin-process"),
          ]);
          const update = await check();
          if (!update) {
            window.alert("You're on the latest version of Nerva.");
            return;
          }
          if (
            window.confirm(
              `Nerva ${update.version} is available. Download and install now? Nerva will relaunch.`,
            )
          ) {
            await update.downloadAndInstall();
            await relaunch();
          }
        } catch (err) {
          window.alert(`Update check failed: ${err}`);
        }
      },
    });
    out.push({
      id: "system.reset",
      group: "System",
      glyph: "⌫",
      title: "Reset Nerva (clear all local data)",
      subtitle: "Settings → Diagnostics · last resort if the app is stuck",
      keywords: "reset wipe clear erase factory clean stuck recover broken fix repair".toLowerCase(),
      run: () => {
        useSettingsUi.getState().openOn("diag");
      },
    });

    return out;
  }, [
    timers, tasks, notes, workspaces, active, focus, query,
    refreshTimers, refreshTasks, refreshNotes, refreshMomentum,
    setDnd, testAudio, activateWorkspace, createTask, toggleTask,
    showTutorial, theme, toggleTheme,
  ]);

  const ranked = useMemo(() => rank(actions, query), [actions, query]);

  // Keep cursor in range whenever the result set changes.
  useEffect(() => {
    setCursor((c) => (ranked.length === 0 ? 0 : Math.min(c, ranked.length - 1)));
  }, [ranked.length]);

  // Scroll the cursored row into view.
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${cursor}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  async function runAt(i: number) {
    const a = ranked[i];
    if (!a) return;
    setOpen(false);
    try { await a.run(); }
    catch (err) { console.error("palette action failed", err); }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(ranked.length - 1, c + 1)); return; }
    if (e.key === "ArrowUp")   { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); return; }
    if (e.key === "Enter")     { e.preventDefault(); runAt(cursor); return; }
    if (e.key === "Tab")       { e.preventDefault(); setCursor((c) => (c + 1) % Math.max(1, ranked.length)); return; }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-ink-950/60 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className="w-[640px] max-w-[92vw] glass rounded-xl shadow-2xl border border-ink-700/60 overflow-hidden"
            onKeyDown={onKeyDown}
          >
            <div className="flex items-center gap-2 px-3 py-2 border-b border-ink-700/40">
              <span className="text-ink-400 text-sm">⌘</span>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
                placeholder="Type to search timers, tasks, notes, workspaces…"
                className="flex-1 bg-transparent outline-none text-sm text-ink-100 placeholder:text-ink-500"
              />
              <kbd className="text-[10px] text-ink-400 border border-ink-600 rounded px-1.5 py-0.5">
                Esc
              </kbd>
            </div>
            <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1">
              {ranked.length === 0 && (
                <div className="px-4 py-6 text-sm text-ink-500 text-center">
                  No matches. Press Esc to dismiss.
                </div>
              )}
              {ranked.map((a, i) => {
                const prev = ranked[i - 1];
                const showGroup = !prev || prev.group !== a.group;
                const isActive = i === cursor;
                return (
                  <div key={a.id}>
                    {showGroup && (
                      <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-ink-500">
                        {a.group}
                      </div>
                    )}
                    <button
                      data-idx={i}
                      onMouseEnter={() => setCursor(i)}
                      onClick={() => runAt(i)}
                      className={`w-full flex items-center gap-3 px-3 py-1.5 text-left text-sm ${
                        isActive ? "bg-accent/15 text-ink-100" : "text-ink-200 hover:bg-ink-800/60"
                      }`}
                    >
                      <span className="w-5 text-center text-ink-400">{a.glyph}</span>
                      <span className="flex-1 truncate">{a.title}</span>
                      {a.subtitle && (
                        <span className="text-[11px] text-ink-500 truncate max-w-[200px]">
                          {a.subtitle}
                        </span>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="px-3 py-1.5 border-t border-ink-700/40 flex items-center gap-3 text-[10px] text-ink-500">
              <span><kbd className="border border-ink-700 rounded px-1">↑↓</kbd> navigate</span>
              <span><kbd className="border border-ink-700 rounded px-1">↵</kbd> run</span>
              <span><kbd className="border border-ink-700 rounded px-1">Esc</kbd> close</span>
              <span className="ml-auto">{ranked.length} action{ranked.length === 1 ? "" : "s"}</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---- fuzzy ranking ----------------------------------------------------------

/** Score an action against the query. Higher is better; 0 means filter out
 *  (unless the query itself is empty, in which case we keep everything). */
function score(a: Action, q: string): number {
  if (!q) return 1;
  const hay = a.keywords;
  const needle = q.toLowerCase();
  // Exact substring — strongest signal.
  const direct = hay.indexOf(needle);
  if (direct >= 0) {
    // Earlier hits rank higher; bonus when the match starts at a word boundary.
    const boundary = direct === 0 || hay[direct - 1] === " " ? 50 : 0;
    return 1000 - direct + boundary;
  }
  // Subsequence — every needle char must appear in order in hay.
  let i = 0, j = 0, gap = 0, lastJ = -1;
  while (i < needle.length && j < hay.length) {
    if (needle[i] === hay[j]) {
      if (lastJ >= 0) gap += j - lastJ - 1;
      lastJ = j;
      i++;
    }
    j++;
  }
  if (i < needle.length) return 0;
  // Tighter clusters → smaller gap → higher score.
  return Math.max(1, 500 - gap * 4);
}

const GROUP_ORDER: Record<Action["group"], number> = {
  Create: 0, Timers: 1, Tasks: 2, Notes: 3, Workspaces: 4, System: 5,
};

function rank(actions: Action[], query: string): Action[] {
  const scored = actions
    .map((a) => ({ a, s: score(a, query) }))
    .filter((x) => x.s > 0);
  scored.sort((x, y) => {
    if (y.s !== x.s) return y.s - x.s;
    return GROUP_ORDER[x.a.group] - GROUP_ORDER[y.a.group];
  });
  // Cap so the popover never gets unmanageable.
  return scored.slice(0, 80).map((x) => x.a);
}
