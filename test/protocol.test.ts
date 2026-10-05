import { describe, expect, test } from "bun:test";
import {
  inboundEventSchema,
  opsEnum,
  opsRequestSchema,
  playerRefSchema,
  statusEventSchema,
  whitelistEntrySchema,
} from "../src/bridge/protocol";

const PLAYER = {
  uuid: "069a79f4-44e9-4726-a5be-ca90e38aaf51",
  username: "Notch",
  edition: "JAVA",
  xuid: null,
};

const base = { eventId: "event-00000001", ts: 1_700_000_000_000 };

describe("playerRefSchema", () => {
  test("accepts both editions and an optional xuid", () => {
    expect(playerRefSchema.safeParse(PLAYER).success).toBe(true);
    expect(
      playerRefSchema.safeParse({
        uuid: "00000000-0000-0000-0009-01fb54b26482",
        username: "Bedrock Kid",
        edition: "BEDROCK",
        xuid: "2535453759792258",
      }).success,
    ).toBe(true);
  });

  test("rejects unknown editions and bad uuids", () => {
    expect(playerRefSchema.safeParse({ ...PLAYER, edition: "SWITCH" }).success).toBe(false);
    expect(playerRefSchema.safeParse({ ...PLAYER, uuid: "nope" }).success).toBe(false);
    expect(playerRefSchema.safeParse({ ...PLAYER, username: "" }).success).toBe(false);
  });
});

describe("inboundEventSchema", () => {
  test("accepts every event type the plugin emits", () => {
    const events = [
      { ...base, type: "player.join", player: PLAYER },
      { ...base, type: "player.quit", player: PLAYER, reason: "DISCONNECTED" },
      {
        ...base,
        type: "player.death",
        player: PLAYER,
        message: "Notch fell from a high place",
        cause: "fall",
        killer: null,
      },
      {
        ...base,
        type: "player.advancement",
        player: PLAYER,
        advancement: { key: "minecraft:story/mine_diamond", title: "Diamonds!", frame: "task" },
      },
      { ...base, type: "server.status", status: "started", online: 0, max: 20, players: [] },
      { ...base, type: "server.status", status: "stopped", online: 3, max: 20, players: [PLAYER] },
    ];
    for (const event of events) {
      expect(inboundEventSchema.safeParse(event).success).toBe(true);
    }
  });

  test("rejects unknown types and malformed payloads", () => {
    expect(inboundEventSchema.safeParse({ ...base, type: "player.chat", player: PLAYER }).success).toBe(false);
    expect(inboundEventSchema.safeParse({ ...base, type: "player.join" }).success).toBe(false);
    expect(inboundEventSchema.safeParse({ ...base, type: "player.join", player: PLAYER, ts: -1 }).success).toBe(false);
    expect(inboundEventSchema.safeParse({ type: "player.join", player: PLAYER, ts: 1 }).success).toBe(false);
    expect(
      inboundEventSchema.safeParse({ ...base, type: "server.status", status: "restarting", online: 0, max: 20 })
        .success,
    ).toBe(false);
  });

  test("the death payload has no coordinate or world fields", () => {
    const parsed = inboundEventSchema.parse({
      ...base,
      type: "player.death",
      player: PLAYER,
      message: "Notch tried to swim in lava",
      cause: "lava",
    });
    const keys = Object.keys(parsed);
    expect(keys.sort()).toEqual(["cause", "eventId", "message", "player", "ts", "type"]);
  });

  test("optional death fields may be omitted", () => {
    expect(
      inboundEventSchema.safeParse({ ...base, type: "player.death", player: PLAYER }).success,
    ).toBe(true);
  });
});

describe("opsRequestSchema", () => {
  test("accepts exactly the eight typed operations", () => {
    expect([...opsEnum].map(String).sort()).toEqual(
      [
        "getOnlinePlayers",
        "getPlaytime",
        "getStatus",
        "getWhitelist",
        "whitelistAddBedrock",
        "whitelistAddJava",
        "whitelistRemoveBedrock",
        "whitelistRemoveJava",
      ].sort(),
    );

    const requests = [
      { op: "whitelistAddJava", requestId: "abcdefgh", uuid: PLAYER.uuid, username: "Notch" },
      { op: "whitelistRemoveJava", requestId: "abcdefgh", uuid: PLAYER.uuid, username: "Notch" },
      { op: "whitelistAddBedrock", requestId: "abcdefgh", gamertag: "Bedrock Kid", xuid: "2535453759792258" },
      { op: "whitelistRemoveBedrock", requestId: "abcdefgh", gamertag: "Bedrock Kid" },
      { op: "getWhitelist", requestId: "abcdefgh" },
      { op: "getPlaytime", requestId: "abcdefgh", uuid: PLAYER.uuid },
      { op: "getOnlinePlayers", requestId: "abcdefgh" },
      { op: "getStatus", requestId: "abcdefgh" },
    ];
    for (const request of requests) {
      expect(opsRequestSchema.safeParse(request).success).toBe(true);
    }
  });

  test("there is no arbitrary command operation", () => {
    expect(opsRequestSchema.safeParse({ op: "console.exec", requestId: "abcdefgh" }).success).toBe(false);
    expect(opsRequestSchema.safeParse({ op: "runCommand", requestId: "abcdefgh", command: "stop" }).success).toBe(false);
    expect(opsRequestSchema.safeParse({ op: "op", requestId: "abcdefgh", username: "Notch" }).success).toBe(false);
    expect(opsRequestSchema.safeParse({ op: "whitelistAddJava", requestId: "ab" }).success).toBe(false);
    expect(opsRequestSchema.safeParse({ op: "whitelistAddJava", requestId: "abcdefgh", command: "stop" }).success).toBe(
      false,
    );
  });

  test("whitelist payloads reject command injection", () => {
    expect(
      opsRequestSchema.safeParse({
        op: "whitelistAddJava",
        requestId: "abcdefgh",
        uuid: PLAYER.uuid,
        username: "Notch; op",
      }).success,
    ).toBe(false);
    expect(
      opsRequestSchema.safeParse({
        op: "whitelistAddBedrock",
        requestId: "abcdefgh",
        gamertag: 'x"; stop; "',
      }).success,
    ).toBe(false);
  });
});

describe("statusEventSchema and whitelistEntrySchema", () => {
  test("status only allows started/stopped", () => {
    expect(statusEventSchema.safeParse({ ...base, type: "server.status", status: "started", online: 0, max: 20 }).success).toBe(
      true,
    );
    expect(statusEventSchema.safeParse({ ...base, type: "server.status", status: "booting", online: 0, max: 20 }).success).toBe(
      false,
    );
  });

  test("whitelist entries need a valid uuid and a name", () => {
    expect(
      whitelistEntrySchema.safeParse({ uuid: PLAYER.uuid, name: "Notch", edition: "JAVA" }).success,
    ).toBe(true);
    expect(whitelistEntrySchema.safeParse({ uuid: "bad", name: "Notch" }).success).toBe(false);
    expect(whitelistEntrySchema.safeParse({ uuid: PLAYER.uuid, name: "" }).success).toBe(false);
  });
});

describe("deathCount", () => {
  test("carries the n-th death number and is bounded", () => {
    const payload = { ...base, type: "player.death", player: PLAYER, cause: "drowning", deathCount: 4 };
    expect(inboundEventSchema.parse(payload)).toMatchObject({ deathCount: 4 });
    expect(inboundEventSchema.safeParse({ ...payload, deathCount: -1 }).success).toBe(false);
    expect(inboundEventSchema.safeParse({ ...payload, deathCount: 1.5 }).success).toBe(false);
    expect(inboundEventSchema.safeParse({ ...payload, deathCount: "4" }).success).toBe(false);
  });
});
