import { describe, expect, test } from "bun:test";
import { commandModules, commandRegistry, toApplicationCommand } from "../src/minecraft/commands";

const ADMIN_ONLY = ["마크로그설치", "유저강제해제", "유저조회", "유저목록", "화이트리스트동기-sync"];
const MEMBER_COMMANDS = ["유저등록", "유저해제", "마크리더보드"];

describe("command registry", () => {
  test("exposes exactly the eight documented commands", () => {
    const names = commandModules.map((m) => m.name).sort();
    expect(names).toEqual([...ADMIN_ONLY, ...MEMBER_COMMANDS].sort());
    expect(commandRegistry.size).toBe(8);
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
