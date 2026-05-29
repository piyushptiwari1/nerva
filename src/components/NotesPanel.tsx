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
  // Mirrors the latest in-flight edit so flushSave() can persist without
  // racing React's state updater on unmount.
  const pending = useRef<{ title: string; body: string } | null>(null);
  // Hold onto the currently loaded note id without going through React state,
  // so the popout `note:saved` listener can ignore events for other notes.
  const currentIdRef = useRef<string | null>(null);

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
    try {
      const n = await ipc.noteGet(id);
      if (n) {
        setCurrentId(n.id);
        currentIdRef.current = n.id;
        setTitle(n.title || "Untitled");
        setBody(n.body);
      } else {
        // Note was deleted (e.g. on another device, or by reset). Drop the
        // stale pointer and fall back to a blank scratchpad rather than
        // displaying a half-loaded ghost note.
        setCurrentId(null);
        currentIdRef.current = null;
        setTitle("Untitled");
        setBody("");
      }
    } catch (e) {
      console.warn("[NotesPanel] loadNote failed:", e);
    }
  }

  /**
   * Permanently delete a note. Confirms first because there's no undo —
   * the backend hard-deletes the row and cascades the FTS5 + embedding
   * cleanup. Cross-window listeners (sticky popout on the same note) get
   * notified via the `note:deleted` Tauri event emitted server-side.
   */
  async function deleteNote(id: string, titleHint: string) {
    const label = titleHint?.trim() || "this note";
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete "${label}"? This cannot be undone.`)) return;
    try {
      // Cancel any pending autosave for this id so we don't resurrect it.
      if (currentIdRef.current === id && saveTimer.current) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
        pending.current = null;
      }
      await ipc.noteDelete(id);
      // If the deleted note is the one currently open, reset the editor.
      if (currentIdRef.current === id) {
        setCurrentId(null);
        currentIdRef.current = null;
        setTitle("Untitled");
        setBody("");
      }
      refreshNotes();
    } catch (e) {
      console.warn("[NotesPanel] deleteNote failed:", e);
      // eslint-disable-next-line no-alert
      window.alert(`Could not delete note: ${e}`);
    }
  }

  // Listen for cross-window note saves (sticky popout edited the same note)
  // and refresh the editor + list. Also flush our own pending edits on
  // visibility-hidden / beforeunload so closing the main window doesn't drop
  // the last keystroke.
  useEffect(() => {
    let unlistenSaved: (() => void) | undefined;
    let unlistenDeleted: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlistenSaved = await listen<{ id: string }>("note:saved", async (ev) => {
          const id = ev.payload?.id;
          if (!id) return;
          // Refresh the sidebar list regardless of which note changed.
          refreshNotes();
          // If the changed note is the one we're editing, reload it — but
          // *only* if there's no local pending edit, otherwise we'd clobber
          // the user's in-flight typing.
          if (id === currentIdRef.current && !pending.current) {
            try {
              const n = await ipc.noteGet(id);
              if (n) {
                setTitle(n.title || "Untitled");
                setBody(n.body);
              }
            } catch {
              /* ignore */
            }
          }
        });
        unlistenDeleted = await listen<{ id: string }>("note:deleted", (ev) => {
          const id = ev.payload?.id;
          if (!id) return;
          // Drop the open editor if it pointed at the now-gone note, and
          // refresh the sidebar so the deleted row disappears.
          if (currentIdRef.current === id) {
            // Cancel any pending save so we don't recreate it.
            if (saveTimer.current) {
              window.clearTimeout(saveTimer.current);
              saveTimer.current = null;
            }
            pending.current = null;
            setCurrentId(null);
            currentIdRef.current = null;
            setTitle("Untitled");
            setBody("");
          }
          refreshNotes();
        });
        if (cancelled) {
          unlistenSaved?.();
          unlistenDeleted?.();
        }
      } catch {
        /* not in Tauri context */
      }
    })();

    const flushSync = () => {
      if (!pending.current || !saveTimer.current) return;
      // Cancel the debounce timer and fire the IPC immediately. We can't
      // await here (beforeunload doesn't wait for async), but the call is
      // in-flight before the webview tears down.
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
      const p = pending.current;
      pending.current = null;
      void ipc.noteSave({
        id: currentIdRef.current ?? undefined,
        title: p.title || "Untitled",
        body: p.body,
        workspace_id: active?.id,
      });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushSync();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", flushSync);
    window.addEventListener("pagehide", flushSync);
    return () => {
      cancelled = true;
      if (unlistenSaved) unlistenSaved();
      if (unlistenDeleted) unlistenDeleted();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", flushSync);
      window.removeEventListener("pagehide", flushSync);
      flushSync();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  function scheduleSave(nextTitle: string, nextBody: string) {
    pending.current = { title: nextTitle, body: nextBody };
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      saveTimer.current = null;
      try {
        const saved = await ipc.noteSave({
          id: currentId ?? undefined,
          title: nextTitle || "Untitled",
          body: nextBody,
          workspace_id: active?.id,
        });
        // Successful persist — clear pending so cross-window refresh can
        // re-fetch without fearing it'll clobber local edits.
        pending.current = null;
        setCurrentId(saved.id);
        currentIdRef.current = saved.id;
        setSavedAt(Date.now());
        refreshNotes();
        // Tell any other window (sticky popout on the same note) to refresh.
        try {
          const { emit } = await import("@tauri-apps/api/event");
          await emit("note:saved", { id: saved.id });
        } catch {
          /* event bus unavailable */
        }
      } catch (e) {
        console.error("[NotesPanel] save failed:", e);
      }
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
                    <div
                      key={n.id}
                      className={`group flex items-center gap-1 rounded-md hover:bg-ink-800/60 ${
                        n.id === currentId ? "text-ink-100" : "text-ink-300"
                      }`}
                    >
                      <button
                        onClick={() => loadNote(n.id)}
                        className="flex-1 min-w-0 text-left text-xs px-2 py-1 truncate"
                        title={n.title || "Untitled"}
                      >
                        {n.title || "Untitled"}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteNote(n.id, n.title || "Untitled");
                        }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] px-1.5 py-1 text-ink-400 hover:text-red-300"
                        title="Delete note"
                        aria-label={`Delete note ${n.title || "Untitled"}`}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </>
      )}
    </aside>
  );
}
