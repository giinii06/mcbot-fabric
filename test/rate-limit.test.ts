import { describe, expect, test } from "bun:test";
import { createRateLimiter, withTimeout } from "../src/core/rate-limit";

describe("createRateLimiter", () => {
  test("allows up to the limit inside the window", () => {
    let now = 1000;
    const limiter = createRateLimiter(4, 6_000, () => now);
    expect(limiter.hit("u1")).toBe(true);
    expect(limiter.hit("u1")).toBe(true);
    expect(limiter.hit("u1")).toBe(true);
    expect(limiter.hit("u1")).toBe(true);
    expect(limiter.hit("u1")).toBe(false);
    expect(limiter.retryAfterSeconds("u1")).toBeGreaterThan(0);
    expect(limiter.retryAfterSeconds("u1")).toBeLessThanOrEqual(6);
  });

  test("window slides", () => {
    let now = 1000;
    const limiter = createRateLimiter(2, 6_000, () => now);
    expect(limiter.hit("u")).toBe(true);
    expect(limiter.hit("u")).toBe(true);
    expect(limiter.hit("u")).toBe(false);
    now += 6_001;
    expect(limiter.hit("u")).toBe(true);
    expect(limiter.retryAfterSeconds("u")).toBe(0);
  });

  test("keys are independent and reset works", () => {
    const limiter = createRateLimiter(1, 6_000, () => 1000);
    expect(limiter.hit("a")).toBe(true);
    expect(limiter.hit("a")).toBe(false);
    expect(limiter.hit("b")).toBe(true);
    limiter.reset("a");
    expect(limiter.hit("a")).toBe(true);
    limiter.reset();
    expect(limiter.hit("b")).toBe(true);
    expect(limiter.hit("b")).toBe(false);
  });
});

describe("withTimeout", () => {
  test("passes through a fast value", async () => {
    expect(await withTimeout(Promise.resolve("ok"), 1000, "test")).toBe("ok");
  });

  test("rejects when the promise is slower than the budget", async () => {
    const slow = new Promise<string>((resolve) => setTimeout(() => resolve("late"), 500));
    await expect(withTimeout(slow, 20, "slow")).rejects.toThrow("slow timed out after 20ms");
  });

  test("propagates the original error", async () => {
    await expect(withTimeout(Promise.reject(new Error("boom")), 1000, "test")).rejects.toThrow("boom");
  });
});
