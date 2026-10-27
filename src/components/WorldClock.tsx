/**
 * Time-zone helpers shared by the top-bar clock popover (ClockMenu).
 * Pure functions over `Intl`; no React here.
 */

export function prettyZone(z: string): string {
  const city = z.split("/").pop() ?? z;
  return city.replace(/_/g, " ");
}

export function timeIn(zone: string, now: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: zone,
    }).format(now);
  } catch {
    return "--:--";
  }
}

/** Minutes east of UTC for `zone` at instant `now`. */
export function zoneOffsetMin(zone: string, now: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(now / 1000) * 1000) / 60_000);
}

/** e.g. "+5:30 vs you", "same as you", "−8h vs you". */
export function offsetLabel(zone: string, now: number): string {
  try {
    const diff = zoneOffsetMin(zone, now) + new Date(now).getTimezoneOffset();
    if (diff === 0) return "same as you";
    const sign = diff > 0 ? "+" : "−";
    const h = Math.floor(Math.abs(diff) / 60);
    const m = Math.abs(diff) % 60;
    return `${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : "h"} vs you`;
  } catch {
    return "";
  }
}

/** −1, 0 or +1: is it yesterday/today/tomorrow there relative to local? */
export function dayDelta(zone: string, now: number): number {
  try {
    const fmt = (tz?: string) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    const there = fmt(zone);
    const here = fmt(undefined);
    if (there === here) return 0;
    return there > here ? 1 : -1;
  } catch {
    return 0;
  }
}
