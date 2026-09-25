import { useEffect } from "react";

/**
 * Keyboard escape hatch for pop-out windows (sticky notes, widgets).
 *
 * Esc / Ctrl+W / Cmd+W → `onClose`. Exists because a popup can land partly
 * off-screen (Wayland ignores client positioning; HiDPI/multi-monitor
 * placement is best-effort) and the user must always be able to dismiss it
 * without hunting for the × button.
 *
 * Esc inside a text field first blurs the field (so a user editing a note
 * isn't surprised by the window vanishing); a second Esc closes.
 */
export function usePopupClose(onClose: () => void | Promise<void>) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isW = (e.ctrlKey || e.metaKey) && (e.key === "w" || e.key === "W");
      if (e.key === "Escape") {
        const el = document.activeElement as HTMLElement | null;
        const editing =
          el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
        if (editing) {
          el.blur();
          return;
        }
        e.preventDefault();
        void onClose();
      } else if (isW) {
        e.preventDefault();
        void onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}
