import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useApp } from "@/store/app";
import type { Task } from "@/lib/ipc";

/**
 * Compact tasks list. Workspace-scoped; the backend defaults new tasks to the
 * active workspace, so the panel just filters by `active.id` for display.
 *
 * Open tasks are drag-reorderable via @dnd-kit; double-click a title to
 * rename it inline. Done tasks render as a static list under the open ones.
 */
export function TasksPanel() {
  const tasks = useApp((s) => s.tasks);
  const active = useApp((s) => s.active);
  const createTask = useApp((s) => s.createTask);
  const toggleTask = useApp((s) => s.toggleTask);
  const deleteTask = useApp((s) => s.deleteTask);
  const renameTask = useApp((s) => s.renameTask);
  const reorderTasks = useApp((s) => s.reorderTasks);

  const [draft, setDraft] = useState("");
  const [showDone, setShowDone] = useState(false);

  const scoped = active
    ? tasks.filter((t) => t.workspace_id === active.id || !t.workspace_id)
    : tasks;
  const todo = scoped.filter((t) => t.status === "todo");
  const done = scoped.filter((t) => t.status === "done");

  async function submit() {
    const v = draft.trim();
    if (!v) return;
    setDraft("");
    await createTask(v);
  }

  // Sensors: small activation distance so a single click still toggles the
  // checkbox without starting a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(ev: DragEndEvent) {
    const { active: a, over } = ev;
    if (!over || a.id === over.id) return;
    const ids = todo.map((t) => t.id);
    const from = ids.indexOf(String(a.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    void reorderTasks(arrayMove(ids, from, to));
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[11px] uppercase tracking-wider text-ink-300">
          Tasks {todo.length > 0 && <span className="text-ink-500">· {todo.length}</span>}
        </h3>
        <button
          onClick={() => setShowDone((v) => !v)}
          className="text-[10px] text-ink-300 hover:text-ink-100"
          title="Toggle completed"
        >
          {showDone ? "hide done" : `${done.length} done`}
        </button>
      </div>
      <div className="flex flex-col gap-1 max-h-[280px] overflow-y-auto pr-1 mb-2">
        {todo.length === 0 && !showDone && (
          <div className="text-[11px] text-ink-400 px-1 py-2">
            No open tasks. Add one below ↓
          </div>
        )}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={todo.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            {todo.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                onToggle={() => toggleTask(t.id)}
                onDelete={() => deleteTask(t.id)}
                onRename={(title) => renameTask(t.id, title)}
              />
            ))}
          </SortableContext>
        </DndContext>
        {showDone &&
          done.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              onToggle={() => toggleTask(t.id)}
              onDelete={() => deleteTask(t.id)}
              onRename={(title) => renameTask(t.id, title)}
              staticRow
            />
          ))}
      </div>
      <div className="flex gap-1 pt-2 border-t border-ink-700/40">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Add a task…"
          className="flex-1 min-w-0 bg-ink-800 hairline rounded-md px-2 py-1 text-sm text-ink-100 placeholder:text-ink-400"
        />
        <button
          onClick={submit}
          disabled={!draft.trim()}
          className="text-xs px-2 rounded-md bg-accent/25 hover:bg-accent/40 text-accent-glow disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </div>
  );
}

interface TaskRowProps {
  task: Task;
  onToggle: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
  /** Skip the sortable wiring (for done tasks, which aren't reorderable). */
  staticRow?: boolean;
}

function TaskRow({ task, onToggle, onDelete, onRename, staticRow }: TaskRowProps) {
  const sortable = useSortable({ id: task.id, disabled: staticRow });
  const style = staticRow
    ? undefined
    : {
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
        opacity: sortable.isDragging ? 0.6 : 1,
      };

  const isDone = task.status === "done";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  function commit() {
    const v = draft.trim();
    setEditing(false);
    if (v && v !== task.title) onRename(v);
    else setDraft(task.title);
  }

  return (
    <div
      ref={staticRow ? undefined : sortable.setNodeRef}
      style={style}
      className={`group flex items-center gap-2 px-1.5 py-1 rounded hover:bg-ink-800/60 ${
        !staticRow && sortable.isDragging ? "bg-ink-800/80 ring-1 ring-accent/40" : ""
      }`}
    >
      {/* Drag handle: rendered only on open rows; cursor + listeners scoped here
          so the checkbox + title remain clickable for their own actions. */}
      {!staticRow && (
        <span
          {...sortable.attributes}
          {...sortable.listeners}
          className="shrink-0 text-ink-600 hover:text-ink-300 cursor-grab active:cursor-grabbing text-[10px] leading-none select-none"
          title="Drag to reorder"
          aria-label="Drag handle"
        >
          ⋮⋮
        </span>
      )}
      <button
        onClick={onToggle}
        className={`shrink-0 w-3.5 h-3.5 rounded border ${
          isDone ? "bg-accent/60 border-accent" : "border-ink-500 hover:border-ink-300"
        }`}
        title={isDone ? "Mark as todo" : "Mark done"}
      />
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") { setDraft(task.title); setEditing(false); }
          }}
          className="flex-1 min-w-0 bg-ink-900 hairline rounded px-1.5 py-0.5 text-sm text-ink-100 outline-none focus:ring-1 focus:ring-accent/40"
        />
      ) : (
        <span
          onDoubleClick={() => { setDraft(task.title); setEditing(true); }}
          className={`flex-1 text-sm truncate cursor-text ${
            isDone ? "text-ink-500 line-through" : "text-ink-100"
          }`}
          title={`${task.title} — double-click to rename`}
        >
          {task.title}
        </span>
      )}
      <button
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 text-ink-500 hover:text-ink-200 text-xs leading-none"
        title="Delete"
      >
        ×
      </button>
    </div>
  );
}
