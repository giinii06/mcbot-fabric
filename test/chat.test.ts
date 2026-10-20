import { expect, spyOn, test } from "bun:test";
import { EmbedBuilder, MessageFlags, REST } from "discord.js";
import { createBridgeHandler } from "../src/bridge/server";
import { handleBridgeEvent } from "../src/minecraft/events";
import { createDiscordSender, createLogChannelService } from "../src/minecraft/channels";
import { createTestServices, GUILD, JAVA_UUID, seedRegistration, USER } from "./helpers";

const player = { uuid: JAVA_UUID, username: "Notch", edition: "JAVA" as const };

test("sender posts text without embeds or mentions and retains embed support", async () => {
  const post = spyOn(REST.prototype, "post").mockResolvedValue({});
  try {
    const sender = createDiscordSender("test-token");
    await sender.send("555555555555555555", "@everyone https://example.com");
    expect(post.mock.calls[0]?.[1]?.body).toEqual({
      content: "@everyone https://example.com", flags: MessageFlags.SuppressEmbeds, allowed_mentions: { parse: [] },
    });
    const embed = new EmbedBuilder().setDescription("join message");
    await sender.send("555555555555555555", [embed]);
    expect(post.mock.calls[1]?.[1]?.body).toEqual({ embeds: [embed.toJSON()], allowed_mentions: { parse: [] } });
  } finally { post.mockRestore(); }
});

test("authenticated chat reaches the registered guild log channel once", async () => {
  const { services, repos, db, log } = createTestServices();
  const deliveries: { channelId: string; message: unknown }[] = [];
  try {
    repos.insertRegistration(seedRegistration({ guildId: GUILD, discordUserId: USER }));
    services.logChannels = createLogChannelService({ repos, log, sender: {
      async send(channelId, message) { deliveries.push({ channelId, message }); },
    } });
    services.logChannels.set(GUILD, "555555555555555555");
    const handler = createBridgeHandler({
      port: 0, secret: services.env.MC_BRIDGE_SECRET, log, isMinecraftHealthy: () => true,
      onEvent: (event) => handleBridgeEvent(services, event),
    });
    const request = (secret: string) => new Request("http://bot/bridge/events", {
      method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ eventId: "chat-event-0001", ts: Date.now(), type: "player.chat", player, message: "안녕 **친구** @everyone x=123 (1, 64, 2)" }),
    });
    expect((await handler(request("wrong-secret"))).status).toBe(401);
    expect(deliveries).toHaveLength(0);
    expect((await handler(request(services.env.MC_BRIDGE_SECRET))).status).toBe(200);
    expect((await handler(request(services.env.MC_BRIDGE_SECRET))).status).toBe(200);
    expect(deliveries).toEqual([{ channelId: "555555555555555555", message: "**DiscordUser (Notch)**: 안녕 \\*\\*친구\\*\\* @everyone x=123 (1, 64, 2)" }]);
  } finally { db.close(); }
});

test("unregistered player chat uses configured log channels", async () => {
  const { services, repos, db, sent } = createTestServices();
  try {
    repos.setLogChannel(GUILD, "555555555555555555", Date.now());
    await handleBridgeEvent(services, { type: "player.chat", eventId: "chat-event-0002", ts: Date.now(), player, message: "hello" });
    expect(sent).toEqual([{ guildId: GUILD, embeds: 0 }]);
  } finally { db.close(); }
});

test("escaped chat fits Discord's 2000 character content limit", async () => {
  const { services, repos, db } = createTestServices();
  try {
    repos.setLogChannel(GUILD, "555555555555555555", Date.now());
    let content: string | undefined;
    services.logChannels.send = async (_guildId, message) => {
      if (typeof message === "string") content = message;
      return true;
    };
    await handleBridgeEvent(services, { type: "player.chat", eventId: "chat-event-0003", ts: Date.now(), player, message: "\\".repeat(1024) });
    expect(content).toHaveLength(2000);
    expect(content?.startsWith("**Notch**: ")).toBe(true);
  } finally { db.close(); }
});
