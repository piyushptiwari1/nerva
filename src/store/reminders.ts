import { create } from "zustand";
import { ipc, type Reminder, type Repeat, type Upcoming } from "@/lib/ipc";
import { isAndroid } from "@/lib/platform";

export interface FiredToast extends Upcoming {
  at: number;
}

interface RemindersStore {
  upcoming: Upcoming[];
  reminders: Reminder[];
  toasts: FiredToast[];
  loaded: boolean;
  refresh: () => Promise<void>;
  create: (args: { title: string; due_ms: number; repeat?: Repeat; task_id?: string }) => Promise<Reminder>;
  snooze: (id: string, minutes?: number) => Promise<void>;
  done: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  pushToast: (f: Upcoming) => void;
  dismissToast: (id: string) => void;
}

const HORIZON_MS = 7 * 86_400_000;

export const useReminders = create<RemindersStore>((set, get) => ({
  upcoming: [],
  reminders: [],
  toasts: [],
  loaded: false,
  async refresh() {
    try {
      const [upcoming, reminders] = await Promise.all([
        ipc.reminderUpcoming(HORIZON_MS),
        ipc.reminderList(),
      ]);
      set({ upcoming, reminders, loaded: true });
      void syncMobileSchedule(upcoming);
    } catch {
      set({ loaded: true });
    }
  },
  async create(args) {
    const r = await ipc.reminderCreate(args);
    await get().refresh();
    return r;
  },
  async snooze(id, minutes = 10) {
    await ipc.reminderSnooze(id, minutes);
    get().dismissToast(id);
    await get().refresh();
  },
  async done(id) {
    await ipc.reminderDone(id);
    get().dismissToast(id);
    await get().refresh();
  },
  async remove(id) {
    await ipc.reminderDelete(id);
    get().dismissToast(id);
    await get().refresh();
  },
  pushToast(f) {
    set((s) => ({ toasts: [...s.toasts.filter((t) => t.id !== f.id), { ...f, at: Date.now() }] }));
  },
  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

let wired = false;
/** Subscribe once to backend events; safe to call from any shell. */
export async function initReminders(): Promise<void> {
  if (wired) return;
  wired = true;
  const store = useReminders.getState();
  await store.refresh();
  try {
    const { listen } = await import("@tauri-apps/api/event");
    await listen<Upcoming>("reminder:fired", (e) => {
      useReminders.getState().pushToast(e.payload);
      void useReminders.getState().refresh();
    });
    for (const ev of ["reminder:changed", "task:changed", "workspace:changed"]) {
      await listen(ev, () => void useReminders.getState().refresh());
    }
  } catch {
    /* outside Tauri (tests, web preview) */
  }
}

// ── Android: hand the next week to the OS so alarms fire when the process is gone.

const SCHEDULED_KEY = "nerva.reminders.scheduledIds";

/** Stable 31-bit id from a string so we can cancel what we scheduled. */
function notifId(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 1) || 1;
}

async function syncMobileSchedule(upcoming: Upcoming[]): Promise<void> {
  if (!isAndroid()) return;
  try {
    const n = await import("@tauri-apps/plugin-notification");
    if (!(await n.isPermissionGranted())) return;
    const previous: number[] = JSON.parse(localStorage.getItem(SCHEDULED_KEY) ?? "[]");
    if (previous.length) await n.cancel(previous).catch(() => void 0);
    const now = Date.now();
    const ids: number[] = [];
    for (const u of upcoming.filter((u) => u.due_ms > now + 5_000).slice(0, 48)) {
      const id = notifId(`${u.kind}:${u.id}:${u.due_ms}`);
      ids.push(id);
      n.sendNotification({
        id,
        title: u.kind === "task" ? `Due: ${u.title}` : u.title,
        body: u.kind === "task" ? "Task deadline reached. Nerva by Bytical" : "Reminder. Nerva by Bytical",
        schedule: n.Schedule.at(new Date(u.due_ms), false, true),
      });
    }
    localStorage.setItem(SCHEDULED_KEY, JSON.stringify(ids));
  } catch {
    /* plugin unavailable */
  }
}
