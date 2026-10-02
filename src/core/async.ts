/** Runs `fn` over `items` with at most `limit` concurrent promises. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Math.max(1, Math.min(limit, items.length || 1));

  const run = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index] as T, index);
    }
  };

  await Promise.all(Array.from({ length: workers }, () => run()));
  return results;
}

/** Bounded FIFO queue: rejects the oldest entry when the cap is reached. */
export function createBoundedQueue(capacity: number): {
  size(): number;
  push<T>(job: T): boolean;
  shift<T>(): T | undefined;
} {
  const items: unknown[] = [];
  return {
    size: () => items.length,
    push(job) {
      if (items.length >= capacity) return false;
      items.push(job);
      return true;
    },
    shift() {
      return items.shift() as never;
    },
  };
}
