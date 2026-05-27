import { useEffect, useRef, useState } from "react";
import { ipc, type Note } from "@/lib/ipc";
import { renderMarkdown } from "@/lib/markdown";

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

  return (
    <div className="h-screen w-screen flex flex-col bg-amber-50 text-ink-950 font-sans">
      <header
        data-tauri-drag-region
        className="px-3 py-2 flex items-center justify-between bg-amber-100 border-b border-amber-200 cursor-move select-none"
      >
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            scheduleSave(e.target.value, body);
          }}
          className="bg-transparent text-sm font-semibold focus:outline-none flex-1 mr-2"
          placeholder="Sticky"
        />
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMode((m) => (m === "edit" ? "view" : "edit"))}
            className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-amber-200 hover:bg-amber-300"
          >
            {mode === "edit" ? "View" : "Edit"}
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
          className="flex-1 bg-transparent p-3 text-sm font-mono leading-relaxed focus:outline-none resize-none"
          placeholder="Markdown welcome."
        />
      ) : (
        <div
          className="flex-1 p-3 text-sm leading-relaxed overflow-auto prose-sticky"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }}
          onDoubleClick={() => setMode("edit")}
        />
      )}
    </div>
  );
}
