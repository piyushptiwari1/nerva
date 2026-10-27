import { useEffect, useState } from "react";
import { ipc, type RuntimeInfo } from "@/lib/ipc";
import { FocusMenu } from "@/components/FocusMenu";
import { ClockMenu } from "@/components/ClockMenu";
import { usePalette } from "@/store/palette";
import { useTutorial } from "@/store/tutorial";
import { useHabitsUi } from "@/store/habits";
import { useSettingsUi } from "@/store/settings";
import { useTheme } from "@/store/theme";
import { useLicense, planLabel } from "@/lib/license";
import { CheckCheck, CircleHelp, Moon, Settings2, Sparkles, Sun } from "lucide-react";

/** Gold "PRO" chip — the visible difference for licensed installs. Click → Settings → Pro. */
function ProBadge() {
  const isPro = useLicense((s) => s.isPro);
  const plan = useLicense((s) => s.status?.plan);
  const openOn = useSettingsUi((s) => s.openOn);
  if (!isPro) return null;
  return (
    <button
      onClick={() => openOn("pro")}
      className="text-[9px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded bg-focus/15 border border-focus/40 text-focus hover:bg-focus/25 transition-colors"
      title={`Nerva Pro · ${planLabel(plan)} — manage licence`}
      aria-label="Nerva Pro active"
    >
      ★ Pro
    </button>
  );
}

export function CommandBar() {
  const [info, setInfo] = useState<RuntimeInfo | null>(null);
  const openPalette = usePalette((s) => s.set);
  const askNerva = usePalette((s) => s.ask);
  const showTutorial = useTutorial((s) => s.show);
  const toggleHabits = useHabitsUi((s) => s.toggle);
  const toggleSettings = useSettingsUi((s) => s.toggle);
  const theme = useTheme((s) => s.theme);
  const toggleTheme = useTheme((s) => s.toggleTheme);

  useEffect(() => {
    ipc.runtime().then(setInfo).catch(() => void 0);
  }, []);

  return (
    <div className="h-12 px-3 flex items-center gap-3">
      <div className="flex items-center gap-2 text-ink-200">
        <div className="w-6 h-6 rounded-md bg-accent/20 border border-accent/30 grid place-items-center text-accent-glow text-[11px] font-semibold">
          N
        </div>
        <span className="font-semibold tracking-tight">Nerva</span>
        <span className="text-ink-500 text-[11px] -ml-1">by Bytical</span>
        <ProBadge />
        <span className="text-ink-400 text-xs">v{info?.version ?? "…"}</span>
      </div>

      <div className="flex-1 mx-3">
        <button
          onClick={() => openPalette(true)}
          className="w-full glass rounded-lg px-3 h-8 flex items-center gap-2 text-ink-300 hover:text-ink-100 transition-colors cursor-text text-left"
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

      <button onClick={() => askNerva("")} className="icon-button" title="Ask Nerva" aria-label="Ask Nerva">
        <Sparkles size={15} />
      </button>

      <button onClick={toggleHabits} className="icon-button" title="Habits (Ctrl+H)" aria-label="Open habits tracker">
        <CheckCheck size={15} />
      </button>

      <button
        onClick={toggleTheme}
        className="icon-button"
        title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        aria-label="Toggle theme"
      >
        {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
      </button>

      <button onClick={showTutorial} className="icon-button" title="Show quick tour" aria-label="Show quick tour">
        <CircleHelp size={15} />
      </button>

      <button onClick={toggleSettings} className="icon-button" title="Settings (Ctrl+,)" aria-label="Open settings">
        <Settings2 size={15} />
      </button>

      <ClockMenu />
    </div>
  );
}
