import { useState } from "react";
import { useApp } from "@/store/app";
import { ipc } from "@/lib/ipc";

/**
 * Compact sound + focus settings popover used in the CommandBar.
 * Volume, mute, test ding, DND toggle (Linux GNOME via gsettings),
 * and a "pop up timer" button.
 */
export function FocusMenu() {
  const { audio, focus, setVolume, setMuted, testAudio, setDnd } = useApp();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs px-2 py-1 rounded-md hairline hover:bg-ink-700/60 text-ink-300 flex items-center gap-1.5"
        title="Sound, focus, widgets"
      >
        <span className="text-base leading-none">{audio?.muted ? "🔇" : "🔔"}</span>
        <span className="hidden md:inline">Focus</span>
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 mt-2 z-50 w-72 glass rounded-xl p-3 flex flex-col gap-3 shadow-2xl border border-ink-700/40">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] uppercase tracking-wider text-ink-400">
                  Completion ring
                </span>
                <button
                  onClick={() => setMuted(!audio?.muted)}
                  className={`text-[10px] px-2 py-0.5 rounded ${
                    audio?.muted
                      ? "bg-rose-500/20 text-rose-200"
                      : "bg-emerald-500/15 text-emerald-200"
                  }`}
                >
                  {audio?.muted ? "Muted" : "On"}
                </button>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round((audio?.volume ?? 0) * 100)}
                onChange={(e) => setVolume(parseInt(e.target.value, 10) / 100)}
                disabled={!audio?.available || audio?.muted}
                className="w-full accent-accent disabled:opacity-40"
              />
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-[10px] text-ink-500">
                  {audio?.available
                    ? `Volume ${Math.round((audio?.volume ?? 0) * 100)}%`
                    : "No audio device"}
                </span>
                <button
                  onClick={() => testAudio()}
                  disabled={!audio?.available || audio?.muted}
                  className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded hairline hover:bg-ink-700 disabled:opacity-40"
                >
                  Test
                </button>
              </div>
            </div>

            <div className="border-t border-ink-700/40 pt-2">
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-[11px] uppercase tracking-wider text-ink-400">
                    Do not disturb
                  </span>
                  <span className="text-[10px] text-ink-500">
                    {focus?.supported
                      ? "GNOME notification banners"
                      : "Not supported on this desktop"}
                  </span>
                </div>
                <button
                  onClick={() => setDnd(!focus?.dnd)}
                  disabled={!focus?.supported}
                  className={`text-[10px] px-2 py-0.5 rounded ${
                    focus?.dnd
                      ? "bg-amber-500/20 text-amber-200"
                      : "bg-ink-800 text-ink-300"
                  } disabled:opacity-40`}
                >
                  {focus?.dnd ? "On" : "Off"}
                </button>
              </div>
            </div>

            <div className="border-t border-ink-700/40 pt-2">
              <button
                onClick={() => ipc.openTimerWidget()}
                className="w-full text-xs px-2 py-1.5 rounded-md bg-accent/20 hover:bg-accent/30 text-accent-glow"
              >
                Pop up timer widget
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
