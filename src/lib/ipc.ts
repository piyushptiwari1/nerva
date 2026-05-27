import { invoke } from "@tauri-apps/api/core";

// ---- types (mirror Rust) ----
export type TimerStatus = "idle" | "running" | "paused" | "completed" | "cancelled";

export interface Timer {
  id: string;
  name: string;
  color: string;
  duration_ms: number;
  status: TimerStatus;
  started_at_ms: number | null;
  paused_total_ms: number;
  paused_at_ms: number | null;
  workspace_id: string | null;
  parent_id: string | null;
  group_id: string | null;
  remaining_ms: number;
}

export interface Workspace {
  id: string;
  name: string;
  color: string;
  created_ms: number;
}

export interface NoteMeta {
  id: string;
  workspace_id: string | null;
  title: string;
  updated_ms: number;
}

export interface Note {
  id: string;
  workspace_id: string;
  title: string;
  body: string;
  updated_ms: number;
}

export interface StoredEvent {
  id: number;
  ts_ms: number;
  kind: string;
  payload: unknown;
}

export interface RuntimeInfo {
  version: string;
  data_dir: string;
  event_count: number;
}

export interface TickReport {
  completed: string[];
  timers: Timer[];
}

// ---- commands ----
export const ipc = {
  ping: () => invoke<string>("ping"),
  runtime: () => invoke<RuntimeInfo>("get_runtime_info"),
  // timers
  timerCreate: (args: { name: string; duration_ms: number; color?: string; workspace_id?: string }) =>
    invoke<Timer>("timer_create", { args }),
  timerStart: (id: string) => invoke<Timer>("timer_start", { id }),
  timerPause: (id: string) => invoke<Timer>("timer_pause", { id }),
  timerResume: (id: string) => invoke<Timer>("timer_resume", { id }),
  timerReset: (id: string) => invoke<Timer>("timer_reset", { id }),
  timerDelete: (id: string) => invoke<void>("timer_delete", { id }),
  timerList: () => invoke<Timer[]>("timer_list"),
  timerTick: () => invoke<TickReport>("timer_tick"),
  // notes
  noteGet: (id: string) => invoke<Note | null>("note_get", { id }),
  noteSave: (args: { id?: string; title: string; body: string; workspace_id?: string }) =>
    invoke<Note>("note_save", { args }),
  noteList: () => invoke<NoteMeta[]>("note_list"),
  // workspaces
  workspaceList: () => invoke<Workspace[]>("workspace_list"),
  workspaceCreate: (args: { name: string; color?: string }) =>
    invoke<Workspace>("workspace_create", { args }),
  workspaceActivate: (id: string) => invoke<void>("workspace_activate", { id }),
  workspaceActive: () => invoke<Workspace | null>("workspace_active"),
  // timeline
  eventsRecent: (limit?: number) => invoke<StoredEvent[]>("events_recent", { limit }),
};

export function formatRemaining(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
