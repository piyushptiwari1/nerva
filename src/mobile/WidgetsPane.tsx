import { useEffect, useState } from "react";
import { ArrowLeft, Check, ListTodo, NotebookPen, Plus, Timer, Flame } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { requestPermission } from "@tauri-apps/plugin-notification";
import { androidWidgets, type WidgetKind, type WidgetStatus } from "./widgets";
import { errorMessage } from "@/lib/errors";

const WIDGETS = [
  { kind: "focus", name: "Focus", Icon: Timer },
  { kind: "tasks", name: "Tasks", Icon: ListTodo },
  { kind: "habits", name: "Habits", Icon: Flame },
  { kind: "notes", name: "Pinned note", Icon: NotebookPen },
] as const;

export function WidgetsPane({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<WidgetStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!isTauri()) return;
    try { setStatus(await androidWidgets<WidgetStatus>("status")); }
    catch (failure) { setError(errorMessage(failure)); }
  }

  useEffect(() => {
    void load();
    const onFocus = () => { if (document.visibilityState === "visible") void load(); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  async function perform(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try { await action(); await load(); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }

  async function pin(kind: WidgetKind) {
    const result = await androidWidgets<{ requested: boolean }>("pin", kind);
    if (!result.requested) throw new Error("The launcher did not accept the widget request.");
  }

  return (
    <section role="dialog" aria-modal="true" aria-labelledby="widgets-title" className="mobile-fullscreen">
      <header className="mobile-view-header">
        <button onClick={onClose} className="mobile-icon" aria-label="Back" title="Back"><ArrowLeft size={20} /></button>
        <h2 id="widgets-title">Home-screen widgets</h2>
      </header>
      <div className="mobile-settings-body">
        {error && <p role="alert" className="mobile-error">{error}</p>}
        <ul className="mobile-widget-list">
          {WIDGETS.map(({ kind, name, Icon }) => (
            <li key={kind}>
              <Icon size={24} className={`mobile-widget-icon widget-${kind}`} aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <h3>{name}</h3>
                <span className="text-xs text-ink-400">{status?.counts[kind] ?? 0} on home screen</span>
              </div>
              <button disabled={busy || !status?.canPin} onClick={() => void perform(() => pin(kind))} className="mobile-icon" aria-label={`Add ${name} widget`} title={`Add ${name} widget`}><Plus size={22} /></button>
            </li>
          ))}
        </ul>
        {status && !status.canPin && <p className="text-sm text-ink-400">Launcher pinning unavailable.</p>}
        <h3 className="mobile-section-heading">Timer alerts</h3>
        <div className="mobile-setting-row">
          <span>Notifications</span>
          {status?.notifications ? <span className="mobile-status"><Check size={16} /> Allowed</span> :
            <button className="mobile-command" disabled={busy} onClick={() => void perform(requestPermission)}>Allow</button>}
        </div>
        <div className="mobile-setting-row">
          <span>Exact alarms</span>
          {status?.exactAlarms ? <span className="mobile-status"><Check size={16} /> Allowed</span> :
            <button className="mobile-command" disabled={busy} onClick={() => void perform(() => androidWidgets("alarmSettings"))}>Settings</button>}
        </div>
      </div>
    </section>
  );
}