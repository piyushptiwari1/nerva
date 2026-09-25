import { useEffect, useMemo, useState } from "react";
import { useClocks, MAX_CLOCKS } from "@/store/layout";

/**
 * WorldClock — sidebar section showing up to six time zones with the
 * offset vs. local time and a +1/−1 day marker. Ticks every 30 s (we only
 * show minutes). Zone list comes from the runtime's ICU data via
 * `Intl.supportedValuesOf`, with a small fallback for older WebViews.
 */
export function WorldClock() {
  const zones = useClocks((s) => s.zones);
  const add = useClocks((s) => s.add);
  const remove = useClocks((s) => s.remove);
  const [now, setNow] = useState(() => Date.now());
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const tick = () => setNow(Date.now());
    // Align to the next minute boundary, then every 30 s.
    const first = window.setTimeout(() => {
      tick();
    }, 60_000 - (Date.now() % 60_000) + 50);
    const h = window.setInterval(tick, 30_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(h);
    };
  }, []);

  const allZones = useMemo(() => supportedZones(), []);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/\s+/g, "_");
    if (!q) return [];
    return allZones
      .filter((z) => !zones.includes(z) && z.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, allZones, zones]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[11px] uppercase tracking-wider text-ink-400">World clocks</h3>
        {zones.length < MAX_CLOCKS && (
          <button
            onClick={() => setAdding((v) => !v)}
            className="text-ink-400 hover:text-ink-100 text-sm leading-none"
            title={adding ? "Cancel" : "Add a time zone"}
            aria-label={adding ? "Cancel adding time zone" : "Add a time zone"}
          >
            {adding ? "×" : "+"}
          </button>
        )}
      </div>
      {adding && (
        <div className="mb-2">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setAdding(false);
              if (e.key === "Enter" && matches[0]) {
                add(matches[0]);
                setQuery("");
                setAdding(false);
              }
            }}
            placeholder="City or zone… e.g. London"
            className="w-full bg-ink-800 hairline rounded-md px-2 py-1 text-sm"
            aria-label="Search time zones"
          />
          {matches.length > 0 && (
            <div className="mt-1 flex flex-col">
              {matches.map((z) => (
                <button
                  key={z}
                  onClick={() => {
                    add(z);
                    setQuery("");
                    setAdding(false);
                  }}
                  className="text-left text-xs px-2 py-1 rounded hover:bg-ink-800/60 text-ink-200 truncate"
                >
                  {prettyZone(z)} <span className="text-ink-500">· {timeIn(z, now)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {zones.length === 0 && !adding ? (
        <button
          onClick={() => setAdding(true)}
          className="w-full text-left text-xs text-ink-400 hover:text-ink-100 px-2 py-1.5 rounded-md hover:bg-ink-800/60 transition-colors"
        >
          + add a time zone
        </button>
      ) : (
        <div className="flex flex-col gap-1">
          {zones.map((z) => {
            const off = offsetLabel(z, now);
            const day = dayDelta(z, now);
            return (
              <div
                key={z}
                className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-ink-800/60 transition-colors"
                title={z}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-ink-200 truncate">{prettyZone(z)}</div>
                  <div className="text-[10px] text-ink-500 tnum">
                    {off}
                    {day !== 0 && <span className="ml-1">{day > 0 ? "+1 day" : "−1 day"}</span>}
                  </div>
                </div>
                <div className="text-sm tnum text-ink-100">{timeIn(z, now)}</div>
                <button
                  onClick={() => remove(z)}
                  className="opacity-0 group-hover:opacity-100 text-ink-500 hover:text-danger text-sm leading-none"
                  title="Remove"
                  aria-label={`Remove ${prettyZone(z)}`}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function supportedZones(): string[] {
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
    const v = intl.supportedValuesOf?.("timeZone");
    if (v && v.length) return v;
  } catch {
    /* fall through */
  }
  return [
    "UTC", "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Madrid", "Europe/Rome",
    "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Toronto",
    "America/Sao_Paulo", "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Tokyo", "Asia/Shanghai",
    "Australia/Sydney", "Pacific/Auckland", "Africa/Johannesburg",
  ];
}

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
