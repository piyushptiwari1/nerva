import { useEffect, useState } from "react";
import { Check, Flame, LayoutGrid, ListTodo, Moon, NotebookPen, Plus, Settings, Sun, Timer, Trash2, X } from "lucide-react";
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
import { useNativeWidgets } from "./widgets";
import { WidgetsPane } from "./WidgetsPane";
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
  const [widgetsOpen, setWidgetsOpen] = useState(false);
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
    try { await activateWorkspace(id); }
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
    } catch (failure) { setError(String(failure)); }
    finally { setWorkspaceBusy(false); }
  }

  return (
    <div className="mobile-app bg-ink-950 text-ink-100">
      <header className="mobile-header">
        <img className="mobile-brand-icon" src={nervaIcon} alt="" />
        <div className="mobile-brand"><strong>Nerva</strong><span>by Bytical</span></div>
        {isPro && (
          <span
            className="text-[10px] font-semibold text-focus"
            title={`Nerva Pro: ${planLabel(plan)}`}
          >
            Pro
          </span>
        )}
        <div className="ml-auto flex items-center">
          <button onClick={() => setWidgetsOpen(true)} className="mobile-icon" aria-label="Home-screen widgets" title="Home-screen widgets"><LayoutGrid size={20} /></button>
          <button
            onClick={toggleTheme}
            className="mobile-icon"
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            title={theme === "dark" ? "Light theme" : "Dark theme"}
          >
            {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
          </button>
          <button
            onClick={() => openSettings(true)}
            className="mobile-icon"
            aria-label="Settings"
            title="Settings"
          >
            <Settings size={20} />
          </button>
        </div>
      </header>
      <div className="mobile-workspace">
        {workspaceDraft === null ? <>
          <label className="flex-1 min-w-0"><span>Workspace</span>
            <select value={active?.id ?? ""} disabled={workspaceBusy} onChange={(event) => void changeWorkspace(event.target.value)} aria-label="Active workspace">
              {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
            </select>
          </label>
          <button onClick={() => setWorkspaceDraft("")} className="mobile-icon" aria-label="New workspace" title="New workspace"><Plus size={20} /></button>
          <button disabled={!active || workspaceBusy} onClick={() => setDeletingWorkspace(true)} className="mobile-icon" aria-label="Delete workspace" title="Delete workspace"><Trash2 size={19} /></button>
        </> : <form onSubmit={(event) => { event.preventDefault(); void createWorkspace(); }} className="flex w-full items-center gap-1">
          <input autoFocus className="flex-1 min-w-0" value={workspaceDraft} onChange={(event) => setWorkspaceDraft(event.target.value)} aria-label="Workspace name" placeholder="Workspace name" />
          <button type="submit" disabled={workspaceBusy || !workspaceDraft.trim()} className="mobile-icon" aria-label="Create workspace" title="Create workspace"><Check size={20} /></button>
          <button type="button" onClick={() => setWorkspaceDraft(null)} className="mobile-icon" aria-label="Cancel workspace" title="Cancel"><X size={20} /></button>
        </form>}
      </div>
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
    </div>
  );
}
