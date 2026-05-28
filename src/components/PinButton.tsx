import { useEffect, useState } from "react";
import { ipc } from "@/lib/ipc";

/**
 * Tiny pushpin toggle for popout window headers (sticky / timer / habits / tasks).
 *
 * Default popout windows in Nerva are *regular* toplevel windows — they stay on
 * the virtual desktop / workspace where they were opened, and don't follow the
 * user when they switch desktops. Clicking this pin flips the window to
 * always-on-top (sticky) so it floats above other apps and follows the user
 * across workspaces.
 *
 * State is local to the component; pressing the button calls the backend
 * `window_set_always_on_top` command for the current Tauri window label.
 */
export function PinButton({ className = "" }: { className?: string }) {
  const [pinned, setPinned] = useState(false);
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const w = getCurrentWindow();
        if (cancelled) return;
        setLabel(w.label);
        try {
          setPinned(await w.isAlwaysOnTop());
        } catch {
          /* older API surface — ignore */
        }
      } catch {
        /* not running under Tauri (dev/web) — hide button */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle() {
    if (!label) return;
    const next = !pinned;
    setPinned(next);
    try {
      await ipc.windowSetAlwaysOnTop(label, next);
    } catch {
      // Revert on failure.
      setPinned(!next);
    }
  }

  if (!label) return null;
  return (
    <button
      onClick={toggle}
      title={pinned ? "Unpin (let other windows cover this)" : "Pin on top (float above other apps)"}
      aria-pressed={pinned}
      className={`text-base leading-none px-1 transition-colors ${
        pinned ? "text-amber-400" : "opacity-60 hover:opacity-100"
      } ${className}`}
    >
      {pinned ? "📌" : "📍"}
    </button>
  );
}
