import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Flame, LayoutGrid, ListTodo, Moon, NotebookPen, Plus, Settings, Sun, Timer, Trash2, X } from "lucide-react";
import { useApp } from "@/store/app";
import { useSettingsUi } from "@/store/settings";
import { useTheme } from "@/store/theme";
import { useLicense, planLabel } from "@/lib/license";
import { TimerStage } from "@/components/TimerStage";
import { TasksPanel } from "@/components/TasksPanel";
import { HabitsRail } from "@/components/HabitsRail";
import { HabitsPane } from "@/components/HabitsPane";
import { NotesPanel } from "@/components/NotesPanel";
import { WorkspaceDeleteDialog } from "@/components/WorkspaceDeleteDialog";
import { SettingsPane } from "@/components/SettingsPane";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { WhatsNew } from "@/components/WhatsNew";
import { useNativeWidgets, useWidgetDeepLink } from "./widgets";
import { WidgetsPane } from "./WidgetsPane";
import { initTelemetry } from "@/lib/telemetry";
import { initReminders } from "@/store/reminders";
import { ReminderToasts } from "@/components/ReminderToasts";
import { ipc } from "@/lib/ipc";
import nervaIcon from "../../src-tauri/icons/icon.png";
import "./mobile.css";

type Tab = "focus" | "tasks" | "habits" | "notes";

const TABS = [
  { id: "focus", label: "Focus", Icon: Timer },
  { id: "tasks", label: "Tasks", Icon: ListTodo },
  { id: "habits", label: "Habits", Icon: Flame },
  { id: "notes", label: "Notes", Icon: NotebookPen },
] as const;

/**
 * One-column phone shell. Same Rust core, same stores, same panels as the
 * desktop app — just stacked behind a bottom tab bar instead of a 3-column
 * grid. No floating windows, tray, or keyboard shortcuts on this surface.
 */
export function MobileApp() {
  const { ready, bootstrap, refreshTimers, workspaces, active, activateWorkspace } = useApp();
  const widgetError = useNativeWidgets();
  const [tab, setTab] = useState<Tab>("focus");
  useWidgetDeepLink(setTab);
  const [widgetsOpen, setWidgetsOpen] = useState(false);
  const [workspaceSheet, setWorkspaceSheet] = useState(false);
  const [workspaceDraft, setWorkspaceDraft] = useState<string | null>(null);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [deletingWorkspace, setDeletingWorkspace] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  useEffect(() => {
    if (ready) void initReminders();
  }, [ready]);

  useEffect(() => initTelemetry(), []);

  // UI refresh cadence; the engine itself is wall-clock based.
  useEffect(() => {
    if (!ready) return;
    const h = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshTimers().catch(() => void 0);
    }, 250);
    return () => window.clearInterval(h);
  }, [ready, refreshTimers]);

  // Catch up after the WebView was suspended: Android freezes JS timers in
  // the background, so a single tick on resume snaps the UI to wall-clock.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshTimers().catch(() => void 0);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refreshTimers]);

  async function changeWorkspace(id: string) {
    setWorkspaceBusy(true);
    setError(null);
    try { await activateWorkspace(id); setWorkspaceSheet(false); }
    catch (failure) { setError(String(failure)); }
    finally { setWorkspaceBusy(false); }
  }

  async function createWorkspace() {
    if (!workspaceDraft?.trim() || workspaceBusy) return;
    setWorkspaceBusy(true);
    setError(null);
    try {
      const workspace = await ipc.workspaceCreate({ name: workspaceDraft.trim() });
      await bootstrap();
      await activateWorkspace(workspace.id);
      setWorkspaceDraft(null);
      setWorkspaceSheet(false);
    } catch (failure) { setError(String(failure)); }
    finally { setWorkspaceBusy(false); }
  }

  return (
    <div className="mobile-app bg-ink-950 text-ink-100">
      <header className="mobile-header">
        <img className="mobile-brand-icon" src={nervaIcon} alt="Nerva" />
        <button
          onClick={() => setWorkspaceSheet(true)}
          className="mobile-workspace-chip"
          aria-haspopup="dialog"
          aria-expanded={workspaceSheet}
          aria-label={`Workspace: ${active?.name ?? "none"}. Switch workspace`}
        >
          <span className="mobile-workspace-dot" style={{ background: active?.color ?? "#7c9cff" }} aria-hidden="true" />
          <span className="truncate">{active?.name ?? "Workspace"}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        {isPro && (
          <span className="mobile-pro" title={`Nerva Pro: ${planLabel(plan)}`}>Pro</span>
        )}
        <div className="ml-auto flex items-center">
          <button onClick={() => setWidgetsOpen(true)} className="mobile-icon" aria-label="Home-screen widgets" title="Home-screen widgets"><LayoutGrid size={22} /></button>
          <button
            onClick={toggleTheme}
            className="mobile-icon"
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            title={theme === "dark" ? "Light theme" : "Dark theme"}
          >
            {theme === "dark" ? <Sun size={22} /> : <Moon size={22} />}
          </button>
          <button
            onClick={() => openSettings(true)}
            className="mobile-icon"
            aria-label="Settings"
            title="Settings"
          >
            <Settings size={22} />
          </button>
        </div>
      </header>

      <AnimatePresence>
        {workspaceSheet && (
          <>
            <motion.div
              className="mobile-scrim"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => { setWorkspaceSheet(false); setWorkspaceDraft(null); }}
            />
            <motion.div
              role="dialog"
              aria-label="Workspaces"
              className="mobile-sheet"
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 420, damping: 38 }}
            >
              <div className="mobile-sheet-grip" aria-hidden="true" />
              <div className="mobile-sheet-title">Workspaces</div>
              <ul className="mobile-sheet-list" aria-label="Workspaces">
                {workspaces.map((workspace) => (
                  <li key={workspace.id}>
                    <button
                      className={`mobile-sheet-row ${workspace.id === active?.id ? "is-active" : ""}`}
                      disabled={workspaceBusy}
                      onClick={() => void changeWorkspace(workspace.id)}
                      aria-current={workspace.id === active?.id ? "true" : undefined}
                    >
                      <span className="mobile-workspace-dot" style={{ background: workspace.color }} aria-hidden="true" />
                      <span className="flex-1 truncate text-left">{workspace.name}</span>
                      {workspace.id === active?.id && <Check size={18} aria-hidden="true" />}
                    </button>
                  </li>
                ))}
              </ul>
              {workspaceDraft === null ? (
                <div className="mobile-sheet-actions">
                  <button onClick={() => setWorkspaceDraft("")} className="btn-primary mobile-wide"><Plus size={18} /> New workspace</button>
                  <button
                    disabled={!active || workspaceBusy || workspaces.length < 2}
                    onClick={() => { setWorkspaceSheet(false); setDeletingWorkspace(true); }}
                    className="btn mobile-wide"
                  >
                    <Trash2 size={18} /> Delete “{active?.name}”
                  </button>
                </div>
              ) : (
                <form onSubmit={(event) => { event.preventDefault(); void createWorkspace(); }} className="mobile-sheet-actions">
                  <input autoFocus className="field mobile-wide" value={workspaceDraft} onChange={(event) => setWorkspaceDraft(event.target.value)} aria-label="Workspace name" placeholder="Workspace name" />
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setWorkspaceDraft(null)} className="btn flex-1"><X size={18} /> Cancel</button>
                    <button type="submit" disabled={workspaceBusy || !workspaceDraft.trim()} className="btn-primary flex-1"><Check size={18} /> Create</button>
                  </div>
                </form>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
      <main className="mobile-content" id="mobile-tab-panel" role="tabpanel" aria-labelledby={`mobile-tab-${tab}`}>
        {(widgetError || error) && <p role="alert" className="mobile-error">{error ?? `Widget refresh failed: ${widgetError}`}</p>}
        {!ready && <div className="text-xs text-ink-500 p-4">Loading…</div>}
        {ready && tab === "focus" && (
          <ErrorBoundary scope="TimerStage"><TimerStage /></ErrorBoundary>
        )}
        {ready && tab === "tasks" && (
          <ErrorBoundary scope="TasksPanel">
            <section className="mobile-list-pane"><TasksPanel /></section>
          </ErrorBoundary>
        )}
        {ready && tab === "habits" && (
          <ErrorBoundary scope="HabitsRail">
            <section className="mobile-list-pane"><HabitsRail /></section>
          </ErrorBoundary>
        )}
        {ready && tab === "notes" && (
          <ErrorBoundary scope="NotesPanel"><NotesPanel /></ErrorBoundary>
        )}
      </main>

      <nav
        className="mobile-tabs"
        role="tablist"
        aria-label="Workspace views"
      >
        {TABS.map(({ id, label, Icon }) => {
          const selected = tab === id;
          return (
            <button
              key={id}
              id={`mobile-tab-${id}`}
              role="tab"
              aria-controls="mobile-tab-panel"
              aria-selected={selected}
              onClick={() => setTab(id)}
              className={selected ? "selected" : ""}
            >
              <Icon size={21} aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </nav>

      <ErrorBoundary scope="SettingsPane"><SettingsPane /></ErrorBoundary>
      {deletingWorkspace && active && <WorkspaceDeleteDialog workspace={active} onClose={() => setDeletingWorkspace(false)} />}
      <ErrorBoundary scope="HabitsPane"><HabitsPane /></ErrorBoundary>
      {widgetsOpen && <ErrorBoundary scope="WidgetsPane"><WidgetsPane onClose={() => setWidgetsOpen(false)} /></ErrorBoundary>}
      <ErrorBoundary scope="WhatsNew"><WhatsNew /></ErrorBoundary>
      <ErrorBoundary scope="ReminderToasts"><ReminderToasts /></ErrorBoundary>
    </div>
  );
}
