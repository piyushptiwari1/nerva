import { useEffect, useMemo, useState } from "react";
import { ipc, type StoredEvent } from "@/lib/ipc";

/**
 * Bottom strip — recent events plus a scrubber that lets you walk back through
 * history without leaving the keyboard. The scrubber maps `[0, N-1]` over the
 * event log; index `N-1` is "now". Read-only — it never mutates state.
 */
export function TimelineBar() {
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [scrub, setScrub] = useState<number | null>(null);
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    const tick = () =>
      ipc
        .eventsRecent(200)
        .then((evs) => {
          // Backend returns newest-first; reverse so left=old → right=now.
          setEvents([...evs].reverse());
        })
        .catch(() => void 0);
    tick();
    const h = window.setInterval(tick, 3000);
    return () => window.clearInterval(h);
  }, []);

  const max = Math.max(0, events.length - 1);
  const idx = scrub ?? max;
  const focused: StoredEvent | undefined = events[idx];
  const visible = useMemo(() => events.slice(-60), [events]);

  return (
    <footer className="mx-3 my-3 glass rounded-xl px-3 py-2 flex flex-col gap-1.5 min-h-0">
      <div className="flex items-center gap-3 min-h-0">
        <span className="text-[10px] uppercase tracking-wider text-ink-400 shrink-0">
          Timeline
        </span>
        <div className="flex-1 overflow-x-auto whitespace-nowrap flex items-center gap-1.5 py-1">
          {visible.length === 0 && (
            <span className="text-xs text-ink-500">
              Your day will replay here as you work.
            </span>
          )}
          {visible.map((ev) => (
            <span
              key={ev.id}
              title={`${ev.kind} · ${new Date(ev.ts_ms).toLocaleTimeString()}`}
              className={`text-[10px] px-1.5 py-0.5 rounded ${badgeClass(ev.kind)} ${
                focused?.id === ev.id ? "ring-1 ring-accent" : ""
              }`}
            >
              {shortKind(ev.kind)}
            </span>
          ))}
        </div>
        <span className="text-[10px] text-ink-500 tnum shrink-0">
          {events.length} events
        </span>
      </div>
      {events.length > 1 && (
        <div className="flex items-center gap-3 px-1">
          <input
            type="range"
            min={0}
            max={max}
            value={idx}
            onChange={(e) => {
              const v = Number(e.target.value);
              setScrub(v);
              setPinned(v !== max);
            }}
            onDoubleClick={() => {
              setScrub(null);
              setPinned(false);
            }}
            className="flex-1 accent-accent h-1 cursor-pointer"
            aria-label="Scrub timeline"
          />
          <span
            className="text-[10px] text-ink-400 tnum w-[220px] text-right truncate"
            title={focused ? eventTooltip(focused) : ""}
          >
            {focused
              ? `${shortKind(focused.kind)} · ${formatStamp(focused.ts_ms)} · ${summarizePayload(
                  focused.payload,
                )}`
              : "—"}
          </span>
          <button
            onClick={() => {
              setScrub(null);
              setPinned(false);
            }}
            className={`text-[10px] px-1.5 py-0.5 rounded ${
              pinned
                ? "bg-accent/20 text-accent-glow hover:bg-accent/30"
                : "text-ink-500"
            }`}
            title="Jump to now"
            disabled={!pinned}
          >
            now
          </button>
        </div>
      )}
    </footer>
  );
}

/** Multi-line tooltip used as the `title` attribute on the focused-event line.
 *  Shows kind, full timestamp, and a pretty-printed view of the payload. */
function eventTooltip(ev: StoredEvent): string {
  const stamp = new Date(ev.ts_ms).toLocaleString();
  const payload = ev.payload ? JSON.stringify(ev.payload, null, 2) : "";
  return `${ev.kind}\n${stamp}\n${payload}`;
}

/** Pick a couple of common keys for an inline summary so the scrubbed-event
 *  line is still legible at a glance without expanding the tooltip. */
function summarizePayload(p: unknown): string {
  if (!p || typeof p !== "object") return "";
  const o = p as Record<string, unknown>;
  for (const k of ["title", "name", "prompt"]) {
    const v = o[k];
    if (typeof v === "string" && v.length > 0) {
      return v.length > 40 ? v.slice(0, 37) + "…" : v;
    }
  }
  const id = o["id"];
  if (typeof id === "string") return `id=${id.slice(0, 8)}…`;
  return "";
}

function shortKind(k: string): string {
  return k
    .replace("timer.", "t·")
    .replace("note.", "n·")
    .replace("task.", "k·")
    .replace("workspace.", "w·");
}

function badgeClass(k: string): string {
  if (k.startsWith("timer.")) return "bg-accent/15 text-accent-glow";
  if (k.startsWith("note.")) return "bg-rest/15 text-rest";
  if (k.startsWith("task.")) return "bg-focus/15 text-focus";
  if (k.startsWith("workspace.")) return "bg-focus/15 text-focus";
  return "bg-ink-700/60 text-ink-300";
}

function formatStamp(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  return sameDay
    ? d.toLocaleTimeString()
    : d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}
