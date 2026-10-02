import { mapWithConcurrency } from "../core/async";
import { playerLabel, type LeaderboardRow } from "./embeds";
import type { Services } from "../services";

export const LEADERBOARD_PAGE_SIZE = 10;

export interface LeaderboardEntry {
  rank: number;
  label: string;
  seconds: number;
  ticks: number;
  uuid: string;
  username: string;
  discordUserId: string;
}

export interface LeaderboardResult {
  entries: LeaderboardRow[];
  all: LeaderboardEntry[];
  page: number;
  totalPages: number;
  total: number;
}

export function sortLeaderboard(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  return entries.sort((a, b) => {
    if (b.seconds !== a.seconds) return b.seconds - a.seconds;
    if (b.ticks !== a.ticks) return b.ticks - a.ticks;
    const byName = a.username.localeCompare(b.username, "en", { sensitivity: "base" });
    if (byName !== 0) return byName;
    return a.uuid.localeCompare(b.uuid);
  });
}

export function paginate<T>(items: T[], page: number, pageSize: number): {
  slice: T[];
  page: number;
  totalPages: number;
} {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return { slice: items.slice(start, start + pageSize), page: safePage, totalPages };
}

/**
 * Playtime always comes from Minecraft (never from Discord): the plugin serves
 * it either from the live server statistic or from `world/stats/<uuid>.json`.
 */
export async function buildLeaderboard(
  services: Services,
  guildId: string,
  page = 1,
  pageSize = LEADERBOARD_PAGE_SIZE,
): Promise<LeaderboardResult> {
  const registrations = services.repos.listRegistrations(guildId);

  const playtimes = await mapWithConcurrency(registrations, 4, async (reg) => {
    try {
      const response = await services.bridge.getPlaytime(reg.minecraftUuid);
      return response.seconds;
    } catch {
      return 0;
    }
  });

  const entries: LeaderboardEntry[] = await mapWithConcurrency(registrations, 6, async (reg, index) => {
    const member = await services.resolveMember(guildId, reg.discordUserId);
    return {
      rank: 0,
      label: playerLabel(member, reg.minecraftUsername),
      seconds: playtimes[index] ?? 0,
      ticks: (playtimes[index] ?? 0) * 20,
      uuid: reg.minecraftUuid,
      username: reg.minecraftUsername,
      discordUserId: reg.discordUserId,
    };
  });

  const sorted = sortLeaderboard(entries);
  sorted.forEach((entry, index) => {
    entry.rank = index + 1;
  });

  const { slice, page: safePage, totalPages } = paginate(sorted, page, pageSize);

  return {
    entries: slice.map((e) => ({ rank: e.rank, label: e.label, seconds: e.seconds })),
    all: sorted,
    page: safePage,
    totalPages,
    total: sorted.length,
  };
}
