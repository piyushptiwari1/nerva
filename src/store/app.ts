import { create } from "zustand";
import { ipc, type NoteMeta, type Timer, type Workspace } from "@/lib/ipc";

interface AppStore {
  ready: boolean;
  workspaces: Workspace[];
  active: Workspace | null;
  timers: Timer[];
  notes: NoteMeta[];
  bootstrap: () => Promise<void>;
  refreshTimers: () => Promise<void>;
  refreshNotes: () => Promise<void>;
  activateWorkspace: (id: string) => Promise<void>;
  lastNoteFor: (workspaceId: string) => Promise<string | null>;
}

export const useApp = create<AppStore>((set, get) => ({
  ready: false,
  workspaces: [],
  active: null,
  timers: [],
  notes: [],
  async bootstrap() {
    const [workspaces, active, timers, notes] = await Promise.all([
      ipc.workspaceList(),
      ipc.workspaceActive(),
      ipc.timerList(),
      ipc.noteList(),
    ]);
    set({ workspaces, active, timers, notes, ready: true });
  },
  async refreshTimers() {
    const rep = await ipc.timerTick();
    set({ timers: rep.timers });
  },
  async refreshNotes() {
    set({ notes: await ipc.noteList() });
  },
  async activateWorkspace(id) {
    await ipc.workspaceActivate(id);
    const active = await ipc.workspaceActive();
    set({ active });
    await get().refreshTimers();
    await get().refreshNotes();
  },
  async lastNoteFor(workspaceId) {
    return ipc.lastNoteForWorkspace(workspaceId);
  },
}));
