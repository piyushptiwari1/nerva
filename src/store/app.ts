import { create } from "zustand";
import { ipc, type AudioState, type FocusState, type NoteMeta, type Timer, type Workspace } from "@/lib/ipc";

interface AppStore {
  ready: boolean;
  workspaces: Workspace[];
  active: Workspace | null;
  timers: Timer[];
  notes: NoteMeta[];
  audio: AudioState | null;
  focus: FocusState | null;
  bootstrap: () => Promise<void>;
  refreshTimers: () => Promise<void>;
  refreshNotes: () => Promise<void>;
  activateWorkspace: (id: string) => Promise<void>;
  lastNoteFor: (workspaceId: string) => Promise<string | null>;
  setVolume: (v: number) => Promise<void>;
  setMuted: (m: boolean) => Promise<void>;
  testAudio: () => Promise<void>;
  setDnd: (on: boolean) => Promise<void>;
}

export const useApp = create<AppStore>((set, get) => ({
  ready: false,
  workspaces: [],
  active: null,
  timers: [],
  notes: [],
  audio: null,
  focus: null,
  async bootstrap() {
    const [workspaces, active, timers, notes, audio, focus] = await Promise.all([
      ipc.workspaceList(),
      ipc.workspaceActive(),
      ipc.timerList(),
      ipc.noteList(),
      ipc.audioState().catch(() => null),
      ipc.focusState().catch(() => null),
    ]);
    set({ workspaces, active, timers, notes, audio, focus, ready: true });
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
  async setVolume(v) {
    set({ audio: await ipc.audioSetVolume(v) });
  },
  async setMuted(m) {
    set({ audio: await ipc.audioSetMuted(m) });
  },
  async testAudio() {
    await ipc.audioTest();
  },
  async setDnd(on) {
    set({ focus: await ipc.focusSetDnd(on) });
  },
}));
