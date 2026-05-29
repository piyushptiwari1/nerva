import { useCallback, useEffect, useRef, useState } from "react";
import { ipc, type Note } from "@/lib/ipc";
import { renderMarkdown } from "@/lib/markdown";
import { PinButton } from "./PinButton";

/**
 * Always-on-top sticky-note view. Opened via the `open_sticky` IPC command —
 * the parent window passes the note id as the `?sticky=<id>` query param.
 * The whole webview is draggable so the user can position it anywhere on screen.
 *
 * Data-loss contract:
 *  - Edits autosave with a 250 ms debounce.
 *  - The pending debounce is *flushed* on every escape hatch:
 *      • The in-app close button (closeWin).
 *      • The OS window close button — captured via Tauri's
 *        `onCloseRequested` event (we preventDefault, flush, then close).
 *      • Tab visibility going hidden (window minimized / workspace switched).
 *      • `beforeunload` (webview navigated / Tauri tearing down).
 *  - On every successful save we emit a Tauri `note:saved` event so the
 *    main window's NotesPanel can refresh without polling.
 */
export function StickyNote({ noteId }: { noteId: string }) {
  const [, setNote] = useState<Note | null>(null);
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<"edit" | "view">("view");
  const saveTimer = useRef<number | null>(null);
  // Latest pending payload — read by flushSave so the close path doesn't
  // need to chase the React state which may be stale at unmount time.
  const pending = useRef<{ title: string; body: string } | null>(null);
  // Workspace id is captured once after load; refs avoid re-creating the
  // flushSave closure (which is attached to native event listeners).
  const workspaceId = useRef<string | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    ipc.noteGet(noteId).then((n) => {
      if (!alive || !n) return;
      setNote(n);
      setTitle(n.title);
      setBody(n.body);
      workspaceId.current = n.workspace_id ?? undefined;
    });
    return () => {
      alive = false;
    };
  }, [noteId]);

  // Synchronous-ish flush: cancels the debounce and persists immediately.
  // Returns the save promise so callers can await before closing.
  const flushSave = useCallback(async () => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    try {
      const saved = await ipc.noteSave({
        id: noteId,
        title: p.title,
        body: p.body,
        workspace_id: workspaceId.current,
      });
      setNote(saved);
      // Notify the main window (and any other sticky on the same note)
      // so its NotesPanel re-fetches without polling.
      try {
        const { emit } = await import("@tauri-apps/api/event");
        await emit("note:saved", { id: saved.id });
      } catch {
        /* event bus unavailable — best effort */
      }
    } catch (e) {
      // Surface to console (devtools) but never throw out of the close path.
      console.error("[StickyNote] flushSave failed:", e);
    }
  }, [noteId]);

  function scheduleSave(nextTitle: string, nextBody: string) {
    pending.current = { title: nextTitle, body: nextBody };
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      flushSave();
    }, 250);
  }

  // Cross-window awareness: if the underlying note is deleted from the main
  // window, close this sticky so the user doesn't keep editing a ghost. If
  // the active workspace switches, update our captured workspace id so the
  // next save lands in the right place.
  useEffect(() => {
    let unlistenDeleted: (() => void) | undefined;
    let unlistenWs: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlistenDeleted = await listen<{ id: string }>("note:deleted", async (ev) => {
          if (ev.payload?.id !== noteId) return;
          // Drop pending edits so the close path doesn't recreate the row.
          pending.current = null;
          if (saveTimer.current) {
            window.clearTimeout(saveTimer.current);
            saveTimer.current = null;
          }
          try {
            const { getCurrentWindow } = await import("@tauri-apps/api/window");
            await getCurrentWindow().close();
          } catch {
            /* already closing */
          }
        });
        unlistenWs = await listen<{ id: string }>("workspace:activated", (ev) => {
          if (ev.payload?.id) workspaceId.current = ev.payload.id;
        });
        if (cancelled) {
          unlistenDeleted?.();
          unlistenWs?.();
        }
      } catch {
        /* not in Tauri context */
      }
    })();
    return () => {
      cancelled = true;
      unlistenDeleted?.();
      unlistenWs?.();
    };
  }, [noteId]);

  // OS window close button, browser navigation, page hide → flush first.
  useEffect(() => {
    let unlistenClose: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        unlistenClose = await win.onCloseRequested(async (event) => {
          // If a save is pending, defer the close until persistence completes.
          if (pending.current) {
            event.preventDefault();
            await flushSave();
            // Re-issue the close now that data is safe.
            try {
              await win.close();
            } catch {
              /* already closing */
            }
          }
        });
        if (cancelled && unlistenClose) unlistenClose();
      } catch {
        /* not in Tauri context */
      }
    })();

    const onVisibility = () => {
      if (document.visibilityState === "hidden") void flushSave();
    };
    const onBeforeUnload = () => {
      // Best-effort sync flush — fire-and-forget. The await won't complete
      // before the webview tears down, but the IPC call is already in-flight
      // and Rust will finish handling it.
      void flushSave();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onBeforeUnload);
    return () => {
      cancelled = true;
      if (unlistenClose) unlistenClose();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onBeforeUnload);
      // Final flush on React unmount.
      void flushSave();
    };
  }, [flushSave]);

  async function closeWin() {
    // Persist before tearing down the webview, otherwise the pending
    // debounce dies with the window and the user loses edits.
    await flushSave();
    try {
      const win = (await import("@tauri-apps/api/window")).getCurrentWindow();
      await win.close();
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-amber-50 text-stone-900 font-sans">
      <header
        data-tauri-drag-region
        className="px-3 py-2 flex items-center justify-between bg-amber-200 border-b border-amber-300 cursor-grab active:cursor-grabbing select-none"
        title="Drag to move"
      >
        <span data-tauri-drag-region className="text-stone-700 text-sm leading-none pointer-events-none mr-2">⋮⋮</span>
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            scheduleSave(e.target.value, body);
          }}
          className="bg-transparent text-stone-900 text-sm font-semibold focus:outline-none flex-1 mr-2 placeholder:text-amber-700/50"
          placeholder="Note title…"
          aria-label="Sticky note title"
        />
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMode((m) => (m === "edit" ? "view" : "edit"))}
            className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-amber-300 hover:bg-amber-400 text-stone-900 transition-colors"
            title={mode === "edit" ? "Switch to preview" : "Switch to edit"}
          >
            {mode === "edit" ? "Preview" : "Edit"}
          </button>
          <PinButton className="text-stone-700 hover:text-stone-950" />
          <button
            onClick={closeWin}
            className="text-base leading-none px-1 text-stone-700 hover:text-stone-950"
            title="Close"
          >
            ×
          </button>
        </div>
      </header>

      {mode === "edit" ? (
        <textarea
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            scheduleSave(title, e.target.value);
          }}
          spellCheck={false}
          className="flex-1 bg-transparent text-stone-900 p-3 text-sm font-mono leading-relaxed focus:outline-none resize-none placeholder:text-amber-700/50"
          placeholder="Start typing… Markdown supported, autosaves as you go."
        />
      ) : (
        <div
          className="flex-1 p-3 text-sm text-stone-900 leading-relaxed overflow-auto prose-sticky cursor-text"
          dangerouslySetInnerHTML={{
            __html: body.trim()
              ? renderMarkdown(body)
              : `<p class="text-amber-700/60 italic">Empty note. Double-click to edit.</p>`,
          }}
          onDoubleClick={() => setMode("edit")}
          title="Double-click to edit"
        />
      )}
    </div>
  );
}
