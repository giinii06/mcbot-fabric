import { BridgeError } from "../bridge/client";
import type { WhitelistEntry } from "../bridge/protocol";
import { isBedrockUuid } from "./identity";
import type { Services } from "../services";
import type { IdentityCandidate } from "./identity";

export interface SyncResult {
  ok: boolean;
  reason?: string;
  added: number;
  removed: number;
  unchanged: number;
  addedEntries: string[];
  removedEntries: string[];
  failed: string[];
}

function candidateFromEntry(entry: WhitelistEntry): IdentityCandidate | null {
  if (!/^[A-Za-z0-9_]{3,16}$/.test(entry.name)) return null;
  return { edition: "JAVA", uuid: entry.uuid, username: entry.name, xuid: null };
}

function describe(entry: WhitelistEntry): string {
  return `${entry.name} (${entry.uuid})`;
}

/**
 * Reconciles Java registrations (source of truth) with the Minecraft
 * whitelist: missing entries are added, whitelist-only entries are removed.
 */
export async function syncWhitelist(services: Services, guildId: string): Promise<SyncResult> {
  const result: SyncResult = {
    ok: true,
    added: 0,
    removed: 0,
    unchanged: 0,
    addedEntries: [],
    removedEntries: [],
    failed: [],
  };

  let entries: WhitelistEntry[];
  try {
    entries = (await services.bridge.getWhitelist()).filter((entry) =>
      !isBedrockUuid(entry.uuid) && !entry.name.startsWith("."));
  } catch (err) {
    const message = err instanceof BridgeError ? err.message : "Minecraft 서버와 연결할 수 없습니다.";
    return { ...result, ok: false, reason: message };
  }

  const registrations = services.repos.listRegistrations(guildId).filter((reg) => reg.minecraftEdition === "JAVA");
  const byUuid = new Map(entries.map((entry) => [entry.uuid.toLowerCase(), entry]));
  const registrationUuids = new Set(registrations.map((r) => r.minecraftUuid.toLowerCase()));

  for (const reg of registrations) {
    if (byUuid.has(reg.minecraftUuid.toLowerCase())) {
      result.unchanged += 1;
      continue;
    }
    try {
      const response = await services.bridge.addJava(reg.minecraftUuid, reg.minecraftUsername);
      if (response.applied) {
        result.added += 1;
        result.addedEntries.push(`${reg.minecraftUsername} (${reg.minecraftEdition})`);
      } else {
        result.failed.push(
          `추가 실패: ${reg.minecraftUsername}${response.reason ? ` - ${response.reason}` : ""}`,
        );
      }
    } catch (err) {
      result.failed.push(`추가 실패: ${reg.minecraftUsername} - ${err instanceof Error ? err.message : "오류"}`);
    }
  }

  for (const entry of entries) {
    if (registrationUuids.has(entry.uuid.toLowerCase())) continue;
    const candidate = candidateFromEntry(entry);
    if (!candidate) {
      result.failed.push(`제거 불가(알 수 없는 형식): ${describe(entry)}`);
      continue;
    }
    try {
      const response = await services.bridge.removeJava(candidate.uuid, candidate.username);
      if (response.applied) {
        result.removed += 1;
        result.removedEntries.push(describe(entry));
      } else {
        result.failed.push(
          `제거 실패: ${describe(entry)}${response.reason ? ` - ${response.reason}` : ""}`,
        );
      }
    } catch (err) {
      result.failed.push(`제거 실패: ${describe(entry)} - ${err instanceof Error ? err.message : "오류"}`);
    }
  }

  result.ok = result.failed.length === 0;
  return result;
}
