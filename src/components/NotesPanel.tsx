import { useEffect, useRef, useState } from "react";
import { ipc } from "@/lib/ipc";
import { useApp } from "@/store/app";

/**
 * Persistent notes panel — autosaves on every keystroke (debounced 250ms).
 * Always editable; the active note is the most-recent one for the active
 * workspace (a "scratchpad" model). New notes are created on demand.
 */
export function NotesPanel() {
  const { notes, active, refreshNotes } = useApp();
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const saveTimer = useRef<number | null>(null);

  // pick most-recent note for the active workspace on workspace change
  useEffect(() => {
    const wsNotes = notes.filter((n) => n.workspace_id === active?.id);
    const pick = wsNotes[0] ?? null;
    if (pick && pick.id !== currentId) {
      loadNote(pick.id);
    } else if (!pick) {
      // fresh scratchpad
      setCurrentId(null);
      setTitle("Scratchpad");
      setBody("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  async function loadNote(id: string) {
    const n = await ipc.noteGet(id);
    if (n) {
      setCurrentId(n.id);
      setTitle(n.title || "Untitled");
      setBody(n.body);
    }
  }

  function scheduleSave(nextTitle: string, nextBody: string) {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      const saved = await ipc.noteSave({
        id: currentId ?? undefined,
        title: nextTitle || "Untitled",
        body: nextBody,
        workspace_id: active?.id,
      });
      setCurrentId(saved.id);
      setSavedAt(Date.now());
      refreshNotes();
    }, 250);
  }

  async function newNote() {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    setCurrentId(null);
    setTitle("New note");
    setBody("");
  }

  return (
    <aside className="glass rounded-xl flex flex-col min-h-0">
      <header className="flex items-center justify-between p-3 border-b border-ink-700/40">
        <div className="flex flex-col">
          <h3 className="text-[11px] uppercase tracking-wider text-ink-400">
            Persistent notes
          </h3>
          <span className="text-[10px] text-ink-500 mt-0.5">
            {savedAt ? `Saved · ${new Date(savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Autosaves every keystroke"}
          </span>
        </div>
        <button
          onClick={newNote}
          className="text-xs px-2 py-1 rounded-md hairline hover:bg-ink-700"
        >
          + New
        </button>
      </header>

      <input
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          scheduleSave(e.target.value, body);
        }}
        className="bg-transparent px-3 py-2 text-sm font-medium border-b border-ink-700/40 focus:outline-none"
        placeholder="Title"
      />

      <textarea
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          scheduleSave(title, e.target.value);
        }}
        spellCheck={false}
        className="flex-1 bg-transparent px-3 py-3 text-sm font-mono leading-relaxed focus:outline-none min-h-0"
        placeholder="Brain dump. Markdown welcome. Cursor and content survive reboot."
      />

      {notes.length > 0 && (
        <div className="border-t border-ink-700/40 max-h-32 overflow-auto p-2">
          <h4 className="text-[10px] uppercase tracking-wider text-ink-500 px-1 mb-1">
            Recent
          </h4>
          <div className="flex flex-col">
            {notes
              .filter((n) => !active || n.workspace_id === active.id)
              .slice(0, 8)
              .map((n) => (
                <button
                  key={n.id}
                  onClick={() => loadNote(n.id)}
                  className={`text-left text-xs px-2 py-1 rounded-md hover:bg-ink-800/60 truncate ${
                    n.id === currentId ? "text-ink-100" : "text-ink-300"
                  }`}
                >
                  {n.title || "Untitled"}
                </button>
              ))}
          </div>
        </div>
      )}
    </aside>
  );
}
