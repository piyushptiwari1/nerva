import { useEffect } from "react";
import { useApp } from "@/store/app";
import { usePalette } from "@/store/palette";
import { Sidebar } from "@/components/Sidebar";
import { TimerStage } from "@/components/TimerStage";
import { NotesPanel } from "@/components/NotesPanel";
import { TimelineBar } from "@/components/TimelineBar";
import { CommandBar } from "@/components/CommandBar";
import { CommandPalette } from "@/components/CommandPalette";
import { AskNerva } from "@/components/AskNerva";

export default function App() {
  const { ready, bootstrap, refreshTimers } = useApp();
  const togglePalette = usePalette((s) => s.toggle);

  useEffect(() => {
    bootstrap().catch(console.error);
  }, [bootstrap]);

  // 250ms tick — wall-clock math means we just need UI refresh cadence.
  useEffect(() => {
    if (!ready) return;
    const h = window.setInterval(() => {
      refreshTimers().catch(() => void 0);
    }, 250);
    return () => window.clearInterval(h);
  }, [ready, refreshTimers]);

  // Ctrl/Cmd+K opens the command palette anywhere in the app.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        togglePalette();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePalette]);

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
    </div>
  );
}
