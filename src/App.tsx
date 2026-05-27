import { useEffect } from "react";
import { useApp } from "@/store/app";
import { Sidebar } from "@/components/Sidebar";
import { TimerStage } from "@/components/TimerStage";
import { NotesPanel } from "@/components/NotesPanel";
import { TimelineBar } from "@/components/TimelineBar";
import { CommandBar } from "@/components/CommandBar";

export default function App() {
  const { ready, bootstrap, refreshTimers } = useApp();

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

  return (
    <div className="h-screen w-screen flex flex-col bg-ink-950 text-ink-100 bg-grid">
      <CommandBar />
      <div className="flex-1 min-h-0 grid grid-cols-[240px_minmax(0,1fr)_360px] gap-3 px-3 pt-2">
        <Sidebar />
        <TimerStage />
        <NotesPanel />
      </div>
      <TimelineBar />
    </div>
  );
}
