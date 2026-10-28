/** Compact relative/absolute label for a due time: "in 25m", "14:30",
 *  "Tomorrow 09:00", "Thu 09:00", "3 Nov 09:00", "overdue". */
export function whenLabel(dueMs: number, now = Date.now()): string {
  const diff = dueMs - now;
  if (diff < -60_000) return "overdue";
  if (diff < 60 * 60_000) return `in ${Math.max(1, Math.round(diff / 60_000))}m`;
  const d = new Date(dueMs);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) return time;
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow ${time}`;
  if (diff < 6 * 86_400_000) return `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
  return `${d.toLocaleDateString([], { day: "numeric", month: "short" })} ${time}`;
}

export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Next quarter hour at least 15 minutes away — a sensible default. */
export function defaultDue(now = Date.now()): number {
  const q = 15 * 60_000;
  return Math.ceil((now + q) / q) * q;
}
