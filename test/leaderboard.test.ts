import { describe, expect, test } from "bun:test";
import { buildLeaderboard, paginate, sortLeaderboard, type LeaderboardEntry } from "../src/minecraft/leaderboard";
import { GUILD, JAVA_UUID, createFakeBridge, createTestServices, seedRegistration } from "./helpers";

function entry(partial: Partial<LeaderboardEntry> & { username: string; uuid: string }): LeaderboardEntry {
  return {
    rank: 0,
    label: partial.username,
    seconds: 0,
    ticks: 0,
    discordUserId: "1",
    ...partial,
  };
}

describe("sortLeaderboard", () => {
  test("orders by seconds desc", () => {
    const sorted = sortLeaderboard([
      entry({ username: "a", uuid: "u1", seconds: 10 }),
      entry({ username: "b", uuid: "u2", seconds: 100 }),
      entry({ username: "c", uuid: "u3", seconds: 50 }),
    ]);
    expect(sorted.map((e) => e.username)).toEqual(["b", "c", "a"]);
  });

  test("breaks ties with ticks, then username, then uuid", () => {
    const sorted = sortLeaderboard([
      entry({ username: "b", uuid: "u2", seconds: 10, ticks: 200 }),
      entry({ username: "a", uuid: "u9", seconds: 10, ticks: 200 }),
      entry({ username: "a", uuid: "u1", seconds: 10, ticks: 200 }),
      entry({ username: "b", uuid: "u1", seconds: 10, ticks: 400 }),
    ]);
    expect(sorted.map((e) => `${e.username}:${e.uuid}:${e.ticks}`)).toEqual([
      "b:u1:400",
      "a:u1:200",
      "a:u9:200",
      "b:u2:200",
    ]);
  });

  test("is case insensitive for the username", () => {
    const sorted = sortLeaderboard([
      entry({ username: "Bob", uuid: "u2", seconds: 5 }),
      entry({ username: "alice", uuid: "u1", seconds: 5 }),
    ]);
    expect(sorted.map((e) => e.username)).toEqual(["alice", "Bob"]);
  });
});

describe("paginate", () => {
  test("slices pages and clamps the requested page", () => {
    const items = Array.from({ length: 25 }, (_, i) => i);
    expect(paginate(items, 1, 10).slice).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(paginate(items, 3, 10).slice).toEqual([20, 21, 22, 23, 24]);
    expect(paginate(items, 99, 10).page).toBe(3);
    expect(paginate(items, -5, 10).page).toBe(1);
    expect(paginate(items, 1, 10).totalPages).toBe(3);
    expect(paginate([], 1, 10)).toEqual({ slice: [], page: 1, totalPages: 1 });
  });
});

describe("buildLeaderboard", () => {
  function seed(harness: ReturnType<typeof createTestServices>, secondsByUuid: Record<string, number>) {
    Object.entries(secondsByUuid).forEach(([uuid, seconds], index) => {
      harness.repos.insertRegistration(
        seedRegistration({
          guildId: GUILD,
          discordUserId: `user-${index}`,
          minecraftUuid: uuid,
          minecraftUsername: `player${index}`,
          discordDisplayName: `Discord${index}`,
          createdAt: index,
        }),
      );
    });
    harness.bridge.getPlaytime = async (uuid) => ({
      uuid,
      seconds: secondsByUuid[uuid] ?? 0,
      ticks: (secondsByUuid[uuid] ?? 0) * 20,
      source: "file",
    });
    harness.members.set("user-0", { displayName: "Zero", globalName: null, user: { username: "zero" } });
  }

  test("sorts by playtime and paginates", async () => {
    const harness = createTestServices({ bridge: createFakeBridge() });
    const seconds: Record<string, number> = {};
    for (let i = 0; i < 12; i++) {
      seconds[`uuid-${i}`] = (i + 1) * 100;
    }
    seed(harness, seconds);

    const page1 = await buildLeaderboard(harness.services, GUILD, 1);
    expect(page1.total).toBe(12);
    expect(page1.totalPages).toBe(2);
    expect(page1.page).toBe(1);
    expect(page1.entries).toHaveLength(10);
    expect(page1.entries[0]?.rank).toBe(1);
    expect(page1.entries[0]?.seconds).toBe(1200);
    expect(page1.entries[9]?.seconds).toBe(300);

    const page2 = await buildLeaderboard(harness.services, GUILD, 2);
    expect(page2.entries).toHaveLength(2);
    expect(page2.entries[0]?.rank).toBe(11);
    expect(page2.entries[0]?.seconds).toBe(200);
    expect(page2.page).toBe(2);
  });

  test("uses the discord display name when available", async () => {
    const harness = createTestServices({ bridge: createFakeBridge() });
    seed(harness, { [JAVA_UUID]: 500 });
    const result = await buildLeaderboard(harness.services, GUILD, 1);
    expect(result.entries[0]?.label).toBe("Zero (player0)");
  });

  test("a failing playtime lookup counts as zero instead of failing the command", async () => {
    const harness = createTestServices({ bridge: createFakeBridge() });
    seed(harness, { [JAVA_UUID]: 500 });
    harness.bridge.getPlaytime = async () => {
      throw new Error("minecraft offline");
    };
    const result = await buildLeaderboard(harness.services, GUILD, 1);
    expect(result.total).toBe(1);
    expect(result.entries[0]?.seconds).toBe(0);
  });

  test("an empty guild still returns a valid page", async () => {
    const harness = createTestServices({ bridge: createFakeBridge() });
    const result = await buildLeaderboard(harness.services, GUILD, 1);
    expect(result.entries).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.totalPages).toBe(1);
    expect(result.page).toBe(1);
  });
});
