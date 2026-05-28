import { useEffect, useRef, useState } from "react";
import { ipc, type Note } from "@/lib/ipc";
import { renderMarkdown } from "@/lib/markdown";
import { PinButton } from "./PinButton";

/**
 * Always-on-top sticky-note view. Opened via the `open_sticky` IPC command —
 * the parent window passes the note id as the `?sticky=<id>` query param.
 * The whole webview is draggable so the user can position it anywhere on screen.
 */
export function StickyNote({ noteId }: { noteId: string }) {
  const [note, setNote] = useState<Note | null>(null);
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<"edit" | "view">("view");
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    ipc.noteGet(noteId).then((n) => {
      if (!alive || !n) return;
      setNote(n);
      setTitle(n.title);
      setBody(n.body);
    });
    return () => {
      alive = false;
    };
  }, [noteId]);

  function scheduleSave(nextTitle: string, nextBody: string) {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      const saved = await ipc.noteSave({
        id: noteId,
        title: nextTitle || "Untitled",
        body: nextBody,
        workspace_id: note?.workspace_id || undefined,
      });
      setNote(saved);
    }, 250);
  }

  async function closeWin() {
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
          placeholder="Untitled note"
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
