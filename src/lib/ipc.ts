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
  task_id: string | null;
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

export interface NoteSearchHit {
  id: string;
  workspace_id: string;
  title: string;
  snippet: string;
  rank: number;
}

export interface AudioState {
  volume: number;
  muted: boolean;
  available: boolean;
}

export interface FocusState {
  dnd: boolean | null;
  supported: boolean;
}

export type TaskStatus = "todo" | "done";

export interface Task {
  id: string;
  workspace_id: string | null;
  title: string;
  status: TaskStatus;
  created_ms: number;
  completed_ms: number | null;
}

export interface MomentumBucket {
  date: string;
  start_ms: number;
  completed_timers: number;
  completed_tasks: number;
  focus_ms: number;
}

// ---- commands ----
export const ipc = {
  ping: () => invoke<string>("ping"),
  runtime: () => invoke<RuntimeInfo>("get_runtime_info"),
  // timers
  timerCreate: (args: { name: string; duration_ms: number; color?: string; workspace_id?: string; task_id?: string }) =>
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
  noteSearch: (query: string, limit?: number) =>
    invoke<NoteSearchHit[]>("note_search", { query, limit }),
  lastNoteForWorkspace: (workspaceId: string) =>
    invoke<string | null>("last_note_for_workspace", { workspaceId }),
  openSticky: (noteId: string) => invoke<void>("open_sticky", { noteId }),
  openTimerWidget: () => invoke<void>("open_timer_widget"),
  audioState: () => invoke<AudioState>("audio_state"),
  audioSetVolume: (volume: number) => invoke<AudioState>("audio_set_volume", { volume }),
  audioSetMuted: (muted: boolean) => invoke<AudioState>("audio_set_muted", { muted }),
  audioTest: () => invoke<void>("audio_test"),
  focusState: () => invoke<FocusState>("focus_state"),
  focusSetDnd: (enabled: boolean) => invoke<FocusState>("focus_set_dnd", { enabled }),
  // workspaces
  workspaceList: () => invoke<Workspace[]>("workspace_list"),
  workspaceCreate: (args: { name: string; color?: string }) =>
    invoke<Workspace>("workspace_create", { args }),
  workspaceActivate: (id: string) => invoke<void>("workspace_activate", { id }),
  workspaceActive: () => invoke<Workspace | null>("workspace_active"),
  // timeline
  eventsRecent: (limit?: number) => invoke<StoredEvent[]>("events_recent", { limit }),
  // tasks
  taskList: () => invoke<Task[]>("task_list"),
  taskCreate: (args: { title: string; workspace_id?: string }) =>
    invoke<Task>("task_create", { args }),
  taskToggle: (id: string) => invoke<Task>("task_toggle", { id }),
  taskRename: (args: { id: string; title: string }) =>
    invoke<Task>("task_rename", { args }),
  taskDelete: (id: string) => invoke<void>("task_delete", { id }),
  taskReorder: (args: { ordered_ids: string[]; workspace_id?: string }) =>
    invoke<Task[]>("task_reorder", { args }),
  // momentum
  momentumSnapshot: (days?: number) =>
    invoke<MomentumBucket[]>("momentum_snapshot", { days }),
};

export function formatRemaining(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
