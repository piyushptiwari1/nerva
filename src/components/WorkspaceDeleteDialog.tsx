import { useEffect, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
import { type Workspace } from "@/lib/ipc";
import { errorMessage } from "@/lib/errors";
import { useApp } from "@/store/app";

export function WorkspaceDeleteDialog({ workspace, onClose }: { workspace: Workspace; onClose: () => void }) {
  const { workspaces, deleteWorkspace } = useApp();
  const destinations = workspaces.filter((candidate) => candidate.id !== workspace.id);
  const [destination, setDestination] = useState(destinations[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => { dialog.current?.showModal(); }, []);

  async function remove() {
    if (!destination || busy) return;
    setBusy(true);
    setError(null);
    try { await deleteWorkspace(workspace.id, destination); onClose(); }
    catch (failure) { setError(errorMessage(failure)); setBusy(false); }
  }

  return (
    <dialog ref={dialog} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }} aria-labelledby="delete-workspace-title"
      className="workspace-delete-dialog m-auto w-[calc(100%-2rem)] max-w-md rounded-lg border border-ink-700 bg-ink-900 text-ink-100 p-5 shadow-xl backdrop:bg-black/50">
      <header className="flex items-start gap-3 mb-4">
        <h2 id="delete-workspace-title" className="flex-1 min-w-0 text-lg font-semibold break-words">Delete workspace</h2>
        <button autoFocus disabled={busy} onClick={onClose} aria-label="Close workspace deletion" title="Close" className="workspace-icon"><X size={20} /></button>
      </header>
      <p className="text-sm break-words mb-4">Delete &quot;{workspace.name}&quot;? Its timers, tasks, notes and habits will move to the selected workspace. History is kept.</p>
      {destinations.length ? <label className="flex flex-col gap-2 text-sm">Move contents to
        <select aria-label="Move workspace contents to" value={destination} onChange={(event) => setDestination(event.target.value)} disabled={busy}
          className="w-full min-w-0 rounded-md border border-ink-600 bg-ink-800 p-3">
          {destinations.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
        </select>
      </label> : <p role="status" className="text-sm text-ink-400">At least one workspace must remain.</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
      <footer className="flex flex-wrap justify-end gap-2 mt-6">
        <button disabled={busy} onClick={onClose} className="px-4 min-h-12 rounded-md border border-ink-600 text-sm">Cancel</button>
        <button disabled={busy || !destination} onClick={() => void remove()}
          className="flex items-center justify-center gap-2 px-4 min-h-12 rounded-md bg-red-700 text-white text-sm disabled:opacity-40">
          <Trash2 size={17} />{busy ? "Moving contents..." : "Move and delete"}
        </button>
      </footer>
    </dialog>
  );
}