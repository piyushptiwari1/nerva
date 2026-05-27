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
}

export const useApp = create<AppStore>((set, get) => ({
  ready: false,
  workspaces: [],
  active: null,
  timers: [],
  notes: [],
  tasks: [],
  momentum: [],
  audio: null,
  focus: null,
  async bootstrap() {
    const [workspaces, active, timers, notes, tasks, momentum, audio, focus] =
      await Promise.all([
        ipc.workspaceList(),
        ipc.workspaceActive(),
        ipc.timerList(),
        ipc.noteList(),
        ipc.taskList(),
        ipc.momentumSnapshot(7),
        ipc.audioState().catch(() => null),
        ipc.focusState().catch(() => null),
      ]);
    set({ workspaces, active, timers, notes, tasks, momentum, audio, focus, ready: true });
  },
  async refreshTimers() {
    const rep = await ipc.timerTick();
    set({ timers: rep.timers });
  },
  async refreshNotes() {
    set({ notes: await ipc.noteList() });
  },
  async refreshTasks() {
    set({ tasks: await ipc.taskList() });
  },
  async refreshMomentum() {
    set({ momentum: await ipc.momentumSnapshot(7) });
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
}));
