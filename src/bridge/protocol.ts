import { z } from "zod";

export const EditionEnum = z.enum(["JAVA", "BEDROCK"]);
export type Edition = z.infer<typeof EditionEnum>;

export const uuidSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, "uuid");

export const xuidSchema = z.string().regex(/^\d{4,20}$/, "xbox xuid");

/** Mirrors `Validation.isValidGamertag` on the plugin side. */
export const GAMERTAG = /^[A-Za-z0-9][A-Za-z0-9 _.'-]{0,15}$/;

const eventIdSchema = z.string().min(8).max(80);
const tsSchema = z.number().int().positive();

export const playerRefSchema = z.object({
  uuid: uuidSchema,
  username: z.string().min(1).max(32),
  edition: EditionEnum,
  xuid: xuidSchema.nullish(),
});
export type PlayerRef = z.infer<typeof playerRefSchema>;

export const joinEventSchema = z.object({
  eventId: eventIdSchema,
  type: z.literal("player.join"),
  ts: tsSchema,
  player: playerRefSchema,
});

export const quitEventSchema = z.object({
  eventId: eventIdSchema,
  type: z.literal("player.quit"),
  ts: tsSchema,
  player: playerRefSchema,
  reason: z.string().max(64).nullish(),
});

export const deathEventSchema = z.object({
  eventId: eventIdSchema,
  type: z.literal("player.death"),
  ts: tsSchema,
  player: playerRefSchema,
  /** Plain text death message. Never contains coordinates / world / biome. */
  message: z.string().max(500).nullish(),
  cause: z.string().max(64).nullish(),
  killer: z.string().max(64).nullish(),
  /** Total deaths including this one ("n-th death" line). */
  deathCount: z.number().int().min(0).max(10_000_000).nullish(),
});

export const advancementEventSchema = z.object({
  eventId: eventIdSchema,
  type: z.literal("player.advancement"),
  ts: tsSchema,
  player: playerRefSchema,
  advancement: z.object({
    key: z.string().min(1).max(160),
    title: z.string().min(1).max(200),
    description: z.string().max(600).nullish(),
    frame: z.string().max(32).nullish(),
  }),
});

export const statusEventSchema = z.object({
  eventId: eventIdSchema,
  type: z.literal("server.status"),
  ts: tsSchema,
  status: z.enum(["started", "stopped"]),
  online: z.number().int().min(0),
  max: z.number().int().min(0),
  players: z.array(playerRefSchema).max(500).default([]),
});

export const inboundEventSchema = z.discriminatedUnion("type", [
  joinEventSchema,
  quitEventSchema,
  deathEventSchema,
  advancementEventSchema,
  statusEventSchema,
]);

export type JoinEvent = z.infer<typeof joinEventSchema>;
export type QuitEvent = z.infer<typeof quitEventSchema>;
export type DeathEvent = z.infer<typeof deathEventSchema>;
export type AdvancementEvent = z.infer<typeof advancementEventSchema>;
export type StatusEvent = z.infer<typeof statusEventSchema>;
export type InboundEvent = z.infer<typeof inboundEventSchema>;

// ---------------------------------------------------------------------------
// Bot -> plugin operations (strictly enumerated; there is intentionally no
// generic "run this Minecraft command" operation).
// ---------------------------------------------------------------------------

export const opsEnum = [
  "whitelistAddJava",
  "whitelistRemoveJava",
  "whitelistAddBedrock",
  "whitelistRemoveBedrock",
  "getWhitelist",
  "getPlaytime",
  "getOnlinePlayers",
  "getStatus",
] as const;
export const opSchema = z.enum(opsEnum);
export type BridgeOp = z.infer<typeof opSchema>;

export const whitelistAddJavaSchema = z.object({
  op: z.literal("whitelistAddJava"),
  requestId: z.string().min(8).max(64),
  uuid: uuidSchema,
  username: z.string().regex(/^[a-zA-Z0-9_]{3,16}$/, "java username"),
});

export const whitelistRemoveJavaSchema = z.object({
  op: z.literal("whitelistRemoveJava"),
  requestId: z.string().min(8).max(64),
  uuid: uuidSchema,
  username: z.string().regex(/^[a-zA-Z0-9_]{3,16}$/, "java username"),
});

export const whitelistAddBedrockSchema = z.object({
  op: z.literal("whitelistAddBedrock"),
  requestId: z.string().min(8).max(64),
  gamertag: z.string().min(1).max(16).regex(GAMERTAG, "gamertag"),
  xuid: xuidSchema.optional(),
});

export const whitelistRemoveBedrockSchema = z.object({
  op: z.literal("whitelistRemoveBedrock"),
  requestId: z.string().min(8).max(64),
  gamertag: z.string().min(1).max(16).regex(GAMERTAG, "gamertag"),
  xuid: xuidSchema.optional(),
});

export const getWhitelistSchema = z.object({
  op: z.literal("getWhitelist"),
  requestId: z.string().min(8).max(64),
});

export const getPlaytimeSchema = z.object({
  op: z.literal("getPlaytime"),
  requestId: z.string().min(8).max(64),
  uuid: uuidSchema,
});

export const getOnlinePlayersSchema = z.object({
  op: z.literal("getOnlinePlayers"),
  requestId: z.string().min(8).max(64),
});

export const getStatusSchema = z.object({
  op: z.literal("getStatus"),
  requestId: z.string().min(8).max(64),
});

export const opsRequestSchema = z.discriminatedUnion("op", [
  whitelistAddJavaSchema,
  whitelistRemoveJavaSchema,
  whitelistAddBedrockSchema,
  whitelistRemoveBedrockSchema,
  getWhitelistSchema,
  getPlaytimeSchema,
  getOnlinePlayersSchema,
  getStatusSchema,
]);

export type OpsRequest = z.infer<typeof opsRequestSchema>;

export const whitelistEntrySchema = z.object({
  uuid: uuidSchema,
  name: z.string().min(1).max(32),
  edition: EditionEnum.optional(),
});

export const playtimeResponseSchema = z.object({
  uuid: uuidSchema,
  seconds: z.number().int().min(0),
  ticks: z.number().int().min(0),
  source: z.enum(["api", "file", "none"]),
});

export const onlinePlayersResponseSchema = z.object({
  players: z.array(playerRefSchema),
});

export const whitelistResponseSchema = z.object({
  entries: z.array(whitelistEntrySchema),
});

export const statusResponseSchema = z.object({
  ok: z.boolean(),
  online: z.number().int().min(0),
  max: z.number().int().min(0),
  version: z.string().max(120),
  whitelistEnabled: z.boolean(),
  enforceWhitelist: z.boolean(),
});

export const mutateResponseSchema = z.object({
  ok: z.boolean(),
  applied: z.boolean(),
  reason: z.string().max(300).nullish(),
});

export const pluginHealthSchema = z.object({
  ok: z.boolean(),
  plugin: z.string().max(60).optional(),
  minecraft: z.boolean().optional(),
  version: z.string().max(60).optional(),
});

export type WhitelistEntry = z.infer<typeof whitelistEntrySchema>;
export type PlaytimeResponse = z.infer<typeof playtimeResponseSchema>;
export type StatusResponse = z.infer<typeof statusResponseSchema>;
export type MutateResponse = z.infer<typeof mutateResponseSchema>;
