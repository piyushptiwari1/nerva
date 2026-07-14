import { useEffect, useState } from "react";
import { consentState, setConsent, maybeSendWeeklyPing } from "@/lib/telemetry";

/**
 * One-time opt-in dialog for anonymous usage stats. Shown on the main window
 * only, and only while the user hasn't made a choice yet. Declining is a
 * first-class path — single click, persisted, never nags again. The choice
 * can be changed later in Settings → About.
 */
export function TelemetryConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Delay slightly so it never covers the tutorial's first frame.
    const t = window.setTimeout(() => {
      if (consentState() === "unset") setVisible(true);
    }, 1500);
    return () => window.clearTimeout(t);
  }, []);

  if (!visible) return null;

  function choose(granted: boolean) {
    setConsent(granted);
    setVisible(false);
    if (granted) void maybeSendWeeklyPing();
  }

  return (
    <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto glass rounded-xl border border-ink-700/60 shadow-2xl p-4 max-w-md w-full">
        <h3 className="text-sm font-semibold text-ink-100">
          Help improve Nerva?
        </h3>
        <p className="text-xs text-ink-400 mt-1.5 leading-relaxed">
          Share <span className="text-ink-200">anonymous usage stats</span> once a
          week — app version, OS, and feature counts (e.g. “12 notes, 3 timers”).
          Never the contents of your notes, tasks, or anything you type. No
          account, no IP profiling. Off by default; change anytime in
          Settings&nbsp;→&nbsp;About.
        </p>
        <div className="flex items-center justify-end gap-2 mt-3">
          <button
            onClick={() => choose(false)}
            className="text-xs px-3 py-1.5 rounded-md hairline hover:bg-ink-800 text-ink-300"
          >
            No thanks
          </button>
          <button
            onClick={() => choose(true)}
            className="text-xs font-semibold px-3 py-1.5 rounded-md bg-accent text-ink-950 hover:bg-accent-glow"
          >
            Share anonymous stats
          </button>
        </div>
      </div>
    </div>
  );
}
