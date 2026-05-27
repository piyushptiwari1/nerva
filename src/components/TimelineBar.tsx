import { useEffect, useState } from "react";
import { ipc, type StoredEvent } from "@/lib/ipc";

/**
 * Bottom strip — recent events as a scrubbable timeline. Useful for
 * "what was I doing?" recovery after a reboot or context switch.
 */
export function TimelineBar() {
  const [events, setEvents] = useState<StoredEvent[]>([]);

  useEffect(() => {
    const tick = () => ipc.eventsRecent(60).then(setEvents).catch(() => void 0);
    tick();
    const h = window.setInterval(tick, 3000);
    return () => window.clearInterval(h);
  }, []);

  return (
    <footer className="mx-3 my-3 glass rounded-xl px-3 py-2 flex items-center gap-3 min-h-0">
      <span className="text-[10px] uppercase tracking-wider text-ink-400 shrink-0">
        Timeline
      </span>
      <div className="flex-1 overflow-x-auto whitespace-nowrap flex items-center gap-1.5 py-1">
        {events.length === 0 && (
          <span className="text-xs text-ink-500">
            Your day will replay here as you work.
          </span>
        )}
        {events.map((ev) => (
          <span
            key={ev.id}
            title={`${ev.kind} · ${new Date(ev.ts_ms).toLocaleTimeString()}`}
            className={`text-[10px] px-1.5 py-0.5 rounded ${badgeClass(ev.kind)}`}
          >
            {shortKind(ev.kind)}
          </span>
        ))}
      </div>
      <span className="text-[10px] text-ink-500 tnum shrink-0">
        {events.length} events
      </span>
    </footer>
  );
}

function shortKind(k: string): string {
  return k.replace("timer.", "t·").replace("note.", "n·").replace("workspace.", "w·");
}

function badgeClass(k: string): string {
  if (k.startsWith("timer.")) return "bg-accent/15 text-accent-glow";
  if (k.startsWith("note.")) return "bg-rest/15 text-rest";
  if (k.startsWith("workspace.")) return "bg-focus/15 text-focus";
  return "bg-ink-700/60 text-ink-300";
}
