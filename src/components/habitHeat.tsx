import { useMemo } from "react";
import type { HabitEntry } from "@/lib/ipc";

export function todayIso(): string {
  return iso(new Date());
}
export function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function isoMinusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return iso(d);
}

export function hexWithAlpha(hex: string, a: number): string {
  if (!/^#?[0-9a-fA-F]{6}$/.test(hex.replace(/^#/, ""))) return `rgba(124,156,255,${a})`;
  const h = hex.replace(/^#/, "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function describeEntry(e: HabitEntry | undefined, target: number): string {
  if (!e) return " · no entry";
  if (e.skipped) return " · skipped";
  if (e.value >= target) return ` · done (${e.value})`;
  return ` · ${e.value} / ${target}`;
}

/** Week-column heatmap, Monday at top, today outlined. */
export function Heatmap({ entries, fromDay, toDay, target, color, cellSize = 12 }: {
  entries: HabitEntry[]; fromDay: string; toDay: string; target: number; color: string; cellSize?: number;
}) {
  const byDay = useMemo(() => new Map(entries.map((e) => [e.day, e] as const)), [entries]);
  const days = useMemo(() => {
    const out: string[] = [];
    const cur = new Date(fromDay + "T00:00:00");
    const end = new Date(toDay + "T00:00:00");
    while (cur <= end) { out.push(iso(cur)); cur.setDate(cur.getDate() + 1); }
    return out;
  }, [fromDay, toDay]);
  const monIndex = (d: string) => (new Date(d + "T00:00:00").getDay() + 6) % 7;

  const cols: Array<Array<string | null>> = [];
  let col: Array<string | null> = [];
  if (days.length) for (let i = 0; i < monIndex(days[0]); i++) col.push(null);
  for (const d of days) { col.push(d); if (col.length === 7) { cols.push(col); col = []; } }
  if (col.length) { while (col.length < 7) col.push(null); cols.push(col); }

  function fill(day: string | null): string {
    if (!day) return "transparent";
    const e = byDay.get(day);
    if (!e) return "var(--heat-empty)";
    if (e.skipped) return "rgba(167,175,190,0.18)";
    const ratio = Math.max(0, Math.min(1, e.value / target));
    if (ratio <= 0) return "rgba(232,125,125,0.14)";
    return hexWithAlpha(color, 0.22 + 0.68 * ratio);
  }

  const gap = 3;
  const width = cols.length * (cellSize + gap);
  const height = 7 * (cellSize + gap);
  return (
    <div className="overflow-x-auto">
      <div className="text-[11px] uppercase tracking-wider text-ink-400 mb-1.5">Last 12 weeks</div>
      <svg width={width} height={height} className="block">
        {cols.map((c, ci) => c.map((day, ri) => (
          <rect key={`${ci}-${ri}`} x={ci * (cellSize + gap)} y={ri * (cellSize + gap)} width={cellSize} height={cellSize} rx={2.5}
            fill={fill(day)} stroke={day === toDay ? hexWithAlpha(color, 0.95) : "none"} strokeWidth={day === toDay ? 1.5 : 0}>
            {day && <title>{`${day}${describeEntry(byDay.get(day), target)}`}</title>}
          </rect>
        )))}
      </svg>
    </div>
  );
}
