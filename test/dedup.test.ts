import { describe, expect, test } from "bun:test";
import { createDedupCache } from "../src/bridge/dedup";

describe("createDedupCache", () => {
  test("first sight is new, second is not", () => {
    const cache = createDedupCache(60_000, () => 1_000);
    expect(cache.seen("event-1")).toBe(true);
    expect(cache.seen("event-1")).toBe(false);
    expect(cache.seen("event-2")).toBe(true);
    expect(cache.size()).toBe(2);
  });

  test("has checks without recording", () => {
    const cache = createDedupCache(60_000, () => 1_000);
    expect(cache.has("event-1")).toBe(false);
    expect(cache.size()).toBe(0);
    expect(cache.seen("event-1")).toBe(true);
    expect(cache.has("event-1")).toBe(true);
    expect(cache.size()).toBe(1);
  });

  test("expires after the ttl", () => {
    let now = 1_000;
    const cache = createDedupCache(1_000, () => now);
    expect(cache.seen("event-1")).toBe(true);
    now += 999;
    expect(cache.seen("event-1")).toBe(false);
    now += 2;
    expect(cache.seen("event-1")).toBe(true);
  });

  test("is bounded even when ids never repeat", () => {
    const cache = createDedupCache(60_000, () => 1_000);
    for (let i = 0; i < 5_200; i++) {
      cache.seen(`event-${i}`);
    }
    expect(cache.size()).toBeLessThanOrEqual(5_200);
    expect(cache.size()).toBeLessThan(5_200);
  });

  test("clear empties the cache", () => {
    const cache = createDedupCache(60_000, () => 1_000);
    cache.seen("a");
    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.seen("a")).toBe(true);
  });
});
