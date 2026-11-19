import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { migrate, userVersion } from "../src/db/database";
import { createRepositories, type Edition } from "../src/db/repositories";
import { MIGRATIONS } from "../src/db/schema";
import { createRateLimiter } from "../src/core/rate-limit";
import { commitRegistration, prepareRegistration, unregister } from "../src/minecraft/registration";
import { syncWhitelist } from "../src/minecraft/sync";
import { commandRegistry, type CommandContext } from "../src/minecraft/commands";
import { BEDROCK_UUID, BEDROCK_XUID, GUILD, JAVA_UUID, OTHER_GUILD, OTHER_USER, USER,
  createFakeBridge, createTestServices, jsonResponse, seedRegistration } from "./helpers";

const accounts = {
  JAVA: { edition: "JAVA" as const, uuid: JAVA_UUID, username: "Notch", xuid: null },
  BEDROCK: { edition: "BEDROCK" as const, uuid: BEDROCK_UUID, username: "Bedrock Kid", xuid: BEDROCK_XUID },
};

test("Bedrock registration is refused without calling the bridge, and old Bedrock links are still removable", async () => {
  const { services, repos, bridge, db } = createTestServices({ bridge: createFakeBridge({ failWith: new Error("HTTP 502") }) });
  try {
    const result = await commitRegistration(services, {
      guildId: GUILD, userId: USER, displayName: "BedrockUser", candidate: accounts.BEDROCK,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("duplicate");
      expect(result.reason).toContain("Java 전용");
      expect(result.reason).toContain("기존 기록은 보존");
    }
    expect(repos.getRegistration(GUILD, USER, "BEDROCK")).toBeNull();

    repos.insertRegistration(seedRegistration({
      guildId: GUILD, discordUserId: USER, minecraftEdition: "BEDROCK",
      minecraftUuid: BEDROCK_UUID, minecraftUsername: "Bedrock Kid",
    }));
    expect((await unregister(services, {
      guildId: GUILD, userId: USER, actorId: USER, edition: "BEDROCK", reason: "test",
    })).ok).toBe(true);
    expect(repos.getRegistration(GUILD, USER, "BEDROCK")).toBeNull();
    expect(bridge.calls).toHaveLength(0);
  } finally { db.close(); }
});

test("failed Bedrock database deletes preserve both accounts and never change the whitelist", async () => {
  const { services, repos, bridge, db } = createTestServices();
  try {
    repos.insertRegistration(seedRegistration({ guildId: GUILD, discordUserId: USER }));
    repos.insertRegistration(seedRegistration({ guildId: GUILD, discordUserId: USER,
      minecraftEdition: "BEDROCK", minecraftUuid: BEDROCK_UUID, minecraftUsername: "Bedrock Kid" }));
    repos.deleteRegistration = () => { throw new Error("database locked"); };
    expect((await unregister(services, {
      guildId: GUILD, userId: USER, actorId: USER, edition: "BEDROCK", reason: "test",
    })).ok).toBe(false);
    expect(repos.countRegistrations(GUILD)).toBe(2);
    expect(bridge.calls).toHaveLength(0);
  } finally { db.close(); }
});

test("Bedrock commits are refused before any database write", async () => {
  const { services, repos, bridge, db } = createTestServices();
  try {
    repos.insertRegistration = () => { throw new Error("disk full"); };
    const result = await commitRegistration(services, {
      guildId: OTHER_GUILD, userId: USER, displayName: "test", candidate: accounts.BEDROCK,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stage).toBe("duplicate");
    expect(repos.countRegistrations(OTHER_GUILD)).toBe(0);
    expect(bridge.calls).toHaveLength(0);
  } finally { db.close(); }
});

test("whitelist sync updates Java accounts and ignores registered and unregistered Bedrock accounts", async () => {
  const { services, repos, bridge, db } = createTestServices();
  try {
    for (const account of Object.values(accounts)) repos.insertRegistration(seedRegistration({
      guildId: GUILD, discordUserId: USER, minecraftUuid: account.uuid,
      minecraftUsername: account.username, minecraftEdition: account.edition,
    }));
    const staleUuid = "f642a5e3-d12f-4a7d-9c96-aef87fcf92be";
    bridge.getWhitelist = async () => [
      { uuid: staleUuid, name: "StaleJava" },
      { uuid: "00000000-0000-0000-0009-01fb54b26483", name: ".Guest" },
    ];
    const result = await syncWhitelist(services, GUILD);
    expect(result.ok).toBe(true);
    expect(result.added).toBe(1);
    expect(result.removed).toBe(1);
    expect(bridge.calls).toEqual([
      { op: "whitelistAddJava", payload: { uuid: JAVA_UUID, username: "Notch" } },
      { op: "whitelistRemoveJava", payload: { uuid: staleUuid, username: "StaleJava" } },
    ]);
    expect(repos.countRegistrations(GUILD)).toBe(2);
  } finally { db.close(); }
});

test("migration preserves existing registrations and permits one account per edition", () => {
  const db = new Database(":memory:");
  try {
    for (const migration of MIGRATIONS.slice(0, 3)) db.exec(migration.sql);
    db.exec("PRAGMA user_version = 3");
    const repos = createRepositories(db);
    const java = seedRegistration({ guildId: GUILD, discordUserId: USER });
    const bedrock = seedRegistration({ guildId: OTHER_GUILD, discordUserId: USER,
      minecraftUuid: BEDROCK_UUID, minecraftEdition: "BEDROCK" });
    repos.insertRegistration(java);
    repos.insertRegistration(bedrock);
    migrate(db);
    expect(userVersion(db)).toBe(MIGRATIONS.length);
    expect(repos.getRegistration(GUILD, USER, "JAVA")).toEqual(java);
    expect(repos.getRegistration(OTHER_GUILD, USER, "BEDROCK")).toEqual(bedrock);
    repos.insertRegistration({ ...bedrock, guildId: GUILD });
    expect(repos.countRegistrations(GUILD)).toBe(2);
    expect(() => repos.insertRegistration({ ...java, minecraftUuid: "f642a5e3-d12f-4a7d-9c96-aef87fcf92be" })).toThrow();
    expect(() => repos.insertRegistration({ ...java, discordUserId: OTHER_USER })).toThrow();
    repos.updateRegistrationDisplay(GUILD, USER, "새이름", 10);
    expect(repos.listRegistrations(GUILD).every((reg) => reg.discordDisplayName === "새이름")).toBe(true);
    expect(migrate(db)).toBe(MIGRATIONS.length);
  } finally { db.close(); }
});

test("registers Java, refuses the retired Bedrock commit, then removes only the Java account", async () => {
  const { services, repos, db, bridge } = createTestServices({
    limiter: createRateLimiter(10, 6000),
    identity: { fetchImpl: async (url) => String(url).includes("mojang")
      ? jsonResponse({ id: JAVA_UUID.replaceAll("-", ""), name: "Notch" })
      : jsonResponse({ xuid: BEDROCK_XUID }) },
  });
  try {
    const javaInput = { guildId: GUILD, userId: USER, displayName: "DiscordUser", edition: "JAVA" as const, input: accounts.JAVA.username };
    expect((await prepareRegistration(services, javaInput)).ok).toBe(true);
    expect((await commitRegistration(services, { ...javaInput, candidate: accounts.JAVA })).ok).toBe(true);
    expect((await prepareRegistration(services, javaInput)).ok).toBe(false);
    expect((await commitRegistration(services, { ...javaInput, candidate: accounts.JAVA })).ok).toBe(false);
    // An old pending flow can still resolve a Bedrock identity, but the guard blocks it.
    const bedrockInput = { guildId: GUILD, userId: USER, displayName: "DiscordUser", edition: "BEDROCK" as const, input: accounts.BEDROCK.username };
    expect((await prepareRegistration(services, bedrockInput)).ok).toBe(true);
    const bedrockCommit = await commitRegistration(services, { ...bedrockInput, candidate: accounts.BEDROCK });
    expect(bedrockCommit.ok).toBe(false);
    if (!bedrockCommit.ok) expect(bedrockCommit.reason).toContain("Java 전용");
    expect(repos.getRegistration(GUILD, USER, "BEDROCK")).toBeNull();
    expect(repos.countRegistrations(GUILD)).toBe(1);

    bridge.calls.length = 0;
    expect((await unregister(services, { guildId: GUILD, userId: USER, actorId: USER, edition: "JAVA", reason: "test" })).ok).toBe(true);
    expect(repos.getRegistration(GUILD, USER, "JAVA")).toBeNull();
    expect(bridge.calls.map((call) => call.op)).toEqual(["whitelistRemoveJava"]);
  } finally { db.close(); }
});

for (const command of ["유저조회", "유저해제", "유저강제해제"]) {
  for (const edition of ["JAVA", "BEDROCK"] satisfies Edition[]) {
    test(`${command} selects only ${edition} when both accounts are registered`, async () => {
      const { services, repos, db } = createTestServices();
      let reply: unknown;
      try {
        for (const account of Object.values(accounts)) repos.insertRegistration(seedRegistration({
          guildId: GUILD, discordUserId: USER, minecraftEdition: account.edition,
          minecraftUuid: account.uuid, minecraftUsername: account.username,
        }));
        const interaction = {
          guildId: GUILD, user: { id: USER, username: "tester" }, inCachedGuild: () => false, deferred: true,
          options: { getUser: () => ({ id: USER }), getString: () => edition },
          deferReply: async () => {}, editReply: async (value: unknown) => { reply = value; },
        } as unknown as CommandContext["interaction"];
        const module = commandRegistry.get(command)!;
        expect(module.options?.find((option) => option.name === "에디션")).toMatchObject({ required: true });
        await module.execute({ interaction, services });
        if (command === "유저조회") {
          expect(JSON.stringify(reply)).toContain(accounts[edition].uuid);
          expect(JSON.stringify(reply)).not.toContain(accounts[edition === "JAVA" ? "BEDROCK" : "JAVA"].uuid);
          expect(repos.countRegistrations(GUILD)).toBe(2);
        } else {
          expect(repos.getRegistration(GUILD, USER, edition)).toBeNull();
          expect(repos.countRegistrations(GUILD)).toBe(1);
        }
      } finally { db.close(); }
    });
  }
}
