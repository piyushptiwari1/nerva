import { useEffect, useRef, useState } from "react";
import { Reorder, useDragControls } from "framer-motion";
import { ArrowDown, ArrowUp, GripVertical, Trash2 } from "lucide-react";
import { type NoteMeta } from "@/lib/ipc";
import { errorMessage } from "@/lib/errors";

interface NoteListProps {
  notes: NoteMeta[];
  selectedId: string | null;
  onSelect: (id: string) => Promise<void>;
  onDelete: (id: string, title: string) => Promise<void>;
  onReorder: (ids: string[]) => Promise<void>;
}

export function NoteList({ notes, selectedId, onSelect, onDelete, onReorder }: NoteListProps) {
  const [order, setOrder] = useState(() => notes.map((note) => note.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragging = useRef(false);
  const draft = useRef(order);
  const indexed = new Map(notes.map((note) => [note.id, note]));
  const ids = [...order.filter((id) => indexed.has(id)), ...notes.filter((note) => !order.includes(note.id)).map((note) => note.id)];

  useEffect(() => {
    if (!dragging.current) { const ids = notes.map((note) => note.id); setOrder(ids); draft.current = ids; }
  }, [notes]);

  async function commit(next: string[]) {
    dragging.current = false;
    setOrder(next);
    setBusy(true);
    setError(null);
    try { await onReorder(next); }
    catch (failure) { setOrder(notes.map((note) => note.id)); setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }

  function move(index: number, direction: number) {
    const next = [...ids];
    const destination = index + direction;
    if (destination < 0 || destination >= next.length || busy) return;
    [next[index], next[destination]] = [next[destination], next[index]];
    void commit(next);
  }

  return <>
    {error && <p role="alert" className="text-xs text-red-400 py-2">{error}</p>}
    <Reorder.Group axis="y" values={ids} onReorder={(next) => { draft.current = next; setOrder(next); }} aria-label="Workspace notes" className="flex flex-col gap-1">
      {ids.map((id, index) => <NoteRow key={id} note={indexed.get(id)!} selected={id === selectedId} disabled={busy}
        first={index === 0} last={index === ids.length - 1} onSelect={() => void onSelect(id)} onDelete={() => void onDelete(id, indexed.get(id)!.title)}
        onMove={(direction) => move(index, direction)} onDragStart={() => { dragging.current = true; }} onDragEnd={() => void commit(draft.current)} />)}
    </Reorder.Group>
  </>;
}

function NoteRow({ note, selected, disabled, first, last, onSelect, onDelete, onMove, onDragStart, onDragEnd }: {
  note: NoteMeta; selected: boolean; disabled: boolean; first: boolean; last: boolean;
  onSelect: () => void; onDelete: () => void; onMove: (direction: number) => void; onDragStart: () => void; onDragEnd: () => void;
}) {
  const controls = useDragControls();
  const title = note.title || "Untitled";
  return <Reorder.Item value={note.id} dragListener={false} dragControls={controls} onDragStart={onDragStart} onDragEnd={onDragEnd}
    className={`note-order-row relative rounded-md ${selected ? "bg-accent/15 text-accent-glow" : "text-ink-300"}`}>
    <div className="flex items-center min-w-0">
      <button disabled={disabled} className="note-icon touch-none cursor-grab" aria-label={`Reorder ${title}`} title="Drag to reorder"
        onPointerDown={(event) => { if (!disabled) controls.start(event); }}
        onKeyDown={(event) => { if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); onMove(event.key === "ArrowUp" ? -1 : 1); } }}><GripVertical size={16} /></button>
      <button onClick={onSelect} className="flex-1 min-w-0 py-2 text-left text-xs truncate" aria-current={selected ? "true" : undefined} title={title}>{title}</button>
      <button onClick={onDelete} disabled={disabled} className="note-icon text-ink-400 hover:text-red-400" aria-label={`Delete note ${title}`} title="Delete note"><Trash2 size={15} /></button>
    </div>
    {selected && <div className="flex justify-end border-t border-ink-700/40">
      <button disabled={disabled || first} onClick={() => onMove(-1)} className="note-icon" aria-label={`Move ${title} up`} title="Move up"><ArrowUp size={16} /></button>
      <button disabled={disabled || last} onClick={() => onMove(1)} className="note-icon" aria-label={`Move ${title} down`} title="Move down"><ArrowDown size={16} /></button>
    </div>}
  </Reorder.Item>;
}