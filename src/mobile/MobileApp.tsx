import { useEffect, useRef, useState } from "react";
import { useApp } from "@/store/app";
import { useSettingsUi } from "@/store/settings";
import { useTheme } from "@/store/theme";
import { useLicense, planLabel } from "@/lib/license";
import { TimerStage } from "@/components/TimerStage";
import { TasksPanel } from "@/components/TasksPanel";
import { HabitsRail } from "@/components/HabitsRail";
import { NotesPanel } from "@/components/NotesPanel";
import { SettingsPane } from "@/components/SettingsPane";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { WhatsNew } from "@/components/WhatsNew";
import { rescheduleTimerAlerts, runningSignature } from "./alerts";

type Tab = "focus" | "tasks" | "habits" | "notes";

const TABS: { id: Tab; label: string; glyph: string }[] = [
  { id: "focus", label: "Focus", glyph: "◔" },
  { id: "tasks", label: "Tasks", glyph: "☑" },
  { id: "habits", label: "Habits", glyph: "✦" },
  { id: "notes", label: "Notes", glyph: "✎" },
];

/**
 * One-column phone shell. Same Rust core, same stores, same panels as the
 * desktop app — just stacked behind a bottom tab bar instead of a 3-column
 * grid. No floating windows, tray, or keyboard shortcuts on this surface.
 */
export function MobileApp() {
  const { ready, bootstrap, refreshTimers, timers } = useApp();
  const [tab, setTab] = useState<Tab>("focus");
  const openSettings = useSettingsUi((s) => s.setOpen);
  const theme = useTheme((s) => s.theme);
  const toggleTheme = useTheme((s) => s.toggleTheme);
  const isPro = useLicense((s) => s.isPro);
  const plan = useLicense((s) => s.status?.plan);

  useEffect(() => {
    bootstrap().catch(console.error);
  }, [bootstrap]);

  useEffect(() => {
    if (ready) void useLicense.getState().load();
  }, [ready]);

  // UI refresh cadence; the engine itself is wall-clock based.
  useEffect(() => {
    if (!ready) return;
    const h = window.setInterval(() => {
      refreshTimers().catch(() => void 0);
    }, 250);
    return () => window.clearInterval(h);
  }, [ready, refreshTimers]);

  // Re-arm OS alarms whenever the running set changes (start/pause/reset,
  // phase flip). Debounced by signature so the 250 ms tick is a no-op.
  const lastSig = useRef("");
  useEffect(() => {
    const sig = runningSignature(timers);
    // Only phase/identity changes matter; remaining seconds tick every second
    // so compare with seconds stripped.
    const coarse = sig.replace(/:\d+(\||$)/g, "$1");
    if (coarse === lastSig.current) return;
    lastSig.current = coarse;
    void rescheduleTimerAlerts(timers);
  }, [timers]);

  // Catch up after the WebView was suspended: Android freezes JS timers in
  // the background, so a single tick on resume snaps the UI to wall-clock.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshTimers().catch(() => void 0);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refreshTimers]);

  return (
    <div
      className="h-screen w-screen flex flex-col bg-ink-950 text-ink-100 bg-grid"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <header className="h-12 px-4 flex items-center gap-2 shrink-0">
        <div className="w-6 h-6 rounded-md bg-accent/20 border border-accent/30 grid place-items-center text-accent-glow text-[11px] font-semibold">
          N
        </div>
        <span className="font-semibold tracking-tight">Nerva</span>
        <span className="text-ink-500 text-[11px] -ml-1">by Bytical</span>
        {isPro && (
          <span
            className="text-[9px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded bg-focus/15 border border-focus/40 text-focus"
            title={`Nerva Pro · ${planLabel(plan)}`}
          >
            ★ Pro
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={toggleTheme}
            className="w-9 h-9 grid place-items-center rounded-md text-ink-300 active:bg-ink-800"
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
          <button
            onClick={() => openSettings(true)}
            className="w-9 h-9 grid place-items-center rounded-md text-ink-300 active:bg-ink-800"
            aria-label="Settings"
          >
            ⚙
          </button>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 flex flex-col">
        {!ready && <div className="text-xs text-ink-500 p-4">Loading…</div>}
        {ready && tab === "focus" && (
          <ErrorBoundary scope="TimerStage"><TimerStage /></ErrorBoundary>
        )}
        {ready && tab === "tasks" && (
          <ErrorBoundary scope="TasksPanel">
            <section className="glass rounded-xl p-3"><TasksPanel /></section>
          </ErrorBoundary>
        )}
        {ready && tab === "habits" && (
          <ErrorBoundary scope="HabitsRail">
            <section className="glass rounded-xl p-3"><HabitsRail /></section>
          </ErrorBoundary>
        )}
        {ready && tab === "notes" && (
          <ErrorBoundary scope="NotesPanel"><NotesPanel /></ErrorBoundary>
        )}
      </main>

      <nav
        className="shrink-0 glass border-t border-ink-700/40 grid grid-cols-4"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        role="tablist"
      >
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className={`h-14 flex flex-col items-center justify-center gap-0.5 text-[11px] ${
                active ? "text-accent-glow" : "text-ink-400"
              }`}
            >
              <span className="text-lg leading-none">{t.glyph}</span>
              {t.label}
            </button>
          );
        })}
      </nav>

      <ErrorBoundary scope="SettingsPane"><SettingsPane /></ErrorBoundary>
      <ErrorBoundary scope="WhatsNew"><WhatsNew /></ErrorBoundary>
    </div>
  );
}
