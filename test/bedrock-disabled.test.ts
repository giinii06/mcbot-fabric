import { describe, expect, test } from "bun:test";
import { commandRegistry, type CommandContext } from "../src/minecraft/commands";
import { pendingRegistrations } from "../src/minecraft/commands/register";
import { commitRegistration } from "../src/minecraft/registration";
import type { IdentityCandidate } from "../src/minecraft/identity";
import {
  BEDROCK_UUID,
  BEDROCK_XUID,
  GUILD,
  USER,
  createFakeBridge,
  createTestServices,
} from "./helpers";

const BEDROCK_CANDIDATE: IdentityCandidate = {
  edition: "BEDROCK",
  uuid: BEDROCK_UUID,
  username: "Bedrock Kid",
  xuid: BEDROCK_XUID,
};

describe("Bedrock support retirement", () => {
  test("commitRegistration refuses a BEDROCK candidate without the bridge or a database row", async () => {
    const bridge = createFakeBridge();
    const { services, repos, db } = createTestServices({ bridge });
    try {
      const result = await commitRegistration(services, {
        guildId: GUILD,
        userId: USER,
        displayName: "BedrockUser",
        candidate: BEDROCK_CANDIDATE,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.stage).toBe("duplicate");
        expect(result.reason).toContain("Java 전용");
        expect(result.reason).toContain("기존 기록은 보존");
      }
      expect(bridge.calls).toHaveLength(0);
      expect(repos.getRegistration(GUILD, USER, "BEDROCK")).toBeNull();
    } finally {
      db.close();
    }
  });

  test("유저등록베드락 replies ephemerally as unsupported without resolving an identity", async () => {
    const { services, db, identityFetches } = createTestServices();
    const pendingBefore = pendingRegistrations.size();
    let resolveCalls = 0;
    services.identity.resolve = async () => {
      resolveCalls += 1;
      throw new Error("identity lookup must not run");
    };
    let reply: { ephemeral?: boolean } | undefined;
    try {
      const interaction = {
        commandName: "유저등록베드락",
        guildId: GUILD,
        user: { id: USER, username: "tester" },
        inCachedGuild: () => false,
        deferred: false,
        replied: false,
        options: { getString: () => "Bedrock Kid" },
        deferReply: async () => { throw new Error("유저등록베드락 must not defer"); },
        editReply: async () => { throw new Error("유저등록베드락 must not open a pending flow"); },
        reply: async (value: { ephemeral?: boolean }) => { reply = value; },
      } as unknown as CommandContext["interaction"];

      const module = commandRegistry.get("유저등록베드락");
      expect(module).toBeDefined();
      await module!.execute({ interaction, services });

      expect(identityFetches).toHaveLength(0);
      expect(resolveCalls).toBe(0);
      expect(reply?.ephemeral).toBe(true);
      expect(JSON.stringify(reply)).toContain("Java");
      expect(JSON.stringify(reply)).toContain("지원하지 않습니다");
      expect(pendingRegistrations.size()).toBe(pendingBefore);
    } finally {
      db.close();
    }
  });
});
