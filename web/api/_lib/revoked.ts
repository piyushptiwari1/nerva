// Revocation list: licenses/revoked.json in the metrics repo — a JSON array
// of txnids. Cached 5 minutes per edge isolate.

import { readJson } from "./metrics";

let cache: { at: number; ids: Set<string> } | null = null;

export async function isRevoked(txnid: string): Promise<boolean> {
  if (!cache || Date.now() - cache.at > 5 * 60_000) {
    const doc = await readJson<string[]>("licenses/revoked.json");
    cache = { at: Date.now(), ids: new Set(doc?.data ?? []) };
  }
  return cache.ids.has(txnid);
}
