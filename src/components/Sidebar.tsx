import { useApp } from "@/store/app";
import { ipc } from "@/lib/ipc";
import { useState } from "react";
import { TasksPanel } from "@/components/TasksPanel";
import { HabitsRail } from "@/components/HabitsRail";

export function Sidebar() {
  const { workspaces, active, activateWorkspace } = useApp();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  async function create() {
    if (!name.trim()) return;
    await ipc.workspaceCreate({ name: name.trim() });
    setName("");
    setCreating(false);
    await useApp.getState().bootstrap();
  }

  return (
    <aside className="glass rounded-xl p-3 flex flex-col gap-3 min-h-0 overflow-y-auto">
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[11px] uppercase tracking-wider text-ink-400">Workspaces</h3>
          <button
            onClick={() => setCreating((v) => !v)}
            className="text-ink-400 hover:text-ink-100 text-sm leading-none"
            title="New workspace"
          >
            {creating ? "×" : "+"}
          </button>
        </div>
        {creating && (
          <div className="mb-2 flex gap-1">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              placeholder="Name…"
              className="flex-1 min-w-0 bg-ink-800 hairline rounded-md px-2 py-1 text-sm"
            />
            <button
              onClick={create}
              className="text-xs px-2 rounded-md bg-accent/20 hover:bg-accent/30 text-accent-glow"
            >
              Add
            </button>
          </div>
        )}
        <div className="flex flex-col gap-1">
          {workspaces.map((w) => {
            const isActive = active?.id === w.id;
            return (
              <button
                key={w.id}
                onClick={() => activateWorkspace(w.id)}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left transition-colors ${
                  isActive
                    ? "bg-accent/15 text-ink-100"
                    : "text-ink-200 hover:bg-ink-800/60"
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: w.color }}
                />
                <span className="truncate">{w.name}</span>
              </button>
            );
          })}
          {workspaces.length === 0 && (
            <div className="text-xs text-ink-400">No workspaces yet.</div>
          )}
        </div>
      </div>

      <div className="border-t border-ink-700/40 pt-3">
        <TasksPanel />
      </div>

      <div className="border-t border-ink-700/40 pt-3">
        <HabitsRail />
      </div>

      <div className="border-t border-ink-700/40 pt-3">
        <h3 className="text-[11px] uppercase tracking-wider text-ink-400 mb-2">
          Momentum
        </h3>
        <Momentum />
      </div>
    </aside>
  );
}

function Momentum() {
  const momentum = useApp((s) => s.momentum);
  if (!momentum.length) {
    return <div className="text-xs text-ink-400">Gathering signals…</div>;
  }
  const focusMs = momentum.reduce((acc, b) => acc + b.focus_ms, 0);
  const tasks = momentum.reduce((acc, b) => acc + b.completed_tasks, 0);
  const peak = Math.max(1, ...momentum.map((b) => b.focus_ms));
  const hours = (focusMs / 3_600_000).toFixed(focusMs > 36_000_000 ? 0 : 1);
  return (
    <div className="text-xs text-ink-300">
      <div className="flex justify-between mb-1">
        <span>Past 7 days</span>
        <span className="tnum text-ink-100">{hours}h</span>
      </div>
      <div className="flex items-end gap-[3px] h-10">
        {momentum.map((b) => {
          const ratio = b.focus_ms / peak;
          const label = new Date(b.start_ms).toLocaleDateString(undefined, {
            weekday: "short",
          });
          return (
            <div
              key={b.start_ms}
              className="flex-1 flex flex-col items-center justify-end gap-[2px]"
              title={`${label} · ${(b.focus_ms / 3_600_000).toFixed(2)}h · ${b.completed_timers} timers · ${b.completed_tasks} tasks`}
            >
              <div
                className="w-full rounded-sm bg-accent/60"
                style={{ height: `${Math.max(2, ratio * 100)}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-1 text-[10px] text-ink-500">
        <span>{tasks} tasks done</span>
        <span>peak {(peak / 3_600_000).toFixed(1)}h</span>
      </div>
      <p className="mt-2 text-[11px] text-ink-400 leading-snug">
        No pressure — focus accumulates. Missing a day doesn't reset anything.
      </p>
    </div>
  );
}
