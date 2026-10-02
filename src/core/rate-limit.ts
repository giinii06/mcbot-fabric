/**
 * Small in-memory sliding window rate limiter (5-10s between API backed
 * operations such as identity lookups and registration commands).
 */
export interface RateLimiter {
  /** Returns true when the call is allowed and records it. */
  hit(key: string): boolean;
  /** Seconds the caller must wait before the next hit is allowed. */
  retryAfterSeconds(key: string): number;
  reset(key?: string): void;
}

export function createRateLimiter(limit: number, windowMs: number, now: () => number = Date.now): RateLimiter {
  const hits = new Map<string, number[]>();

  const prune = (key: string, at: number): number[] => {
    const list = (hits.get(key) ?? []).filter((t) => at - t < windowMs);
    hits.set(key, list);
    return list;
  };

  return {
    hit(key) {
      const at = now();
      const list = prune(key, at);
      if (list.length >= limit) return false;
      list.push(at);
      return true;
    },
    retryAfterSeconds(key) {
      const at = now();
      const list = prune(key, at);
      if (list.length < limit) return 0;
      const oldest = list[0] ?? at;
      return Math.max(1, Math.ceil((oldest + windowMs - at) / 1000));
    },
    reset(key) {
      if (key === undefined) hits.clear();
      else hits.delete(key);
    },
  };
}

/** Fire-and-forget timeout wrapper for outbound HTTP (short, bounded). */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
