import type { Edition } from "../bridge/protocol";
import { BridgeError } from "../bridge/client";
import type { Registration } from "../db/repositories";
import type { Services } from "../services";
import {
  IdentityLookupError,
  isBedrockUuid,
  validatePlayerInput,
  type IdentityCandidate,
  type IdentityResult,
} from "./identity";
import { registrationEmbed, unregistrationEmbed } from "./embeds";
import { playerLabel } from "./embeds";

export interface PrepareInput {
  guildId: string;
  userId: string;
  displayName: string;
  input: string;
  edition?: Edition;
}

export type PrepareResult =
  | { ok: true; identity: IdentityResult; candidates: IdentityCandidate[] }
  | { ok: false; reason: string };

export interface CommitInput {
  guildId: string;
  userId: string;
  displayName: string;
  candidate: IdentityCandidate;
}

export type CommitResult =
  | { ok: true; registration: Registration }
  | { ok: false; reason: string; stage: "duplicate" | "whitelist" | "database" };

export interface UnregisterInput {
  guildId: string;
  userId: string;
  actorId: string;
  forced?: boolean;
  reason: string;
}

export type UnregisterResult =
  | { ok: true; registration: Registration }
  | { ok: false; reason: string };

function limitReason(seconds: number): string {
  return `잠시 후 다시 시도해 주세요. (${seconds}초 후 가능)`;
}

/**
 * Step 1 of registration: validate, rate limit, resolve the identity and run
 * every duplicate check. Nothing is written yet.
 */
export async function prepareRegistration(services: Services, input: PrepareInput): Promise<PrepareResult> {
  const limiter = services.registrationLimiter;
  if (!limiter.hit(input.userId)) {
    return { ok: false, reason: limitReason(limiter.retryAfterSeconds(input.userId)) };
  }

  const validation = validatePlayerInput(input.input);
  if (!validation.ok) return { ok: false, reason: validation.reason };

  let identity: IdentityResult;
  try {
    identity = await services.identity.resolve(validation.value, input.edition);
  } catch (err) {
    if (err instanceof IdentityLookupError) return { ok: false, reason: err.message };
    return { ok: false, reason: "아이디 조회 중 오류가 발생했습니다." };
  }

  if (identity.status === "NONE") {
    const reason = `**${validation.value}** 계정을 찾을 수 없습니다. 아이디를 확인해 주세요.`;
    return {
      ok: false,
      reason: identity.bedrockCacheMiss
        ? `Geyser/Xbox 조회 서비스가 **${validation.value}** 계정을 확인하지 못했습니다. 계정이 없다는 뜻은 아닙니다.\nBedrock 앱에서 먼저 서버에 접속을 시도한 뒤, 30분 안에 /유저등록베드락으로 다시 등록해 주세요. 화이트리스트로 접속이 거절되어도 인증 정보는 확인됩니다.\nJava 계정에 연결해 사용하는 경우에는 /유저등록에 Java 게임 내 이름을 입력해 주세요.`
        : reason,
    };
  }

  const existing = services.repos.getRegistration(input.guildId, input.userId);
  if (existing) {
    return {
      ok: false,
      reason: `이미 등록되어 있습니다. (현재: ${existing.minecraftUsername} / ${existing.minecraftEdition})`,
    };
  }

  const candidates = services.identity.candidates(identity);
  for (const candidate of candidates) {
    const conflict = services.repos.findRegistrationByUuid(input.guildId, candidate.uuid);
    if (conflict && conflict.discordUserId !== input.userId) {
      return { ok: false, reason: "이미 다른 Discord 사용자가 등록한 Minecraft 아이디입니다." };
    }
  }

  return { ok: true, identity, candidates };
}

export async function whitelistAdd(
  services: Services,
  candidate: Pick<IdentityCandidate, "edition" | "uuid" | "username" | "xuid">,
): Promise<{ applied: boolean; reason?: string }> {
  const bridge = services.bridge;
  const response =
    candidate.edition === "JAVA"
      ? await bridge.addJava(candidate.uuid, candidate.username)
      : await bridge.addBedrock(candidate.username, candidate.xuid ?? undefined);
  return { applied: Boolean(response.applied), reason: response.reason ?? undefined };
}

export async function whitelistRemove(
  services: Services,
  candidate: Pick<IdentityCandidate, "edition" | "uuid" | "username" | "xuid">,
): Promise<{ applied: boolean; reason?: string }> {
  const bridge = services.bridge;
  const response =
    candidate.edition === "JAVA"
      ? await bridge.removeJava(candidate.uuid, candidate.username)
      : await bridge.removeBedrock(candidate.username, candidate.xuid ?? undefined);
  return { applied: Boolean(response.applied), reason: response.reason ?? undefined };
}

function candidateFromRegistration(reg: Registration): IdentityCandidate {
  return {
    edition: reg.minecraftEdition,
    uuid: reg.minecraftUuid,
    username: reg.minecraftUsername,
    xuid: reg.minecraftEdition === "BEDROCK" && isBedrockUuid(reg.minecraftUuid)
      ? BigInt(`0x${reg.minecraftUuid.replaceAll("-", "")}`).toString() : null,
  };
}

/**
 * Step 2 of registration: whitelist first, database second. A database failure
 * rolls the whitelist entry back so the two stores never disagree.
 */
export async function commitRegistration(services: Services, input: CommitInput): Promise<CommitResult> {
  const { guildId, userId, candidate } = input;
  const now = services.now();

  const existingUser = services.repos.getRegistration(guildId, userId);
  if (existingUser) {
    return { ok: false, reason: "이미 등록되어 있습니다.", stage: "duplicate" };
  }
  const existingUuid = services.repos.findRegistrationByUuid(guildId, candidate.uuid);
  if (existingUuid && existingUuid.discordUserId !== userId) {
    return { ok: false, reason: "이미 다른 Discord 사용자가 등록한 Minecraft 아이디입니다.", stage: "duplicate" };
  }

  try {
    const added = await whitelistAdd(services, candidate);
    if (!added.applied) {
      return {
        ok: false,
        reason: `Minecraft 화이트리스트 추가에 실패했습니다.${added.reason ? ` (${added.reason})` : ""}`,
        stage: "whitelist",
      };
    }
  } catch (err) {
    const message = err instanceof BridgeError ? err.message : "Minecraft 서버와 연결할 수 없습니다.";
    return { ok: false, reason: message, stage: "whitelist" };
  }

  const registration: Registration = {
    guildId,
    discordUserId: userId,
    discordDisplayName: input.displayName,
    minecraftUuid: candidate.uuid,
    minecraftUsername: candidate.username,
    minecraftEdition: candidate.edition,
    createdAt: now,
    updatedAt: now,
  };

  try {
    services.repos.insertRegistration(registration);
  } catch (err) {
    // unique constraint (race) - roll the whitelist entry back
    try {
      await whitelistRemove(services, candidate);
    } catch {
      services.log.error("whitelist rollback failed", {
        uuid: candidate.uuid,
        edition: candidate.edition,
      });
    }
    services.log.warn("registration insert failed", {
      guildId,
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: "저장 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", stage: "database" };
  }

  services.repos.addAudit(
    {
      guildId,
      action: "REGISTER",
      actorDiscordUserId: userId,
      targetDiscordUserId: userId,
      targetMinecraftUuid: candidate.uuid,
      detail: `${candidate.username} (${candidate.edition})`,
    },
    now,
  );

  await services.logChannels.send(guildId, [
    registrationEmbed({
      discordName: input.displayName,
      minecraftUsername: candidate.username,
      edition: candidate.edition,
      uuid: candidate.uuid,
    }),
  ]);

  return { ok: true, registration };
}

/**
 * Unregister: whitelist removal first, then the database row. A database
 * failure re-adds the whitelist entry (symmetric rollback).
 */
export async function unregister(services: Services, input: UnregisterInput): Promise<UnregisterResult> {
  const registration = services.repos.getRegistration(input.guildId, input.userId);
  if (!registration) {
    return { ok: false, reason: "등록된 Minecraft 계정이 없습니다." };
  }

  const candidate = candidateFromRegistration(registration);
  try {
    const removed = await whitelistRemove(services, candidate);
    if (!removed.applied) {
      return {
        ok: false,
        reason: `Minecraft 화이트리스트 제거에 실패했습니다.${removed.reason ? ` (${removed.reason})` : ""}`,
      };
    }
  } catch (err) {
    const message = err instanceof BridgeError ? err.message : "Minecraft 서버와 연결할 수 없습니다.";
    return { ok: false, reason: message };
  }

  let deleted = false;
  try {
    deleted = services.repos.deleteRegistration(input.guildId, input.userId);
  } catch (err) {
    services.log.error("registration delete failed", {
      guildId: input.guildId,
      userId: input.userId,
      error: err instanceof Error ? err.message : String(err),
    });
    deleted = false;
  }

  if (!deleted) {
    try {
      await whitelistAdd(services, candidate);
    } catch {
      services.log.error("whitelist restore failed", { uuid: candidate.uuid });
    }
    return { ok: false, reason: "저장 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." };
  }

  const member = await services.resolveMember(input.guildId, input.userId);
  const discordName = member?.displayName ?? member?.globalName ?? member?.user?.username ?? registration.discordDisplayName ?? input.userId;

  services.repos.addAudit(
    {
      guildId: input.guildId,
      action: input.forced ? "FORCE_UNREGISTER" : "UNREGISTER",
      actorDiscordUserId: input.actorId,
      targetDiscordUserId: input.userId,
      targetMinecraftUuid: registration.minecraftUuid,
      detail: `${registration.minecraftUsername} (${registration.minecraftEdition}) - ${input.reason}`,
    },
    services.now(),
  );

  await services.logChannels.send(input.guildId, [
    unregistrationEmbed({
      discordName,
      minecraftUsername: registration.minecraftUsername,
      edition: registration.minecraftEdition,
      reason: input.reason,
      forced: Boolean(input.forced),
    }),
  ]);

  return { ok: true, registration };
}

/** Keeps the stored Discord display name fresh whenever the member shows up. */
export function refreshDisplayName(services: Services, guildId: string, userId: string, displayName: string): void {
  if (!displayName) return;
  try {
    services.repos.updateRegistrationDisplay(guildId, userId, displayName, services.now());
  } catch (err) {
    services.log.warn("display name refresh failed", {
      guildId,
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function labelForRegistration(services: Services, reg: Registration): Promise<string> {
  return services
    .resolveMember(reg.guildId, reg.discordUserId)
    .then((member) => playerLabel(member, reg.minecraftUsername));
}

export type { Edition };
