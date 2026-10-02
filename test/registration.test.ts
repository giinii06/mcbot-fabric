import { describe, expect, test } from "bun:test";
import { createRateLimiter } from "../src/core/rate-limit";
import { BridgeError } from "../src/bridge/client";
import {
  commitRegistration,
  prepareRegistration,
  unregister,
} from "../src/minecraft/registration";
import {
  BEDROCK_UUID,
  GUILD,
  JAVA_NAME,
  JAVA_UUID,
  OTHER_USER,
  USER,
  createFakeBridge,
  createTestServices,
  jsonResponse,
  seedRegistration,
} from "./helpers";
import type { IdentityCandidate } from "../src/minecraft/identity";

const JAVA_ONLY: (url: string) => Response = (url) =>
  url.includes("mojang")
    ? jsonResponse({ id: "069a79f444e94726a5beca90e38aaf51", name: JAVA_NAME })
    : jsonResponse({}, 503);

const CANDIDATE: IdentityCandidate = {
  edition: "JAVA",
  uuid: JAVA_UUID,
  username: JAVA_NAME,
  xuid: null,
};

describe("prepareRegistration", () => {
  test("resolves the identity and returns a single java candidate", async () => {
    const { services } = createTestServices({
      identity: { fetchImpl: async (input) => JAVA_ONLY(String(input)) },
      limiter: createRateLimiter(10, 6_000),
    });
    const result = await prepareRegistration(services, {
      guildId: GUILD,
      userId: USER,
      displayName: "DiscordUser",
      input: "Notch",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.identity.status).toBe("JAVA");
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]?.uuid).toBe(JAVA_UUID);
    }
  });

  test("is rate limited per user", async () => {
    const { services } = createTestServices({
      identity: { fetchImpl: async (input) => JAVA_ONLY(String(input)) },
      limiter: createRateLimiter(1, 6_000),
    });
    const first = await prepareRegistration(services, {
      guildId: GUILD,
      userId: USER,
      displayName: "DiscordUser",
      input: "Notch",
    });
    expect(first.ok).toBe(true);
    const second = await prepareRegistration(services, {
      guildId: GUILD,
      userId: USER,
      displayName: "DiscordUser",
      input: "Notch",
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toContain("초 후 가능");
  });

  test("rejects an unknown account", async () => {
    const { services } = createTestServices({
      identity: { fetchImpl: async () => jsonResponse({}, 404) },
      limiter: createRateLimiter(10, 6_000),
    });
    const result = await prepareRegistration(services, {
      guildId: GUILD,
      userId: USER,
      displayName: "DiscordUser",
      input: "Nobody",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("찾을 수 없습니다");
  });

  test("rejects an invalid player input before any lookup", async () => {
    const { services, identityFetches } = createTestServices({ limiter: createRateLimiter(10, 6_000) });
    const result = await prepareRegistration(services, {
      guildId: GUILD,
      userId: USER,
      displayName: "DiscordUser",
      input: ".Notch",
    });
    expect(result.ok).toBe(false);
    expect(identityFetches).toHaveLength(0);
  });

  test("rejects a user who is already registered", async () => {
    const { services, repos } = createTestServices({
      identity: { fetchImpl: async (input) => JAVA_ONLY(String(input)) },
      limiter: createRateLimiter(10, 6_000),
    });
    repos.insertRegistration(seedRegistration({ guildId: GUILD, discordUserId: USER }));
    const result = await prepareRegistration(services, {
      guildId: GUILD,
      userId: USER,
      displayName: "DiscordUser",
      input: "Notch",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("이미 등록되어 있습니다");
  });

  test("rejects a minecraft id claimed by someone else", async () => {
    const { services, repos } = createTestServices({
      identity: { fetchImpl: async (input) => JAVA_ONLY(String(input)) },
      limiter: createRateLimiter(10, 6_000),
    });
    repos.insertRegistration(seedRegistration({ guildId: GUILD, discordUserId: OTHER_USER }));
    const result = await prepareRegistration(services, {
      guildId: GUILD,
      userId: USER,
      displayName: "DiscordUser",
      input: "Notch",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("다른 Discord 사용자");
  });
});

describe("commitRegistration", () => {
  function commitOptions() {
    const bridge = createFakeBridge();
    const harness = createTestServices({ bridge, limiter: createRateLimiter(10, 6_000) });
    return {
      ...harness,
      input: { guildId: GUILD, userId: USER, displayName: "DiscordUser", candidate: CANDIDATE },
    };
  }

  test("whitelist first, database second", async () => {
    const { services, repos, bridge, sent, input } = commitOptions();
    const result = await commitRegistration(services, input);
    expect(result.ok).toBe(true);
    expect(bridge.calls.map((c) => c.op)).toEqual(["whitelistAddJava"]);
    expect(repos.getRegistration(GUILD, USER)?.minecraftUsername).toBe(JAVA_NAME);
    expect(repos.listAudit(GUILD, 10)[0]?.action).toBe("REGISTER");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.guildId).toBe(GUILD);
  });

  test("a rejected whitelist entry never reaches the database", async () => {
    const { services, repos, bridge, input } = commitOptions();
    bridge.calls.length = 0;
    bridge.addJava = async () => ({ ok: false, applied: false, reason: "rejected by server" });
    const result = await commitRegistration(services, input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("whitelist");
      expect(result.reason).toContain("화이트리스트 추가에 실패");
      expect(result.reason).toContain("rejected by server");
    }
    expect(repos.getRegistration(GUILD, USER)).toBeNull();
  });

  test("a bridge outage is reported as a whitelist failure", async () => {
    const { services, repos, input } = commitOptions();
    const bridge = createFakeBridge({ failWith: new BridgeError("connect ECONNREFUSED", undefined, "whitelistAddJava") });
    services.bridge = bridge;
    const result = await commitRegistration(services, input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("whitelist");
      expect(result.reason).toContain("ECONNREFUSED");
    }
    expect(repos.getRegistration(GUILD, USER)).toBeNull();
  });

  test("a database failure rolls the whitelist entry back", async () => {
    const { services, repos, bridge, input, log } = commitOptions();
    repos.insertRegistration = () => {
      throw new Error("disk full");
    };
    const result = await commitRegistration(services, input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stage).toBe("database");
    expect(bridge.calls.map((c) => c.op)).toEqual(["whitelistAddJava", "whitelistRemoveJava"]);
    expect(repos.getRegistration(GUILD, USER)).toBeNull();
    expect(log.lines.some((l) => l.includes("registration insert failed"))).toBe(true);
  });

  test("a duplicate commit is rejected before touching the whitelist", async () => {
    const { services, repos, bridge, input } = commitOptions();
    repos.insertRegistration(seedRegistration({ guildId: GUILD, discordUserId: USER }));
    const result = await commitRegistration(services, input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stage).toBe("duplicate");
    expect(bridge.calls).toHaveLength(0);
  });
});

describe("unregister", () => {
  test("removes the whitelist entry and the database row", async () => {
    const { services, repos, bridge, sent } = createTestServices({
      bridge: createFakeBridge(),
      limiter: createRateLimiter(10, 6_000),
    });
    repos.insertRegistration(seedRegistration({ guildId: GUILD, discordUserId: USER }));
    const result = await unregister(services, {
      guildId: GUILD,
      userId: USER,
      actorId: USER,
      reason: "본인 요청",
    });
    expect(result.ok).toBe(true);
    expect(bridge.calls.map((c) => c.op)).toEqual(["whitelistRemoveJava"]);
    expect(repos.getRegistration(GUILD, USER)).toBeNull();
    expect(repos.listAudit(GUILD, 10)[0]?.action).toBe("UNREGISTER");
    expect(sent).toHaveLength(1);
  });

  test("a database failure restores the whitelist entry", async () => {
    const { services, repos, bridge, log } = createTestServices({
      bridge: createFakeBridge(),
      limiter: createRateLimiter(10, 6_000),
    });
    repos.insertRegistration(seedRegistration({ guildId: GUILD, discordUserId: USER }));
    repos.deleteRegistration = () => {
      throw new Error("database is locked");
    };
    const result = await unregister(services, {
      guildId: GUILD,
      userId: USER,
      actorId: USER,
      reason: "본인 요청",
    });
    expect(result.ok).toBe(false);
    expect(bridge.calls.map((c) => c.op)).toEqual(["whitelistRemoveJava", "whitelistAddJava"]);
    expect(repos.getRegistration(GUILD, USER)).not.toBeNull();
    expect(log.lines.some((l) => l.includes("registration delete failed"))).toBe(true);
  });

  test("rejects a user who is not registered", async () => {
    const { services, bridge } = createTestServices({ bridge: createFakeBridge() });
    const result = await unregister(services, {
      guildId: GUILD,
      userId: USER,
      actorId: USER,
      reason: "본인 요청",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("등록된 Minecraft 계정이 없습니다");
    expect(bridge.calls).toHaveLength(0);
  });

  test("bedrock candidates are removed through the bedrock operation", async () => {
    const { services, repos, bridge } = createTestServices({
      bridge: createFakeBridge(),
      limiter: createRateLimiter(10, 6_000),
    });
    repos.insertRegistration(
      seedRegistration({
        guildId: GUILD,
        discordUserId: USER,
        minecraftUuid: BEDROCK_UUID,
        minecraftUsername: "Bedrock Kid",
        minecraftEdition: "BEDROCK",
      }),
    );
    const result = await unregister(services, {
      guildId: GUILD,
      userId: USER,
      actorId: USER,
      reason: "본인 요청",
    });
    expect(result.ok).toBe(true);
    expect(bridge.calls.map((c) => c.op)).toEqual(["whitelistRemoveBedrock"]);
    expect(bridge.calls[0]?.payload.gamertag).toBe("Bedrock Kid");
  });
});
