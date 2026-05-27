import { useState } from "react";
import { useApp } from "@/store/app";

/**
 * Compact tasks list. Workspace-scoped; the backend defaults new tasks to the
 * active workspace, so the panel just filters by `active.id` for display.
 */
export function TasksPanel() {
  const tasks = useApp((s) => s.tasks);
  const active = useApp((s) => s.active);
  const createTask = useApp((s) => s.createTask);
  const toggleTask = useApp((s) => s.toggleTask);
  const deleteTask = useApp((s) => s.deleteTask);
  const [draft, setDraft] = useState("");
  const [showDone, setShowDone] = useState(false);

  const scoped = active
    ? tasks.filter((t) => t.workspace_id === active.id || !t.workspace_id)
    : tasks;
  const todo = scoped.filter((t) => t.status === "todo");
  const done = scoped.filter((t) => t.status === "done");
  const visible = showDone ? scoped : todo;

  async function submit() {
    const v = draft.trim();
    if (!v) return;
    setDraft("");
    await createTask(v);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[11px] uppercase tracking-wider text-ink-400">Tasks</h3>
        <button
          onClick={() => setShowDone((v) => !v)}
          className="text-[10px] text-ink-400 hover:text-ink-100"
          title="Toggle completed"
        >
          {showDone ? "hide done" : `${done.length} done`}
        </button>
      </div>
      <div className="mb-2 flex gap-1">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="What needs doing?"
          className="flex-1 min-w-0 bg-ink-800 hairline rounded-md px-2 py-1 text-sm"
        />
        <button
          onClick={submit}
          disabled={!draft.trim()}
          className="text-xs px-2 rounded-md bg-accent/20 hover:bg-accent/30 text-accent-glow disabled:opacity-40"
        >
          Add
        </button>
      </div>
      <div className="flex flex-col gap-1 max-h-[240px] overflow-y-auto pr-1">
        {visible.length === 0 && (
          <div className="text-[11px] text-ink-500">
            {showDone ? "Nothing here yet." : "Inbox zero. Nice."}
          </div>
        )}
        {visible.map((t) => {
          const isDone = t.status === "done";
          return (
            <div
              key={t.id}
              className="group flex items-center gap-2 px-1.5 py-1 rounded hover:bg-ink-800/60"
            >
              <button
                onClick={() => toggleTask(t.id)}
                className={`shrink-0 w-3.5 h-3.5 rounded border ${
                  isDone
                    ? "bg-accent/60 border-accent"
                    : "border-ink-500 hover:border-ink-300"
                }`}
                title={isDone ? "Mark as todo" : "Mark done"}
              />
              <span
                className={`flex-1 text-sm truncate ${
                  isDone ? "text-ink-500 line-through" : "text-ink-100"
                }`}
                title={t.title}
              >
                {t.title}
              </span>
              <button
                onClick={() => deleteTask(t.id)}
                className="opacity-0 group-hover:opacity-100 text-ink-500 hover:text-ink-200 text-xs leading-none"
                title="Delete"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
