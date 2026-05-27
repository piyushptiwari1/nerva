import { useEffect } from "react";
import { useApp } from "@/store/app";
import { usePalette } from "@/store/palette";
import { useSettingsUi } from "@/store/settings";
import { useTutorial } from "@/store/tutorial";
import { Sidebar } from "@/components/Sidebar";
import { TimerStage } from "@/components/TimerStage";
import { NotesPanel } from "@/components/NotesPanel";
import { TimelineBar } from "@/components/TimelineBar";
import { CommandBar } from "@/components/CommandBar";
import { CommandPalette } from "@/components/CommandPalette";
import { AskNerva } from "@/components/AskNerva";
import { KeyboardCheatsheet } from "@/components/KeyboardCheatsheet";
import { SettingsPane } from "@/components/SettingsPane";
import { Tutorial, tutorialShouldAutoOpen } from "@/components/Tutorial";

export default function App() {
  const { ready, bootstrap, refreshTimers } = useApp();
  const togglePalette = usePalette((s) => s.toggle);
  const toggleSettings = useSettingsUi((s) => s.toggle);
  const tutorialOpen = useTutorial((s) => s.open);
  const showTutorial = useTutorial((s) => s.show);
  const hideTutorial = useTutorial((s) => s.hide);

  useEffect(() => {
    bootstrap().catch(console.error);
  }, [bootstrap]);

  // First-launch tour. Gated by localStorage so it only fires once per install.
  useEffect(() => {
    if (ready && tutorialShouldAutoOpen()) showTutorial();
  }, [ready, showTutorial]);

  // 250ms tick — wall-clock math means we just need UI refresh cadence.
  useEffect(() => {
    if (!ready) return;
    const h = window.setInterval(() => {
      refreshTimers().catch(() => void 0);
    }, 250);
    return () => window.clearInterval(h);
  }, [ready, refreshTimers]);

  // Ctrl/Cmd+K opens the command palette anywhere in the app.
  // Ctrl/Cmd+, opens the settings pane (matches every editor/IDE on the planet).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        togglePalette();
      } else if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        toggleSettings();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePalette, toggleSettings]);

  return (
    <div className="h-screen w-screen flex flex-col bg-ink-950 text-ink-100 bg-grid">
      <CommandBar />
      <div className="flex-1 min-h-0 grid grid-cols-[240px_minmax(0,1fr)_360px] gap-3 px-3 pt-2">
        <Sidebar />
        <TimerStage />
        <NotesPanel />
      </div>
      <TimelineBar />
      <CommandPalette />
      <AskNerva />
      <KeyboardCheatsheet />
      <SettingsPane />
      <Tutorial open={tutorialOpen} onClose={hideTutorial} />
    </div>
  );
}
