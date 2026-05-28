import { create } from "zustand";
import {
  ipc,
  type AudioState,
  type FocusState,
  type MomentumBucket,
  type NoteMeta,
  type Task,
  type Timer,
  type Workspace,
} from "@/lib/ipc";

interface AppStore {
  ready: boolean;
  /** Names of bootstrap slices that failed (workspaces|timers|notes|tasks|momentum|audio|focus).
   *  Empty array means a clean boot. Used by the UI to surface partial failures
   *  without blocking the whole app from rendering. */
  bootstrapErrors: string[];
  workspaces: Workspace[];
  active: Workspace | null;
  timers: Timer[];
  notes: NoteMeta[];
  tasks: Task[];
  momentum: MomentumBucket[];
  audio: AudioState | null;
  focus: FocusState | null;
  bootstrap: () => Promise<void>;
  refreshTimers: () => Promise<void>;
  refreshNotes: () => Promise<void>;
  refreshTasks: () => Promise<void>;
  refreshMomentum: () => Promise<void>;
  activateWorkspace: (id: string) => Promise<void>;
  lastNoteFor: (workspaceId: string) => Promise<string | null>;
  setVolume: (v: number) => Promise<void>;
  setMuted: (m: boolean) => Promise<void>;
  testAudio: () => Promise<void>;
  setAmbient: (kind: "white" | "pink" | "brown" | null) => Promise<void>;
  setAmbientVolume: (v: number) => Promise<void>;
  setDnd: (on: boolean) => Promise<void>;
  createTask: (title: string) => Promise<void>;
  toggleTask: (id: string) => Promise<void>;
  renameTask: (id: string, title: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  reorderTasks: (orderedIds: string[]) => Promise<void>;
  setTaskPriority: (id: string, priority: import("@/lib/ipc").TaskPriority) => Promise<void>;
  setTaskDue: (id: string, dueMs: number | null) => Promise<void>;
}

export const useApp = create<AppStore>((set, get) => ({
  ready: false,
  bootstrapErrors: [],
  workspaces: [],
  active: null,
  timers: [],
  notes: [],
  tasks: [],
  momentum: [],
  audio: null,
  focus: null,
  async bootstrap() {
    // Resilient boot: each slice is fetched independently, so a single
    // corrupted projection (or a transient backend hiccup) can never wedge
    // the entire app in `ready: false`. Every failure is logged + surfaced
    // via `bootstrapErrors`, and the slice falls back to its empty default.
    const results = await Promise.allSettled([
      ipc.workspaceList(),
      ipc.workspaceActive(),
      ipc.timerList(),
      ipc.noteList(),
      ipc.taskList(),
      ipc.momentumSnapshot(7),
      ipc.audioState(),
      ipc.focusState(),
    ]);
    const slices = [
      "workspaces",
      "active",
      "timers",
      "notes",
      "tasks",
      "momentum",
      "audio",
      "focus",
    ] as const;
    const errors: string[] = [];
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        errors.push(slices[i]);
        console.error(`[bootstrap] slice "${slices[i]}" failed:`, r.reason);
      }
    });
    const pick = <T,>(i: number, fallback: T): T =>
      results[i].status === "fulfilled"
        ? ((results[i] as PromiseFulfilledResult<T>).value ?? fallback)
        : fallback;
    set({
      workspaces: pick(0, [] as Workspace[]),
      active: pick(1, null as Workspace | null),
      timers: pick(2, [] as Timer[]),
      notes: pick(3, [] as NoteMeta[]),
      tasks: pick(4, [] as Task[]),
      momentum: pick(5, [] as MomentumBucket[]),
      audio: pick(6, null as AudioState | null),
      focus: pick(7, null as FocusState | null),
      bootstrapErrors: errors,
      ready: true,
    });
  },
  async refreshTimers() {
    try {
      const rep = await ipc.timerTick();
      set({ timers: rep.timers });
    } catch (e) {
      console.warn("[refreshTimers] failed:", e);
    }
  },
  async refreshNotes() {
    try {
      set({ notes: await ipc.noteList() });
    } catch (e) {
      console.warn("[refreshNotes] failed:", e);
    }
  },
  async refreshTasks() {
    try {
      set({ tasks: await ipc.taskList() });
    } catch (e) {
      console.warn("[refreshTasks] failed:", e);
    }
  },
  async refreshMomentum() {
    try {
      set({ momentum: await ipc.momentumSnapshot(7) });
    } catch (e) {
      console.warn("[refreshMomentum] failed:", e);
    }
  },
  async activateWorkspace(id) {
    await ipc.workspaceActivate(id);
    const active = await ipc.workspaceActive();
    set({ active });
    await get().refreshTimers();
    await get().refreshNotes();
    await get().refreshTasks();
  },
  async lastNoteFor(workspaceId) {
    return ipc.lastNoteForWorkspace(workspaceId);
  },
  async setVolume(v) {
    set({ audio: await ipc.audioSetVolume(v) });
  },
  async setMuted(m) {
    set({ audio: await ipc.audioSetMuted(m) });
  },
  async testAudio() {
    await ipc.audioTest();
  },
  async setAmbient(kind) {
    set({ audio: await ipc.ambientSet(kind) });
  },
  async setAmbientVolume(v) {
    set({ audio: await ipc.ambientSetVolume(v) });
  },
  async setDnd(on) {
    set({ focus: await ipc.focusSetDnd(on) });
  },
  async createTask(title) {
    const t = title.trim();
    if (!t) return;
    await ipc.taskCreate({ title: t });
    await get().refreshTasks();
  },
  async toggleTask(id) {
    await ipc.taskToggle(id);
    await Promise.all([get().refreshTasks(), get().refreshMomentum()]);
  },
  async deleteTask(id) {
    await ipc.taskDelete(id);
    await get().refreshTasks();
  },
  async renameTask(id, title) {
    const v = title.trim();
    if (!v) return;
    await ipc.taskRename({ id, title: v });
    await get().refreshTasks();
  },
  async reorderTasks(orderedIds) {
    // Optimistic reorder so the drop animation doesn't snap back while we
    // wait for the round-trip; the server response replaces the optimistic
    // list with the authoritative one.
    const current = get().tasks;
    const indexed = new Map(current.map((t) => [t.id, t]));
    const reordered = [
      ...orderedIds.map((id) => indexed.get(id)).filter((t): t is NonNullable<typeof t> => !!t),
      ...current.filter((t) => !orderedIds.includes(t.id)),
    ];
    set({ tasks: reordered });
    const tasks = await ipc.taskReorder({ ordered_ids: orderedIds });
    set({ tasks });
  },
  async setTaskPriority(id, priority) {
    await ipc.taskSetPriority({ id, priority });
    await get().refreshTasks();
  },
  async setTaskDue(id, dueMs) {
    await ipc.taskSetDue({ id, due_ms: dueMs });
    await get().refreshTasks();
  },
}));
