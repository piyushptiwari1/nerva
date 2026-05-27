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

export interface SemanticHit {
  id: string;
  title: string;
  workspace_id: string | null;
  /** cosine similarity in [-1, 1]; ~>0.5 is typically meaningful */
  score: number;
}

export type AmbientKind = "white" | "pink" | "brown";

export interface AudioState {
  volume: number;
  muted: boolean;
  available: boolean;
  ambient: AmbientKind | null;
  ambient_volume: number;
}

export interface FocusState {
  dnd: boolean | null;
  supported: boolean;
}

export type TaskStatus = "todo" | "done";
export type TaskPriority = "high" | "med" | "low";

export interface Task {
  id: string;
  workspace_id: string | null;
  title: string;
  status: TaskStatus;
  created_ms: number;
  completed_ms: number | null;
  priority: TaskPriority;
  due_ms: number | null;
}

export interface MomentumBucket {
  date: string;
  start_ms: number;
  completed_timers: number;
  completed_tasks: number;
  focus_ms: number;
}

export type HabitKind = "bool" | "count" | "amount";

export interface Habit {
  id: string;
  workspace_id: string | null;
  name: string;
  kind: HabitKind;
  target: number | null;
  unit: string | null;
  color: string;
  created_ms: number;
  archived: boolean;
}

export interface HabitEntry {
  habit_id: string;
  day: string;       // ISO YYYY-MM-DD
  value: number;
  skipped: boolean;
  updated_ms: number;
}

export interface HabitStats {
  habit_id: string;
  current_streak: number;
  best_streak: number;
  completion_30d: number;  // 0..1
  completion_all: number;  // 0..1
  total_completions: number;
  weekday_rate: number[];  // length 7, Mon..Sun
  sparkline_30d: number[]; // length 30, oldest→newest
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
  noteSemanticSearch: (query: string, limit?: number) =>
    invoke<SemanticHit[]>("note_semantic_search", { args: { query, limit } }),
  lastNoteForWorkspace: (workspaceId: string) =>
    invoke<string | null>("last_note_for_workspace", { workspaceId }),
  openSticky: (noteId: string) => invoke<void>("open_sticky", { noteId }),
  openTimerWidget: () => invoke<void>("open_timer_widget"),
  openHabitsWidget: () => invoke<void>("open_habits_widget"),
  openTasksWidget: () => invoke<void>("open_tasks_widget"),
  audioState: () => invoke<AudioState>("audio_state"),
  audioSetVolume: (volume: number) => invoke<AudioState>("audio_set_volume", { volume }),
  audioSetMuted: (muted: boolean) => invoke<AudioState>("audio_set_muted", { muted }),
  audioTest: () => invoke<void>("audio_test"),
  ambientSet: (kind: AmbientKind | null) =>
    invoke<AudioState>("ambient_set", { args: { kind } }),
  ambientSetVolume: (volume: number) =>
    invoke<AudioState>("ambient_set_volume", { volume }),
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
  taskSetPriority: (args: { id: string; priority: TaskPriority }) =>
    invoke<Task>("task_set_priority", { args }),
  taskSetDue: (args: { id: string; due_ms: number | null }) =>
    invoke<Task>("task_set_due", { args }),
  // momentum
  momentumSnapshot: (days?: number) =>
    invoke<MomentumBucket[]>("momentum_snapshot", { days }),
  // habits
  habitList: () => invoke<Habit[]>("habit_list"),
  habitCreate: (args: {
    name: string;
    kind: HabitKind;
    target?: number | null;
    unit?: string | null;
    color?: string;
    workspace_id?: string;
  }) => invoke<Habit>("habit_create", { args }),
  habitUpdate: (args: {
    id: string;
    name?: string;
    color?: string;
    target?: number | null;
    unit?: string | null;
  }) => invoke<Habit>("habit_update", { args }),
  habitDelete: (id: string) => invoke<void>("habit_delete", { id }),
  habitLog: (args: { habit_id: string; day: string; value: number; skipped?: boolean }) =>
    invoke<HabitEntry>("habit_log", { args }),
  habitClear: (args: { habit_id: string; day: string }) =>
    invoke<void>("habit_clear", { args }),
  habitEntries: (args: { habit_id: string; from_day: string; to_day: string }) =>
    invoke<HabitEntry[]>("habit_entries", { args }),
  habitStats: (args: { habit_id: string; today: string }) =>
    invoke<HabitStats>("habit_stats", { args }),
};

export function formatRemaining(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
