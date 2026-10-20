import { Database } from "bun:sqlite";
import { createMemoryLogger } from "../src/log";
import { loadEnv } from "../src/env";
import { openDatabase } from "../src/db/database";
import { createRepositories, type Registration, type Repositories } from "../src/db/repositories";
import { createRateLimiter, type RateLimiter } from "../src/core/rate-limit";
import { BridgeError, type BridgeOps, type FetchLike } from "../src/bridge/client";
import { IdentityService, type IdentityServiceOptions } from "../src/minecraft/identity";
import type { Services } from "../src/services";
import type { LogChannelService } from "../src/minecraft/channels";
import type { MemberResolver } from "../src/minecraft/members";

export const GUILD = "111111111111111111";
export const OTHER_GUILD = "222222222222222222";
export const USER = "333333333333333333";
export const OTHER_USER = "444444444444444444";
export const JAVA_UUID = "069a79f4-44e9-4726-a5be-ca90e38aaf51";
export const JAVA_NAME = "Notch";
export const BEDROCK_XUID = "2535453759792258";
export const BEDROCK_UUID = "00000000-0000-0000-0009-01fb54b26482";
export const BEDROCK_GAMERTAG = "Bedrock Kid";

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Records every bridge call so tests can assert ordering and rollbacks. */
export interface FakeBridge extends BridgeOps {
  calls: { op: string; payload: Record<string, unknown> }[];
}

export interface FakeBridgeOptions {
  applied?: boolean;
  failWith?: Error;
}

export function createFakeBridge(options: FakeBridgeOptions = {}): FakeBridge {
  const calls: FakeBridge["calls"] = [];
  const applied = options.applied ?? true;

  const record = (op: string, payload: Record<string, unknown>): void => {
    calls.push({ op, payload });
  };
  const fail = (op: string, payload: Record<string, unknown>): void => {
    record(op, payload);
    if (options.failWith) throw options.failWith;
  };

  return {
    calls,
    isHealthy: () => true,
    health: async () => true,
    async getWhitelist() {
      record("getWhitelist", {});
      return [];
    },
    async addJava(uuid, username) {
      fail("whitelistAddJava", { uuid, username });
      return { ok: true, applied, ...(applied ? {} : { reason: "rejected by server" }) };
    },
    async removeJava(uuid, username) {
      fail("whitelistRemoveJava", { uuid, username });
      return { ok: true, applied, ...(applied ? {} : { reason: "rejected by server" }) };
    },
    async addBedrock(gamertag, xuid) {
      fail("whitelistAddBedrock", { gamertag, xuid });
      return { ok: true, applied, ...(applied ? {} : { reason: "rejected by server" }) };
    },
    async removeBedrock(gamertag, xuid) {
      fail("whitelistRemoveBedrock", { gamertag, xuid });
      return { ok: true, applied, ...(applied ? {} : { reason: "rejected by server" }) };
    },
    async getPlaytime(uuid) {
      record("getPlaytime", { uuid });
      return { uuid, seconds: 0, ticks: 0, source: "none" };
    },
    async getOnlinePlayers() {
      record("getOnlinePlayers", {});
      return [];
    },
    async getStatus() {
      record("getStatus", {});
      return { ok: true, online: 0, max: 20, version: "test", whitelistEnabled: true, enforceWhitelist: true };
    },
    lastError: null,
  };
}

export interface TestServices {
  services: Services;
  db: Database;
  repos: Repositories;
  bridge: FakeBridge;
  log: ReturnType<typeof createMemoryLogger>;
  sent: { guildId: string; embeds: number }[];
  members: Map<string, { displayName?: string | null; globalName?: string | null; user?: { username?: string | null } } | null>;
  identityFetches: string[];
}

export interface TestServicesOptions {
  bridge?: FakeBridge;
  identity?: IdentityServiceOptions;
  limiter?: RateLimiter;
  now?: () => number;
}

export function createTestServices(options: TestServicesOptions = {}): TestServices {
  const db = openDatabase(":memory:");
  const repos = createRepositories(db);
  const log = createMemoryLogger();
  const env = loadEnv({ MC_BRIDGE_SECRET: "s".repeat(32), SQLITE_PATH: ":memory:" });
  const bridge = options.bridge ?? createFakeBridge();
  const sent: TestServices["sent"] = [];
  const members: TestServices["members"] = new Map();
  const identityFetches: string[] = [];

  const logChannels: LogChannelService = {
    get: () => null,
    set: () => undefined,
    clear: () => undefined,
    async send(guildId, message) {
      sent.push({ guildId, embeds: typeof message === "string" ? 0 : message.length });
      return true;
    },
    guildsWithChannel: () => repos.listConfiguredLogGuilds(),
  };

  const resolveMember: MemberResolver = async (_guildId, userId) =>
    members.has(userId) ? (members.get(userId) ?? null) : { displayName: "DiscordUser", globalName: null, user: { username: "discorduser" } };

  const fetchImpl: FetchLike = async (input, init) => {
    const url = String(input);
    identityFetches.push(url);
    const custom = options.identity?.fetchImpl;
    if (custom) return custom(input, init);
    return jsonResponse({}, 404);
  };

  const identity = new IdentityService({ ...options.identity, fetchImpl });

  const services: Services = {
    env,
    log,
    db,
    repos,
    bridge,
    identity,
    registrationLimiter: options.limiter ?? createRateLimiter(3, 6_000),
    logChannels,
    resolveMember,
    now: options.now ?? (() => 1_700_000_000_000),
  };

  return { services, db, repos, bridge, log, sent, members, identityFetches };
}

export function seedRegistration(reg: Partial<Registration> & { guildId: string; discordUserId: string }): Registration {
  return {
    discordDisplayName: "DiscordUser",
    minecraftUuid: JAVA_UUID,
    minecraftUsername: JAVA_NAME,
    minecraftEdition: "JAVA",
    createdAt: 1,
    updatedAt: 1,
    ...reg,
  };
}

export function bridgeDown(): Error {
  return new BridgeError("connect ECONNREFUSED", undefined, "whitelistAddJava");
}
