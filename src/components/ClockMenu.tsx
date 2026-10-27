import { useEffect, useMemo, useRef, useState } from "react";
import { Clock3, Plus, X } from "lucide-react";
import { useClocks, MAX_CLOCKS } from "@/store/layout";
import { dayDelta, offsetLabel, prettyZone, timeIn } from "@/components/WorldClock";

/**
 * Top-bar clock. The visible part is only the local time (and weekday on
 * wide screens). Clicking opens a compact popover with today's date, the
 * local zone and the user's world clocks — all time context in one place
 * instead of a sidebar section that took vertical space all day.
 */
export function ClockMenu() {
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  const zones = useClocks((s) => s.zones);
  const add = useClocks((s) => s.add);
  const remove = useClocks((s) => s.remove);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = window.setInterval(() => setNow(Date.now()), open ? 1000 : 15_000);
    return () => window.clearInterval(h);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const allZones = useMemo(() => supportedZones(), []);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/\s+/g, "_");
    if (!q) return [];
    return allZones.filter((z) => !zones.includes(z) && z.toLowerCase().includes(q)).slice(0, 6);
  }, [query, allZones, zones]);

  const date = new Date(now);
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const weekday = date.toLocaleDateString([], { weekday: "short" });

  function pick(z: string) {
    add(z);
    setQuery("");
    setAdding(false);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`control-chip tnum ${open ? "is-active" : ""}`}
        title="Date, time and world clocks"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Clock: ${weekday} ${time}. Open date and world clocks`}
      >
        <Clock3 size={14} aria-hidden="true" />
        <span className="hidden lg:inline text-ink-400">{weekday}</span>
        <span>{time}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            ref={panel}
            role="dialog"
            aria-label="Date and world clocks"
            className="popover absolute right-0 mt-2 z-50 w-80 rounded-xl p-3 flex flex-col gap-3"
          >
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wider text-ink-400">
                  {date.toLocaleDateString([], { weekday: "long" })}
                </div>
                <div className="text-base font-semibold text-ink-100 truncate">
                  {date.toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" })}
                </div>
                <div className="text-[11px] text-ink-500 truncate" title={localZone}>{prettyZone(localZone)} · your zone</div>
              </div>
              <div className="text-2xl font-semibold tnum text-ink-100 leading-none">
                {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </div>
            </div>

            <div className="section-rule" />

            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wider text-ink-400">World clocks</span>
              {zones.length < MAX_CLOCKS && (
                <button
                  onClick={() => setAdding((v) => !v)}
                  className="icon-button-sm"
                  title={adding ? "Cancel" : "Add a time zone"}
                  aria-label={adding ? "Cancel adding time zone" : "Add a time zone"}
                >
                  {adding ? <X size={14} /> : <Plus size={14} />}
                </button>
              )}
            </div>

            {adding && (
              <div>
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") { e.stopPropagation(); setAdding(false); }
                    if (e.key === "Enter" && matches[0]) pick(matches[0]);
                  }}
                  placeholder="City or zone… e.g. London"
                  className="field w-full"
                  aria-label="Search time zones"
                />
                {matches.length > 0 && (
                  <div className="mt-1 flex flex-col">
                    {matches.map((z) => (
                      <button key={z} onClick={() => pick(z)} className="text-left text-xs px-2 py-1.5 rounded hover:bg-ink-800/70 text-ink-200 truncate">
                        {prettyZone(z)} <span className="text-ink-500">· {timeIn(z, now)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {zones.length === 0 && !adding ? (
              <button onClick={() => setAdding(true)} className="text-left text-xs text-ink-400 hover:text-ink-100 px-2 py-1.5 rounded-md hover:bg-ink-800/60 transition-colors">
                + add a time zone
              </button>
            ) : (
              <div className="flex flex-col">
                {zones.map((z) => {
                  const day = dayDelta(z, now);
                  return (
                    <div key={z} className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-ink-800/60 transition-colors" title={z}>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-ink-200 truncate">{prettyZone(z)}</div>
                        <div className="text-[10px] text-ink-500 tnum">
                          {offsetLabel(z, now)}
                          {day !== 0 && <span className="ml-1">{day > 0 ? "+1 day" : "−1 day"}</span>}
                        </div>
                      </div>
                      <div className="text-sm tnum text-ink-100">{timeIn(z, now)}</div>
                      <button onClick={() => remove(z)} className="icon-button-sm opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-ink-500 hover:text-danger" title="Remove" aria-label={`Remove ${prettyZone(z)}`}>
                        <X size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
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
    "UTC", "Europe/London", "Europe/Paris", "Europe/Berlin", "America/New_York", "America/Chicago",
    "America/Los_Angeles", "America/Sao_Paulo", "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore",
    "Asia/Tokyo", "Asia/Shanghai", "Australia/Sydney", "Pacific/Auckland", "Africa/Johannesburg",
  ];
}
