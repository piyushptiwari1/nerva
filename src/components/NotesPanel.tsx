import { useEffect, useRef, useState } from "react";
import { ipc, type NoteSearchHit, type SemanticHit } from "@/lib/ipc";
import { useApp } from "@/store/app";
import { renderMarkdown } from "@/lib/markdown";
import { isMobile } from "@/lib/platform";
import { inWorkspace } from "@/lib/workspaces";
import { errorMessage } from "@/lib/errors";
import { registerNoteFlusher } from "@/lib/noteEdits";
import { NoteList } from "@/components/NoteList";

type Mode = "edit" | "view";

/**
 * Resolve this webview's Tauri window label once. Used to tag outgoing
 * `note:saved` events so listeners can ignore their own echoes — Tauri
 * `emit` broadcasts to every window *including the sender*, and reacting to
 * our own save is what used to clobber in-flight keystrokes (the controlled
 * textarea reset its value mid-typing, dropping letters and jumping the
 * cursor to the end).
 */
async function windowLabel(): Promise<string> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow().label;
  } catch {
    return "main";
  }
}

/**
 * Persistent notes panel — autosaves on every keystroke (debounced 250ms),
 * renders Markdown in view mode, and supports FTS5 search + an always-on-top
 * sticky-note window for the current note.
 */
export function NotesPanel() {
  const workspaceId = useApp((state) => state.active?.id ?? null);
  return <WorkspaceNotesPanel key={workspaceId ?? "unassigned"} workspaceId={workspaceId} />;
}

function WorkspaceNotesPanel({ workspaceId }: { workspaceId: string | null }) {
  const { notes, refreshNotes, lastNoteFor } = useApp();
  const active = workspaceId ? { id: workspaceId } : null;
  const workspaceNotes = notes.filter((note) => inWorkspace(note, workspaceId));
  const [error, setError] = useState<string | null>(null);
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
  const pending = useRef<{ id: string; title: string; body: string; workspace_id?: string } | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saving = useRef(0);
  const mounted = useRef(true);
  const loadRevision = useRef(0);
  const searchRevision = useRef(0);
  // Hold onto the currently loaded note id without going through React state,
  // so the popup `note:saved` listener can ignore events for other notes.
  const currentIdRef = useRef<string | null>(null);
  // Title <input> ref so "+ New" can move focus straight to it.
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    mounted.current = true;
    const unregister = registerNoteFlusher(flushSave);
    return () => {
      mounted.current = false;
      loadRevision.current += 1;
      searchRevision.current += 1;
      unregister();
      if (searchTimer.current) window.clearTimeout(searchTimer.current);
      void flushSave().catch(console.error);
    };
  }, []);

  // On workspace change: try resume last-edited note, else most-recent, else fresh.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    (async () => {
      const lastId = await lastNoteFor(active.id);
      if (cancelled) return;
      if (lastId && workspaceNotes.some((note) => note.id === lastId)) {
        await loadNote(lastId);
        return;
      }
      const wsNotes = notes.filter((n) => n.workspace_id === active.id);
      const pick = wsNotes[0] ?? null;
      if (pick) {
        await loadNote(pick.id);
      } else {
        // Blank slate — empty title lets the input placeholder show through
        // so the user isn't forced to delete filler text before typing.
        setCurrentId(null);
        currentIdRef.current = null;
        setTitle("");
        setBody("");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  async function loadNote(id: string) {
    const revision = ++loadRevision.current;
    try {
      await flushSave();
      const n = await ipc.noteGet(id);
      if (!mounted.current || revision !== loadRevision.current) return;
      if (n && inWorkspace(n, workspaceId)) {
        setCurrentId(n.id);
        currentIdRef.current = n.id;
        // Show whatever the backend has. Empty string surfaces the input
        // placeholder; the backend auto-titles on save anyway (v0.1.5+).
        setTitle(n.title ?? "");
        setBody(n.body);
        setSavedAt(n.updated_ms);
      } else {
        // Note was deleted (e.g. on another device, or by reset). Drop the
        // stale pointer and fall back to a blank slate rather than
        // displaying a half-loaded ghost note.
        setCurrentId(null);
        currentIdRef.current = null;
        setTitle("");
        setBody("");
      }
    } catch (e) {
      if (mounted.current) setError(errorMessage(e));
    }
  }

  /**
   * Permanently delete a note. Confirms first because there's no undo —
   * the backend hard-deletes the row and cascades the FTS5 + embedding
   * cleanup. Cross-window listeners (sticky popup on the same note) get
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
      await saveQueue.current.catch(() => undefined);
      await ipc.noteDelete(id);
      // If the deleted note is the one currently open, reset the editor.
      if (currentIdRef.current === id) {
        setCurrentId(null);
        currentIdRef.current = null;
        setTitle("");
        setBody("");
      }
      refreshNotes();
    } catch (e) {
      console.warn("[NotesPanel] deleteNote failed:", e);
      // eslint-disable-next-line no-alert
      window.alert(`Could not delete note: ${e}`);
    }
  }

  // Listen for cross-window note saves (sticky popup edited the same note)
  // and refresh the editor + list. Also flush our own pending edits on
  // visibility-hidden / beforeunload so closing the main window doesn't drop
  // the last keystroke.
  useEffect(() => {
    let unlistenSaved: (() => void) | undefined;
    let unlistenDeleted: (() => void) | undefined;
    let unlistenReordered: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const me = await windowLabel();
        const { listen } = await import("@tauri-apps/api/event");
        unlistenSaved = await listen<{ id: string; src?: string }>("note:saved", async (ev) => {
          const id = ev.payload?.id;
          if (!id) return;
          // Our own save event — the list is already refreshed by the save
          // path and re-fetching would race the user's next keystrokes.
          if (ev.payload?.src === me) return;
          // Refresh the sidebar list regardless of which note changed.
          refreshNotes();
          // If the changed note is the one we're editing, reload it — but
          // *only* if there's no local pending edit, otherwise we'd clobber
          // the user's in-flight typing.
          if (id === currentIdRef.current && !pending.current && saving.current === 0) {
            try {
              const n = await ipc.noteGet(id);
              // Re-check after the await: a keystroke may have landed while
              // the fetch was in flight. Never overwrite live edits, and
              // skip no-op state sets so the textarea keeps its cursor.
              if (n && id === currentIdRef.current && !pending.current && saving.current === 0) {
                setTitle((prev) => (prev === (n.title ?? "") ? prev : n.title ?? ""));
                setBody((prev) => (prev === n.body ? prev : n.body));
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
            setTitle("");
            setBody("");
          }
          refreshNotes();
        });
        unlistenReordered = await listen("note:reordered", () => { void refreshNotes(); });
        if (cancelled) {
          unlistenSaved?.();
          unlistenDeleted?.();
          unlistenReordered?.();
        }
      } catch {
        /* not in Tauri context */
      }
    })();

    const flushSync = () => {
      void flushSave().catch(console.error);
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
      if (unlistenReordered) unlistenReordered();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", flushSync);
      window.removeEventListener("pagehide", flushSync);
      flushSync();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  function scheduleSave(nextTitle: string, nextBody: string) {
    loadRevision.current += 1;
    const id = currentIdRef.current ?? crypto.randomUUID();
    currentIdRef.current = id;
    setCurrentId(id);
    pending.current = { id, title: nextTitle, body: nextBody, workspace_id: workspaceId ?? undefined };
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { void flushSave().catch(console.error); }, 250);
  }

  async function flushSave(): Promise<void> {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const draft = pending.current;
    if (!draft) {
      const queued = saveQueue.current;
      await queued;
      if (pending.current || saveQueue.current !== queued) await flushSave();
      return;
    }
    pending.current = null;
    saving.current += 1;
    const operation = saveQueue.current.catch(() => undefined).then(async () => {
      const saved = await ipc.noteSave(draft);
      if (mounted.current && currentIdRef.current === saved.id && !pending.current) {
        setSavedAt(saved.updated_ms);
        setError(null);
      }
      await refreshNotes();
      try {
        const { emit } = await import("@tauri-apps/api/event");
        await emit("note:saved", { id: saved.id, src: await windowLabel() });
      } catch {}
    });
    saveQueue.current = operation;
    try { await operation; }
    catch (failure) {
      if (mounted.current) {
        if (!pending.current && currentIdRef.current === draft.id) pending.current = draft;
        setError(errorMessage(failure));
      }
      throw failure;
    }
    finally { saving.current -= 1; }
    if (pending.current || saveQueue.current !== operation) await flushSave();
  }

  async function newNote() {
    try { await flushSave(); } catch { return; }
    loadRevision.current += 1;
    setCurrentId(null);
    currentIdRef.current = null;
    setSavedAt(null);
    // Empty title + empty body — placeholders explain what to do.
    // The user doesn't need to delete filler text before they can type.
    setTitle("");
    setBody("");
    setMode("edit");
    // Focus the title input on the next paint so the user can start typing.
    queueMicrotask(() => {
      try {
        titleInputRef.current?.focus();
      } catch {
        /* ref not mounted yet — harmless */
      }
    });
  }

  function onSearch(q: string) {
    const revision = ++searchRevision.current;
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
      if (!mounted.current || revision !== searchRevision.current) return;
      setHits(fts.status === "fulfilled" ? fts.value.filter((hit) => inWorkspace(hit, workspaceId)) : []);
      // Filter out near-zero similarities + dedup against FTS to avoid
      // showing the same note in both buckets.
      const ftsIds = new Set(fts.status === "fulfilled" ? fts.value.map((h) => h.id) : []);
      const semFiltered = sem.status === "fulfilled"
        ? sem.value.filter((h) => inWorkspace(h, workspaceId) && h.score > 0.35 && !ftsIds.has(h.id))
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
      {error && <p role="alert" className="px-3 py-2 text-sm text-red-400">{error}</p>}
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
              : "Not saved yet"}
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
          {!isMobile() && (
            <button
              onClick={popSticky}
              disabled={!currentId}
              className="text-[10px] uppercase tracking-wider px-2 py-1 rounded-md hairline hover:bg-ink-700 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Open this note in a floating sticky window"
            >
              Pop up
            </button>
          )}
          <button
            onClick={newNote}
            className="text-xs font-semibold px-2.5 py-1 rounded-md bg-accent text-ink-950 hover:bg-accent-glow shadow-glow transition-colors"
            title="Create a new note (starts blank)"
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
            ref={titleInputRef}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              scheduleSave(e.target.value, body);
            }}
            onFocus={(e) => e.currentTarget.select()}
            className="bg-transparent px-3 py-2 text-sm font-medium border-b border-ink-700/40 focus:outline-none placeholder:text-ink-500"
            placeholder="Note title — leave blank for an auto-timestamp"
            aria-label="Note title"
          />

          {mode === "edit" ? (
            <textarea
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                scheduleSave(title, e.target.value);
              }}
              spellCheck={false}
              className="flex-1 bg-transparent px-3 py-3 text-sm font-mono leading-relaxed focus:outline-none min-h-0 resize-none placeholder:text-ink-500"
              placeholder="Write a note..."
              aria-label="Note body"
            />
          ) : (
            <div
              className="flex-1 overflow-auto px-3 py-3 text-sm leading-relaxed min-h-0 prose-nerva"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }}
              onDoubleClick={() => setMode("edit")}
            />
          )}

          {workspaceNotes.length > 0 && (
            <div className="shrink-0 border-t border-ink-700/70 max-h-56 overflow-auto p-2">
              <div className="flex items-center justify-between px-1 mb-1.5">
                <h4 className="text-[10px] uppercase tracking-wider text-ink-400 font-semibold">
                  Workspace notes
                </h4>
                <span className="text-[10px] text-ink-500 tnum">
                  {workspaceNotes.length}
                </span>
              </div>
              <NoteList notes={workspaceNotes} selectedId={currentId} onSelect={loadNote} onDelete={deleteNote}
                onReorder={async (ids) => {
                  if (!workspaceId) return;
                  await flushSave();
                  useApp.setState({ notes: await ipc.noteReorder(workspaceId, ids) });
                }} />
            </div>
          )}
        </>
      )}
    </aside>
  );
}
