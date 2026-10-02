import { describe, expect, test } from "bun:test";
import { formatDuration, secondsToTicks, ticksToSeconds } from "../src/core/duration";

describe("formatDuration", () => {
  test("zero and sub minute", () => {
    expect(formatDuration(0)).toBe("0분");
    expect(formatDuration(19)).toBe("1분 미만");
    expect(formatDuration(59)).toBe("1분 미만");
  });

  test("minutes", () => {
    expect(formatDuration(60)).toBe("1분");
    expect(formatDuration(599)).toBe("9분");
    expect(formatDuration(3599)).toBe("59분");
  });

  test("hours with omitted zero parts", () => {
    expect(formatDuration(3600)).toBe("1시간");
    expect(formatDuration(3660)).toBe("1시간 1분");
    expect(formatDuration(3599 * 1)).toBe("59분");
    expect(formatDuration(86399)).toBe("23시간 59분");
  });

  test("days", () => {
    expect(formatDuration(86400)).toBe("1일");
    expect(formatDuration(93600)).toBe("1일 2시간");
    expect(formatDuration(93780)).toBe("1일 2시간 3분");
    expect(formatDuration(93740)).toBe("1일 2시간 2분");
    expect(formatDuration(90_000)).toBe("1일 1시간");
  });

  test("invalid input never throws", () => {
    expect(formatDuration(-1)).toBe("0분");
    expect(formatDuration(Number.NaN)).toBe("0분");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("0분");
  });
});

describe("tick conversion", () => {
  test("20 ticks = 1 second", () => {
    expect(ticksToSeconds(0)).toBe(0);
    expect(ticksToSeconds(19)).toBe(0);
    expect(ticksToSeconds(20)).toBe(1);
    expect(ticksToSeconds(72000)).toBe(3600);
    expect(ticksToSeconds(-5)).toBe(0);
  });

  test("seconds to ticks", () => {
    expect(secondsToTicks(1)).toBe(20);
    expect(secondsToTicks(0)).toBe(0);
    expect(secondsToTicks(-3)).toBe(0);
  });

  test("round trip is lossless for whole seconds", () => {
    expect(ticksToSeconds(secondsToTicks(3600))).toBe(3600);
  });
});
