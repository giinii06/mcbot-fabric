import { describe, expect, test } from "bun:test";
import { commandModules, commandRegistry, toApplicationCommand } from "../src/minecraft/commands";
import type { CommandContext } from "../src/minecraft/commands";
import { createTestServices, GUILD, USER, JAVA_UUID, jsonResponse } from "./helpers";

const ADMIN_ONLY = ["마크로그설치", "유저강제해제", "유저조회", "유저목록", "화이트리스트동기-sync"];
const MEMBER_COMMANDS = ["유저등록", "유저등록베드락", "유저해제", "마크리더보드"];

describe("command registry", () => {
  test("exposes exactly the nine documented commands", () => {
    const names = commandModules.map((m) => m.name).sort();
    expect(names).toEqual([...ADMIN_ONLY, ...MEMBER_COMMANDS].sort());
    expect(commandRegistry.size).toBe(9);
    for (const name of names) {
      expect(commandRegistry.get(name)).toBeDefined();
    }
  });

  test("every command has a non empty description", () => {
    for (const module of commandModules) {
      expect(module.description.length).toBeGreaterThan(0);
      expect(module.description.length).toBeLessThanOrEqual(100);
      expect(typeof module.execute).toBe("function");
    }
  });
});

for (const [name, edition] of [["유저등록", "JAVA"], ["유저등록베드락", "BEDROCK"]] as const) {
  test(`${name} queries only ${edition} and opens its confirmation`, async () => {
    const { services, db, identityFetches } = createTestServices({ identity: {
      fetchImpl: async (url) => String(url).includes("mojang")
        ? jsonResponse({ id: JAVA_UUID.replaceAll("-", ""), name: "Notch" })
        : jsonResponse({ xuid: "2533274790395904" }),
    } });
    let reply: unknown;
    try {
      const interaction = {
        commandName: name, guildId: GUILD, user: { id: USER, username: "tester" },
        inCachedGuild: () => false,
        options: { getString: () => "Notch" },
        deferReply: async () => {},
        editReply: async (value: unknown) => { reply = value; },
      } as unknown as CommandContext["interaction"];
      await commandRegistry.get(name)!.execute({ interaction, services });
      expect(identityFetches).toHaveLength(1);
      expect(identityFetches[0]?.includes(edition === "JAVA" ? "mojang" : "geysermc")).toBe(true);
      expect(JSON.stringify(reply)).toContain("mcreg:go:");
      const resolved = await services.identity.resolve("Notch", edition);
      expect(resolved.status).toBe(edition);
      const other = await services.identity.resolve("Notch", edition === "JAVA" ? "BEDROCK" : "JAVA");
      expect(other.status).not.toBe(edition);
      expect(identityFetches).toHaveLength(2);
    } finally { db.close(); }
  });
}

describe("toApplicationCommand", () => {
  test("admin commands require the Administrator permission bit", () => {
    for (const module of commandModules) {
      const json = toApplicationCommand(module);
      if (module.admin) {
        expect(ADMIN_ONLY).toContain(module.name);
        expect(json.default_member_permissions).toBe("8");
      } else {
        expect(MEMBER_COMMANDS).toContain(module.name);
        expect(json.default_member_permissions).toBeNull();
      }
      expect(json.dm_permission).toBe(false);
      expect(json.nsfw).toBe(false);
      expect(json.name).toBe(module.name);
    }
  });

  test("admin flags match the expected list", () => {
    const admins = commandModules.filter((m) => m.admin).map((m) => m.name).sort();
    expect(admins).toEqual([...ADMIN_ONLY].sort());
  });

  test("options survive the conversion", () => {
    const register = toApplicationCommand(commandRegistry.get("유저등록")!);
    expect(register.options?.length).toBe(1);
    expect((register.options?.[0] as { name: string }).name).toBe("마크아이디");
    expect((register.options?.[0] as { required: boolean }).required).toBe(true);
  });
});
