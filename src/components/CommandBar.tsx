import { useEffect, useState } from "react";
import { ipc, type RuntimeInfo } from "@/lib/ipc";
import { FocusMenu } from "@/components/FocusMenu";
import { usePalette } from "@/store/palette";
import { useTutorial } from "@/store/tutorial";
import { useHabitsUi } from "@/store/habits";
import { useSettingsUi } from "@/store/settings";
import { useTheme } from "@/store/theme";

export function CommandBar() {
  const [info, setInfo] = useState<RuntimeInfo | null>(null);
  const [now, setNow] = useState(() => new Date());
  const openPalette = usePalette((s) => s.set);
  const askNerva = usePalette((s) => s.ask);
  const showTutorial = useTutorial((s) => s.show);
  const toggleHabits = useHabitsUi((s) => s.toggle);
  const toggleSettings = useSettingsUi((s) => s.toggle);
  const theme = useTheme((s) => s.theme);
  const toggleTheme = useTheme((s) => s.toggleTheme);

  useEffect(() => {
    ipc.runtime().then(setInfo).catch(() => void 0);
    const h = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(h);
  }, []);

  return (
    <div className="h-12 px-3 flex items-center gap-3">
      <div className="flex items-center gap-2 text-ink-200">
        <div className="w-6 h-6 rounded-md bg-accent/20 border border-accent/30 grid place-items-center text-accent-glow text-[11px] font-semibold">
          N
        </div>
        <span className="font-semibold tracking-tight">Nerva</span>
        <span className="text-ink-400 text-xs">v{info?.version ?? "…"}</span>
      </div>

      <div className="flex-1 mx-3">
        <button
          onClick={() => openPalette(true)}
          className="w-full glass rounded-lg px-3 py-1.5 flex items-center gap-2 text-ink-300 hover:text-ink-100 transition-colors cursor-text text-left"
        >
          <kbd className="text-[10px] text-ink-400 border border-ink-600 rounded px-1.5 py-0.5">
            Ctrl
          </kbd>
          <kbd className="text-[10px] text-ink-400 border border-ink-600 rounded px-1.5 py-0.5">
            K
          </kbd>
          <span className="text-sm">Search, spawn timers, jump to notes…</span>
        </button>
      </div>

      <FocusMenu />

      <button
        onClick={() => askNerva("")}
        className="w-7 h-7 grid place-items-center rounded-md text-ink-300 hover:text-ink-100 hover:bg-ink-800 border border-ink-700"
        title="Ask Nerva"
        aria-label="Ask Nerva"
      >
        ✦
      </button>

      <button
        onClick={toggleHabits}
        className="w-7 h-7 grid place-items-center rounded-md text-ink-300 hover:text-ink-100 hover:bg-ink-800 border border-ink-700"
        title="Habits (Ctrl+H)"
        aria-label="Open habits tracker"
      >
        ✓
      </button>

      <button
        onClick={toggleTheme}
        className="w-7 h-7 grid place-items-center rounded-md text-ink-300 hover:text-ink-100 hover:bg-ink-800 border border-ink-700"
        title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        aria-label="Toggle theme"
      >
        {theme === "dark" ? "☼" : "☾"}
      </button>

      <button
        onClick={showTutorial}
        className="w-7 h-7 grid place-items-center rounded-md text-ink-300 hover:text-ink-100 hover:bg-ink-800 border border-ink-700"
        title="Show quick tour"
        aria-label="Show quick tour"
      >
        ?
      </button>

      <button
        onClick={toggleSettings}
        className="w-7 h-7 grid place-items-center rounded-md text-ink-300 hover:text-ink-100 hover:bg-ink-800 border border-ink-700"
        title="Settings (Ctrl+,)"
        aria-label="Open settings"
      >
        ⚙
      </button>

      <div className="text-xs text-ink-300 tnum">
        {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </div>
    </div>
  );
}
