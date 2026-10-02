import type { Database } from "bun:sqlite";
import type { Env } from "./env";
import type { Logger } from "./log";
import type { Repositories } from "./db/repositories";
import type { BridgeOps } from "./bridge/client";
import type { IdentityService } from "./minecraft/identity";
import type { RateLimiter } from "./core/rate-limit";
import type { LogChannelService } from "./minecraft/channels";
import type { MemberResolver } from "./minecraft/members";

/** Everything the command handlers and services are allowed to touch. */
export interface Services {
  env: Env;
  log: Logger;
  db: Database;
  repos: Repositories;
  bridge: BridgeOps;
  identity: IdentityService;
  registrationLimiter: RateLimiter;
  logChannels: LogChannelService;
  resolveMember: MemberResolver;
  now(): number;
}
