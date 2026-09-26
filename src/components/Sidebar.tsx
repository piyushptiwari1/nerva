import { useApp } from "@/store/app";
import { useLayout, type SectionId } from "@/store/layout";
import { ipc } from "@/lib/ipc";
import { useState, type ReactNode } from "react";
import { TasksPanel } from "@/components/TasksPanel";
import { HabitsRail } from "@/components/HabitsRail";
import { WorldClock } from "@/components/WorldClock";

export function Sidebar() {
  const order = useLayout((s) => s.order);
  const hidden = useLayout((s) => s.hidden);

  // Sections are user-orderable and hideable (Settings → Layout). The
  // first visible one has no top divider.
  const sections: Record<SectionId, ReactNode> = {
    workspaces: <WorkspacesSection />,
    tasks: <TasksPanel />,
    habits: <HabitsRail />,
    clocks: <WorldClock />,
    momentum: (
      <>
        <h3 className="text-[11px] uppercase tracking-wider text-ink-400 mb-2">This week</h3>
        <ThisWeek />
      </>
    ),
  };
  const visible = order.filter((id) => !hidden.includes(id));

  return (
    <aside className="glass rounded-xl p-3 flex flex-col gap-3 min-h-0 overflow-y-auto">
      {visible.map((id, i) => (
        <div key={id} className={i === 0 ? "" : "border-t border-ink-700/40 pt-3"}>
          {sections[id]}
        </div>
      ))}
      {visible.length === 0 && (
        <div className="text-xs text-ink-400">
          All sidebar sections are hidden. Re-enable them in Settings → Layout.
        </div>
      )}
    </aside>
  );
}

function WorkspacesSection() {
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
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[11px] uppercase tracking-wider text-ink-400">Workspaces</h3>
        <button
          onClick={() => setCreating((v) => !v)}
          className="text-ink-400 hover:text-ink-100 text-sm leading-none"
          title="New workspace"
          aria-label={creating ? "Cancel new workspace" : "New workspace"}
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
  );
}

function fmtHours(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

/** Plain-language 7-day summary with a week-over-week delta. Buckets arrive
 *  oldest→newest (14 days); the last 7 are "this week". */
function ThisWeek() {
  const buckets = useApp((s) => s.momentum);
  const week = buckets.slice(-7);
  const prev = buckets.slice(-14, -7);
  const sum = (bs: typeof buckets, k: "focus_ms" | "completed_timers" | "completed_tasks") =>
    bs.reduce((acc, b) => acc + b[k], 0);
  const focus = sum(week, "focus_ms");
  const sessions = sum(week, "completed_timers");
  const tasks = sum(week, "completed_tasks");
  const prevFocus = sum(prev, "focus_ms");

  if (!buckets.length || (focus === 0 && sessions === 0 && tasks === 0)) {
    return (
      <div className="text-xs text-ink-400 leading-snug">
        Finish a timer or a task and your week shows up here.
      </div>
    );
  }

  let delta: string | null = null;
  if (prevFocus > 0) {
    const pct = Math.round(((focus - prevFocus) / prevFocus) * 100);
    if (pct === 0) delta = "same as last week";
    else delta = `${Math.abs(pct)}% ${pct > 0 ? "more" : "less"} than last week`;
  } else if (focus > 0) {
    delta = "first week with focus time";
  }

  return (
    <div className="text-xs text-ink-300">
      <div className="grid grid-cols-3 gap-2">
        <Stat value={fmtHours(focus)} label="focused" />
        <Stat value={String(sessions)} label={sessions === 1 ? "session" : "sessions"} />
        <Stat value={String(tasks)} label={tasks === 1 ? "task done" : "tasks done"} />
      </div>
      {delta && <p className="mt-2 text-[11px] text-ink-400 leading-snug">{delta}</p>}
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-0">
      <div className="tnum text-ink-100 text-sm leading-tight truncate">{value}</div>
      <div className="text-[10px] text-ink-500 truncate">{label}</div>
    </div>
  );
}
