import { useEffect, useRef, useState } from "react";
import { ipc, type NoteSearchHit, type SemanticHit } from "@/lib/ipc";
import { useApp } from "@/store/app";
import { renderMarkdown } from "@/lib/markdown";

type Mode = "edit" | "view";

/**
 * Persistent notes panel — autosaves on every keystroke (debounced 250ms),
 * renders Markdown in view mode, and supports FTS5 search + an always-on-top
 * sticky-note window for the current note.
 */
export function NotesPanel() {
  const { notes, active, refreshNotes, lastNoteFor } = useApp();
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>("edit");
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<NoteSearchHit[]>([]);
  // Semantic neighbours computed in parallel with the FTS query. The Ollama
  // call can be slow on first run, so we keep them in a separate list and
  // render them under the FTS hits with a quiet header — users get keyword
  // matches instantly and similarity matches when the embed call returns.
  const [semHits, setSemHits] = useState<SemanticHit[]>([]);
  const saveTimer = useRef<number | null>(null);
  const searchTimer = useRef<number | null>(null);

  // On workspace change: try resume last-edited note, else most-recent, else fresh.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    (async () => {
      const lastId = await lastNoteFor(active.id);
      if (cancelled) return;
      if (lastId) {
        await loadNote(lastId);
        return;
      }
      const wsNotes = notes.filter((n) => n.workspace_id === active.id);
      const pick = wsNotes[0] ?? null;
      if (pick) {
        await loadNote(pick.id);
      } else {
        setCurrentId(null);
        setTitle("Scratchpad");
        setBody("");
      }
    })();
    return () => {
      cancelled = true;
    };
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
    setMode("edit");
  }

  function onSearch(q: string) {
    setSearch(q);
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    if (!q.trim()) {
      setHits([]);
      setSemHits([]);
      return;
    }
    searchTimer.current = window.setTimeout(async () => {
      // Fire both lookups in parallel — FTS will almost always answer first
      // (in-process SQLite), semantic depends on Ollama latency. Promise.all
      // is fine because we don't want one to block the other's render.
      const [fts, sem] = await Promise.allSettled([
        ipc.noteSearch(q, 10),
        ipc.noteSemanticSearch(q, 5),
      ]);
      setHits(fts.status === "fulfilled" ? fts.value : []);
      // Filter out near-zero similarities + dedup against FTS to avoid
      // showing the same note in both buckets.
      const ftsIds = new Set(fts.status === "fulfilled" ? fts.value.map((h) => h.id) : []);
      const semFiltered = sem.status === "fulfilled"
        ? sem.value.filter((h) => h.score > 0.35 && !ftsIds.has(h.id))
        : [];
      setSemHits(semFiltered);
    }, 150);
  }

  async function popSticky() {
    if (!currentId) return;
    try {
      await ipc.openSticky(currentId);
    } catch (e) {
      console.error("open sticky", e);
    }
  }

  return (
    <aside className="glass rounded-xl flex flex-col min-h-0">
      <header className="flex items-center justify-between p-3 border-b border-ink-700/40 gap-2">
        <div className="flex flex-col min-w-0">
          <h3 className="text-[11px] uppercase tracking-wider text-ink-400">
            Persistent notes
          </h3>
          <span className="text-[10px] text-ink-500 mt-0.5 truncate">
            {savedAt
              ? `Saved · ${new Date(savedAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}`
              : "Autosaves every keystroke"}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setMode((m) => (m === "edit" ? "view" : "edit"))}
            className="text-[10px] uppercase tracking-wider px-2 py-1 rounded-md hairline hover:bg-ink-700"
            title="Toggle Markdown preview"
          >
            {mode === "edit" ? "View" : "Edit"}
          </button>
          <button
            onClick={popSticky}
            disabled={!currentId}
            className="text-[10px] uppercase tracking-wider px-2 py-1 rounded-md hairline hover:bg-ink-700 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Open this note as an always-on-top sticky window"
          >
            Pop up
          </button>
          <button
            onClick={newNote}
            className="text-xs px-2 py-1 rounded-md hairline hover:bg-ink-700"
          >
            + New
          </button>
        </div>
      </header>

      <div className="px-3 py-2 border-b border-ink-700/40">
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search notes…"
          className="w-full bg-ink-800/60 hairline rounded-md px-2 py-1 text-xs focus:outline-none focus:border-accent/50"
        />
      </div>

      {hits.length > 0 || semHits.length > 0 ? (
        <div className="flex-1 overflow-auto p-2 flex flex-col gap-1 min-h-0">
          {hits.map((h) => (
            <button
              key={h.id}
              onClick={() => {
                loadNote(h.id);
                setSearch("");
                setHits([]);
                setSemHits([]);
              }}
              className="text-left px-2 py-2 rounded-md hover:bg-ink-800/60"
            >
              <div className="text-xs font-medium text-ink-100 truncate">
                {h.title || "Untitled"}
              </div>
              <div
                className="text-[11px] text-ink-400 mt-0.5 line-clamp-2 leading-snug"
                dangerouslySetInnerHTML={{ __html: h.snippet }}
              />
            </button>
          ))}
          {semHits.length > 0 && (
            <>
              <div className="text-[10px] uppercase tracking-wider text-ink-500 px-2 mt-2">
                Similar by meaning
              </div>
              {semHits.map((h) => (
                <button
                  key={`sem-${h.id}`}
                  onClick={() => {
                    loadNote(h.id);
                    setSearch("");
                    setHits([]);
                    setSemHits([]);
                  }}
                  className="text-left px-2 py-1.5 rounded-md hover:bg-ink-800/60"
                >
                  <div className="text-xs font-medium text-ink-100 truncate">
                    {h.title || "Untitled"}
                  </div>
                  <div className="text-[10px] text-ink-500">
                    similarity {(h.score * 100).toFixed(0)}%
                  </div>
                </button>
              ))}
            </>
          )}
        </div>
      ) : (
        <>
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              scheduleSave(e.target.value, body);
            }}
            className="bg-transparent px-3 py-2 text-sm font-medium border-b border-ink-700/40 focus:outline-none"
            placeholder="Title"
          />

          {mode === "edit" ? (
            <textarea
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                scheduleSave(title, e.target.value);
              }}
              spellCheck={false}
              className="flex-1 bg-transparent px-3 py-3 text-sm font-mono leading-relaxed focus:outline-none min-h-0 resize-none"
              placeholder="Start writing… your words save themselves. Markdown works — # headings, **bold**, - lists, `code`."
            />
          ) : (
            <div
              className="flex-1 overflow-auto px-3 py-3 text-sm leading-relaxed min-h-0 prose-nerva"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }}
              onDoubleClick={() => setMode("edit")}
            />
          )}

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
        </>
      )}
    </aside>
  );
}
