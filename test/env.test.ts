import { describe, expect, test } from "bun:test";
import { discordEnabled, loadEnv, secretValues } from "../src/env";

describe("loadEnv", () => {
  test("requires the bridge secret", () => {
    expect(() => loadEnv({})).toThrow("MC_BRIDGE_SECRET");
    expect(() => loadEnv({ MC_BRIDGE_SECRET: "short" })).toThrow();
  });

  test("applies defaults", () => {
    const env = loadEnv({ MC_BRIDGE_SECRET: "x".repeat(32) });
    expect(env.MC_BRIDGE_BASE_URL).toBe("http://minecraft:8765");
    expect(env.MC_BOT_PORT).toBe(47865);
    expect(env.SQLITE_PATH).toBe("data/mcbot.sqlite");
    expect(env.LOG_LEVEL).toBe("info");
  });

  test("treats empty strings as unset", () => {
    const env = loadEnv({
      MC_BRIDGE_SECRET: "x".repeat(32),
      DISCORD_TOKEN: "",
      DISCORD_APPLICATION_ID: "",
    });
    expect(env.DISCORD_TOKEN).toBeUndefined();
    expect(env.DISCORD_APPLICATION_ID).toBeUndefined();
    expect(discordEnabled(env)).toBe(false);
    expect(secretValues(env)).toEqual(["x".repeat(32)]);
  });

  test("rejects invalid snowflakes and ports", () => {
    expect(() => loadEnv({ MC_BRIDGE_SECRET: "x".repeat(32), DISCORD_APPLICATION_ID: "abc" })).toThrow();
    expect(() => loadEnv({ MC_BRIDGE_SECRET: "x".repeat(32), MC_BOT_PORT: "70000" })).toThrow();
    expect(() => loadEnv({ MC_BRIDGE_SECRET: "x".repeat(32), LOG_LEVEL: "verbose" })).toThrow();
  });
});

describe("discordEnabled", () => {
  test("requires both token and application id", () => {
    const base = { MC_BRIDGE_SECRET: "x".repeat(32) };
    expect(discordEnabled(loadEnv(base))).toBe(false);
    expect(discordEnabled(loadEnv({ ...base, DISCORD_TOKEN: "t" }))).toBe(false);
    expect(discordEnabled(loadEnv({ ...base, DISCORD_TOKEN: "t", DISCORD_APPLICATION_ID: "123" }))).toBe(true);
    expect(
      discordEnabled(
        loadEnv({ ...base, DISCORD_TOKEN: "t", DISCORD_APPLICATION_ID: "123", DISCORD_DISABLED: "true" }),
      ),
    ).toBe(false);
  });
});

describe("secretValues", () => {
  test("lists every secret the logger must mask", () => {
    const env = loadEnv({ MC_BRIDGE_SECRET: "x".repeat(32), DISCORD_TOKEN: "discord-token" });
    expect(secretValues(env)).toContain("x".repeat(32));
    expect(secretValues(env)).toContain("discord-token");
  });
});
