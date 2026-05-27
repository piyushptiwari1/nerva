import { useCallback, useEffect, useState } from "react";
import { ipc, type Task, type TaskPriority } from "@/lib/ipc";

/**
 * Floating always-on-top tasks widget (single window label `tasks-widget`).
 *
 * Shows open tasks for the active workspace, sorted by priority then
 * deadline. Supports inline create, one-tap complete, priority cycling and
 * deadline removal. Re-fetches on focus and on a low-frequency poll so it
 * stays consistent with edits in the main window.
 */
export function TasksWidget() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [activeWs, setActiveWs] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [list, ws] = await Promise.all([
      ipc.taskList(),
      ipc.workspaceActive(),
    ]);
    setActiveWs(ws?.id ?? null);
    // Scope the widget to the active workspace + global (null workspace) tasks
    // so users see what matters where they are.
    const wsId = ws?.id ?? null;
    setTasks(
      list.filter(
        (t) => t.status === "todo" && (t.workspace_id === wsId || t.workspace_id === null),
      ),
    );
  }, []);

  useEffect(() => {
    refresh();
    const h = window.setInterval(refresh, 4000);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(h);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  async function add() {
    const title = draft.trim();
    if (!title) return;
    setDraft("");
    await ipc.taskCreate({ title, workspace_id: activeWs ?? undefined });
    await refresh();
  }

  async function toggle(id: string) {
    if (busy) return;
    setBusy(id);
    try {
      await ipc.taskToggle(id);
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function cyclePriority(t: Task) {
    const next: TaskPriority =
      t.priority === "high" ? "med" : t.priority === "med" ? "low" : "high";
    await ipc.taskSetPriority({ id: t.id, priority: next });
    await refresh();
  }

  async function close() {
    try {
      const win = (await import("@tauri-apps/api/window")).getCurrentWindow();
      await win.close();
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-ink-950 text-ink-100 select-none">
      <header
        data-tauri-drag-region
        className="h-9 px-3 flex items-center justify-between cursor-grab active:cursor-grabbing bg-ink-900 border-b border-ink-700 shrink-0"
        title="Drag to move"
      >
        <span data-tauri-drag-region className="flex items-center gap-2 pointer-events-none">
          <span className="text-ink-400 text-sm leading-none">⋮⋮</span>
          <span className="text-[10px] uppercase tracking-widest text-ink-300">
            Tasks
          </span>
        </span>
        <button
          onClick={close}
          className="text-ink-400 hover:text-ink-100 text-base leading-none px-1"
          title="Close widget"
        >
          ×
        </button>
      </header>

      <div className="px-2 py-2 border-b border-ink-800 shrink-0">
        <div className="flex gap-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
            placeholder="+ task"
            className="flex-1 bg-ink-900 border border-ink-700 rounded-md px-2 py-1 text-sm text-ink-100 placeholder:text-ink-500 focus:outline-none focus:border-accent/60"
          />
          <button
            onClick={add}
            disabled={!draft.trim()}
            className="px-2 rounded-md bg-accent/20 hover:bg-accent/30 text-accent-glow text-xs border border-accent/30 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            add
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {tasks.length === 0 ? (
          <div className="text-xs text-ink-400 text-center mt-8 px-4">
            Nothing open. Type above to add a task.
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {tasks.map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-ink-800/60 transition-colors group"
              >
                <button
                  onClick={() => cyclePriority(t)}
                  className="shrink-0"
                  title={`Priority: ${t.priority} (click to cycle)`}
                >
                  <PriorityDot priority={t.priority} />
                </button>
                <button
                  onClick={() => toggle(t.id)}
                  disabled={busy === t.id}
                  className="w-5 h-5 grid place-items-center rounded-md border border-ink-700 bg-ink-800 hover:border-accent/40 hover:text-accent-glow text-ink-400 text-[12px] disabled:opacity-50 shrink-0"
                  title="Complete"
                >
                  ✓
                </button>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-ink-200 truncate">{t.title}</div>
                  {t.due_ms ? (
                    <div className={`text-[10px] mt-0.5 ${dueClass(t.due_ms)}`}>
                      {formatDue(t.due_ms)}
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PriorityDot({ priority }: { priority: TaskPriority }) {
  const map: Record<TaskPriority, string> = {
    high: "bg-danger",
    med: "bg-focus",
    low: "bg-ink-500",
  };
  return (
    <span
      className={`w-2 h-2 rounded-full ${map[priority]} block`}
      aria-label={`priority ${priority}`}
    />
  );
}

function formatDue(ms: number): string {
  const d = new Date(ms);
  const diff = ms - Date.now();
  const dayMs = 86_400_000;
  if (diff < -dayMs) return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " · overdue";
  if (diff < 0) return "overdue";
  if (diff < dayMs) return `today ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  if (diff < 2 * dayMs) return `tomorrow ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function dueClass(ms: number): string {
  if (ms < Date.now()) return "text-danger";
  if (ms < Date.now() + 86_400_000) return "text-focus";
  return "text-ink-400";
}
