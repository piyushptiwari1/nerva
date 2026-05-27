import { useEffect, useState } from "react";
import { ipc, type RuntimeInfo } from "@/lib/ipc";
import { FocusMenu } from "@/components/FocusMenu";

export function CommandBar() {
  const [info, setInfo] = useState<RuntimeInfo | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    ipc.runtime().then(setInfo).catch(() => void 0);
    const h = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(h);
  }, []);

  return (
    <div className="h-12 px-3 flex items-center gap-3">
      <div className="flex items-center gap-2 text-ink-200">
        <div className="w-6 h-6 rounded-md bg-accent/20 border border-accent/30 grid place-items-center text-accent-glow text-[11px] font-semibold">
          N
        </div>
        <span className="font-semibold tracking-tight">Nerva</span>
        <span className="text-ink-400 text-xs">v{info?.version ?? "…"}</span>
      </div>

      <div className="flex-1 mx-3">
        <div className="glass rounded-lg px-3 py-1.5 flex items-center gap-2 text-ink-300 hover:text-ink-100 transition-colors cursor-text">
          <kbd className="text-[10px] text-ink-400 border border-ink-600 rounded px-1.5 py-0.5">
            Ctrl
          </kbd>
          <kbd className="text-[10px] text-ink-400 border border-ink-600 rounded px-1.5 py-0.5">
            K
          </kbd>
          <span className="text-sm">Search, spawn timers, jump to notes…</span>
        </div>
      </div>

      <FocusMenu />

      <div className="text-xs text-ink-400 tnum">
        {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </div>
    </div>
  );
}
