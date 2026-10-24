import { expect, test } from "bun:test";
import type { InboundEvent } from "../src/bridge/protocol";
import { createLogChannelService } from "../src/minecraft/channels";
import { handleBridgeEvent } from "../src/minecraft/events";
import { bedrockUuid } from "../src/minecraft/identity";
import { prepareRegistration } from "../src/minecraft/registration";
import { createBridgeHandler } from "../src/bridge/server";
import { BEDROCK_UUID, BEDROCK_XUID, createTestServices, GUILD, JAVA_UUID, seedRegistration, USER } from "./helpers";

const OTHER_GUILD = "222222222222222222";
const player = { uuid: JAVA_UUID, username: "Notch", edition: "JAVA" as const };
const base = { eventId: "multi-guild-event", ts: 1_700_000_000_000, player };

test("only authenticated, consistent Bedrock login identities bypass Xbox lookup", async () => {
  const { services, db, sent, identityFetches, log } = createTestServices();
  const xuid = "2535453759792258";
  const payload = { ...base, type: "player.identity", player: {
    uuid: bedrockUuid(xuid), username: ".Bedrock_Kid", edition: "BEDROCK", xuid,
  } };
  try {
    const handler = createBridgeHandler({ port: 0, secret: services.env.MC_BRIDGE_SECRET, log,
      isMinecraftHealthy: () => true, onEvent: (event) => handleBridgeEvent(services, event),
    });
    const send = (secret: string, body = payload) => handler(new Request("http://bot/bridge/events", {
      method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }));
    expect((await send("wrong-secret")).status).toBe(401);
    for (const uuid of ["bad-uuid", JAVA_UUID, bedrockUuid("123456789")]) {
      expect((await send(services.env.MC_BRIDGE_SECRET, { ...payload, player: { ...payload.player, uuid } })).status).toBe(400);
    }
    expect((await send(services.env.MC_BRIDGE_SECRET)).status).toBe(200);
    const prepared = await prepareRegistration(services, {
      guildId: GUILD, userId: USER, displayName: "tester", input: "Bedrock Kid", edition: "BEDROCK",
    });
    expect(prepared.ok).toBe(true);
    if (prepared.ok) expect(prepared.candidates[0]?.xuid).toBe(xuid);
    expect(identityFetches).toHaveLength(0);
    expect(sent).toHaveLength(0);
  } finally { db.close(); }
});
const events: InboundEvent[] = [
  { ...base, type: "player.chat", message: "hello" },
  { ...base, type: "player.join" },
  { ...base, type: "player.quit" },
  { ...base, type: "player.death", message: "fell" },
  { ...base, type: "player.advancement", advancement: { key: "minecraft:story/mine_stone", title: "Stone Age" } },
];

for (const event of events) {
  test(`${event.type} replaces the unknown Discord name in new logs after Bedrock registration`, async () => {
    const { services, repos, db } = createTestServices();
    const messages: string[] = [];
    const bedrockEvent = { ...event, player: { uuid: BEDROCK_UUID, username: ".BedrockKid", edition: "BEDROCK" as const, xuid: BEDROCK_XUID } };
    try {
      repos.setLogChannel(GUILD, "channel-a", 1);
      services.logChannels.send = async (_guildId, message) => {
        messages.push(typeof message === "string" ? message : JSON.stringify(message));
        return true;
      };
      services.resolveMember = async () => null;
      await handleBridgeEvent(services, bedrockEvent);
      expect(messages[0]).toContain("? (.BedrockKid)");

      repos.insertRegistration(seedRegistration({ guildId: GUILD, discordUserId: USER,
        minecraftUuid: BEDROCK_UUID, minecraftUsername: ".BedrockKid", minecraftEdition: "BEDROCK",
        discordDisplayName: "등록닉네임",
      }));
      await handleBridgeEvent(services, bedrockEvent);
      expect(messages[1]).toContain("등록닉네임 (.BedrockKid)");
      expect(messages[0]).toContain("? (.BedrockKid)");
    } finally { db.close(); }
  });

  for (const hasLogChannel of [true, false]) {
    test(`${event.type} stays in the private guild (log channel: ${hasLogChannel})`, async () => {
      const privateGuild = "1214203256620847124";
      const { services, repos, db, sent } = createTestServices();
      try {
        repos.insertRegistration(seedRegistration({ guildId: GUILD, discordUserId: USER }));
        repos.insertRegistration(seedRegistration({ guildId: privateGuild, discordUserId: USER }));
        repos.setLogChannel(GUILD, "channel-a", 1);
        repos.setLogChannel(OTHER_GUILD, "channel-b", 1);
        if (hasLogChannel) repos.setLogChannel(privateGuild, "private-channel", 1);

        await handleBridgeEvent(services, event);

        expect(sent).toEqual(hasLogChannel
          ? [{ guildId: privateGuild, embeds: event.type === "player.chat" ? 0 : 1 }]
          : []);
      } finally { db.close(); }
    });
  }

  test(`${event.type} reaches all configured guilds with the registered guild nickname`, async () => {
    const { services, repos, db, log } = createTestServices();
    const deliveries = new Map<string, string>();
    try {
      // The registered guild need not have a log channel of its own.
      repos.insertRegistration(seedRegistration({ guildId: GUILD, discordUserId: USER }));
      services.resolveMember = async (guildId, userId) => {
        expect(guildId).toBe(GUILD);
        expect(userId).toBe(USER);
        return { displayName: "등록닉네임" };
      };
      services.logChannels = createLogChannelService({ repos, log, sender: {
        async send(channelId, message) {
          deliveries.set(channelId, typeof message === "string" ? message : JSON.stringify(message));
        },
      } });
      services.logChannels.set(OTHER_GUILD, "channel-a");
      services.logChannels.set("333333333333333333", "channel-b");
      await handleBridgeEvent(services, event);
      expect([...deliveries.keys()].sort()).toEqual(["channel-a", "channel-b"]);
      for (const message of deliveries.values()) expect(message).toContain("등록닉네임 (Notch)");
    } finally { db.close(); }
  });
}

test("local registration takes priority and saved name survives member lookup failure", async () => {
  const { services, repos, db } = createTestServices();
  const messages = new Map<string, unknown>();
  try {
    repos.insertRegistration(seedRegistration({ guildId: GUILD, discordUserId: USER, discordDisplayName: "첫서버" }));
    repos.insertRegistration(seedRegistration({ guildId: OTHER_GUILD, discordUserId: USER, discordDisplayName: "둘째서버" }));
    repos.setLogChannel(GUILD, "channel-a", 1);
    repos.setLogChannel(OTHER_GUILD, "channel-b", 1);
    services.resolveMember = async () => null;
    services.logChannels.send = async (guildId, message) => { messages.set(guildId, message); return true; };
    await handleBridgeEvent(services, events[0]!);
    expect(messages.get(GUILD)).toBe("**첫서버 (Notch)**: hello");
    expect(messages.get(OTHER_GUILD)).toBe("**둘째서버 (Notch)**: hello");
  } finally { db.close(); }
});

test("a slow failing channel does not delay delivery to another guild", async () => {
  const { services, repos, db, log } = createTestServices();
  const attempted: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let pending: Promise<void> | undefined;
  try {
    services.logChannels = createLogChannelService({ repos, log, sender: {
      async send(channelId) {
        attempted.push(channelId);
        if (channelId === "slow") { await gate; throw new Error("missing permission"); }
      },
    } });
    services.logChannels.set(GUILD, "slow");
    services.logChannels.set(OTHER_GUILD, "working");
    pending = handleBridgeEvent(services, events[0]!);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(attempted).toEqual(["slow", "working"]);
    release();
    await pending;
    expect(log.lines.some((line) => line.includes("failed to deliver log message"))).toBe(true);
  } finally { release(); await pending; db.close(); }
});
