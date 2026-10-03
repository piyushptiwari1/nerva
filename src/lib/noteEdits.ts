const flushers = new Set<() => Promise<void>>();

export function registerNoteFlusher(flush: () => Promise<void>): () => void {
  flushers.add(flush);
  return () => { flushers.delete(flush); };
}

export async function flushNoteEdits(): Promise<void> {
  await Promise.all([...flushers].map((flush) => flush()));
}