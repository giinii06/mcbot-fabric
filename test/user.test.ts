import { describe, expect, test } from "bun:test";
import { discordDisplayName, displayLabel, formatMinecraftUser, truncate } from "../src/core/user";

describe("formatMinecraftUser", () => {
  test("always <Discord name> (<Minecraft name>)", () => {
    expect(formatMinecraftUser("디스플레이", "Notch")).toBe("디스플레이 (Notch)");
  });

  test("falls back to whichever side exists", () => {
    expect(formatMinecraftUser("", "Notch")).toBe("Notch");
    expect(formatMinecraftUser(null, "Notch")).toBe("Notch");
    expect(formatMinecraftUser("디스플레이", "")).toBe("디스플레이");
    expect(formatMinecraftUser(undefined, "Notch")).toBe("Notch");
  });

  test("collapses identical names instead of repeating", () => {
    expect(formatMinecraftUser("Notch", "Notch")).toBe("Notch");
    expect(formatMinecraftUser("  Notch  ", "Notch")).toBe("Notch");
  });
});

describe("discordDisplayName", () => {
  test("prefers displayName, then global name, then username", () => {
    expect(
      discordDisplayName({ displayName: "닉네임", globalName: "전역", user: { username: "user" } }),
    ).toBe("닉네임");
    expect(discordDisplayName({ displayName: "  ", globalName: "전역", user: { username: "user" } })).toBe("전역");
    expect(discordDisplayName({ displayName: "", globalName: null, user: { username: "user" } })).toBe("user");
    expect(discordDisplayName({})).toBeNull();
    expect(discordDisplayName(null)).toBeNull();
  });
});

describe("displayLabel", () => {
  test("uses the resolved discord name with the minecraft name", () => {
    expect(displayLabel({ displayName: "닉네임" }, "Notch")).toBe("닉네임 (Notch)");
    expect(displayLabel(null, "Notch")).toBe("Notch");
  });
});

describe("truncate", () => {
  test("keeps short text as is", () => {
    expect(truncate("  hello   world  ", 50)).toBe("hello world");
  });

  test("cuts long text with an ellipsis", () => {
    const out = truncate("a".repeat(30), 10);
    expect(out.length).toBeLessThanOrEqual(10);
    expect(out.endsWith("…")).toBe(true);
  });
});
