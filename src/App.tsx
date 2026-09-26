import { useEffect } from "react";
import { useApp } from "@/store/app";
import { usePalette } from "@/store/palette";
import { useSettingsUi } from "@/store/settings";
import { useHabitsUi } from "@/store/habits";
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
import { HabitsPane } from "@/components/HabitsPane";
import { Tutorial, tutorialShouldAutoOpen } from "@/components/Tutorial";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { TelemetryConsent } from "@/components/TelemetryConsent";
import { RatingPrompt } from "@/components/Feedback";
import { WhatsNew } from "@/components/WhatsNew";
import { initTelemetry } from "@/lib/telemetry";
import { flushFeedbackQueue, markInstalled } from "@/lib/feedback";
import { useLicense } from "@/lib/license";
import { useLayout } from "@/store/layout";

export default function App() {
  const { ready, bootstrap, refreshTimers } = useApp();
  const showTimeline = useLayout((s) => s.showTimeline);
  const togglePalette = usePalette((s) => s.toggle);
  const toggleSettings = useSettingsUi((s) => s.toggle);
  const toggleHabits = useHabitsUi((s) => s.toggle);
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

  // Opt-in weekly usage ping (no-op unless the user granted consent).
  // Main window only — popups render their own roots and never reach here.
  useEffect(() => initTelemetry(), []);

  // Feedback: remember first launch (drives the day-7 rating nudge) and
  // retry anything queued while offline.
  useEffect(() => {
    markInstalled();
    const h = window.setTimeout(() => void flushFeedbackQueue(), 15_000);
    return () => window.clearTimeout(h);
  }, []);

  // Pro licence: trust cache immediately, re-verify in the background.
  useEffect(() => {
    if (ready) void useLicense.getState().load();
  }, [ready]);

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
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "h" || e.key === "H")) {
        // Ctrl/Cmd+H toggles the habits tracker overlay.
        e.preventDefault();
        toggleHabits();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePalette, toggleSettings, toggleHabits]);

  return (
    <div className="h-screen w-screen flex flex-col bg-ink-950 text-ink-100 bg-grid">
      <ErrorBoundary scope="CommandBar"><CommandBar /></ErrorBoundary>
      <div className={`flex-1 min-h-0 grid grid-cols-[240px_minmax(0,1fr)_360px] gap-3 px-3 pt-2 ${showTimeline ? "" : "pb-3"}`}>
        <ErrorBoundary scope="Sidebar"><Sidebar /></ErrorBoundary>
        <ErrorBoundary scope="TimerStage"><TimerStage /></ErrorBoundary>
        <ErrorBoundary scope="NotesPanel"><NotesPanel /></ErrorBoundary>
      </div>
      {showTimeline && <ErrorBoundary scope="TimelineBar"><TimelineBar /></ErrorBoundary>}
      <ErrorBoundary scope="CommandPalette"><CommandPalette /></ErrorBoundary>
      <ErrorBoundary scope="AskNerva"><AskNerva /></ErrorBoundary>
      <ErrorBoundary scope="KeyboardCheatsheet"><KeyboardCheatsheet /></ErrorBoundary>
      <ErrorBoundary scope="SettingsPane"><SettingsPane /></ErrorBoundary>
      <ErrorBoundary scope="HabitsPane"><HabitsPane /></ErrorBoundary>
      <ErrorBoundary scope="Tutorial">
        <Tutorial open={tutorialOpen} onClose={hideTutorial} />
      </ErrorBoundary>
      <ErrorBoundary scope="TelemetryConsent"><TelemetryConsent /></ErrorBoundary>
      <ErrorBoundary scope="RatingPrompt"><RatingPrompt /></ErrorBoundary>
      <ErrorBoundary scope="WhatsNew"><WhatsNew /></ErrorBoundary>
    </div>
  );
}
