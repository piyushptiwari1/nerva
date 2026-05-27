import { useApp } from "@/store/app";
import { ipc } from "@/lib/ipc";
import { useState } from "react";

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
    <aside className="glass rounded-xl p-3 flex flex-col gap-3 min-h-0">
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
        <h3 className="text-[11px] uppercase tracking-wider text-ink-400 mb-2">
          Momentum
        </h3>
        <div className="text-xs text-ink-300">
          <div className="flex justify-between mb-1">
            <span>This week</span>
            <span className="tnum text-ink-100">0h</span>
          </div>
          <div className="h-1.5 bg-ink-700 rounded-full overflow-hidden">
            <div className="h-full bg-accent/60" style={{ width: "0%" }} />
          </div>
          <p className="mt-2 text-[11px] text-ink-400 leading-snug">
            No pressure — focus accumulates. Missing a day doesn't reset anything.
          </p>
        </div>
      </div>
    </aside>
  );
}
