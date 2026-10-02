/**
 * Bounded event de-duplication cache (eventId -> expiry). Keeps a bridge
 * retry from producing a second Discord embed.
 */
export interface DedupCache {
  /** Returns true when the id is new (and records it). */
  seen(eventId: string): boolean;
  /** Returns true when the id is already recorded. Does not record. */
  has(eventId: string): boolean;
  size(): number;
  clear(): void;
}

export function createDedupCache(ttlMs: number, now: () => number = Date.now): DedupCache {
  const entries = new Map<string, number>();

  const sweep = (at: number): void => {
    if (entries.size === 0) return;
    for (const [id, expiresAt] of entries) {
      if (expiresAt <= at) entries.delete(id);
    }
  };

  return {
    has(eventId) {
      const at = now();
      sweep(at);
      const expires = entries.get(eventId);
      return expires !== undefined && expires > at;
    },
    seen(eventId) {
      const at = now();
      sweep(at);
      const expires = entries.get(eventId);
      if (expires !== undefined && expires > at) return false;
      entries.set(eventId, at + ttlMs);
      if (entries.size > 5000) {
        // hard bound: drop the oldest half so a runaway loop cannot grow memory
        const keys = [...entries.keys()].slice(0, Math.floor(entries.size / 2));
        for (const k of keys) entries.delete(k);
      }
      return true;
    },
    size() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
  };
}
