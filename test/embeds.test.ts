import { describe, expect, test } from "bun:test";
import type { PlayerRef } from "../src/bridge/protocol";
import type { DiscordDisplaySource } from "../src/core/user";
import { deathEmbed, deathLine, joinEmbed, quitEmbed, statusEmbed } from "../src/minecraft/embeds";

const PLAYER: PlayerRef = {
  uuid: "f642a5e3-d12f-4a7d-9c96-aef87fcf92be",
  username: "giinii77",
  edition: "JAVA",
  xuid: null,
};

const DISCORD: DiscordDisplaySource = { displayName: "기니", globalName: null, user: { username: "gini" } };

const DEATH = {
  player: PLAYER,
  discord: DISCORD,
  message: "giinii77 drowned",
  killer: null,
  deathCount: null as number | null,
  cause: null as string | null,
  ts: 1_700_000_000_000,
};

describe("joinEmbed", () => {
  test("is one line only - no title, no 플랫폼 field, no timestamp", () => {
    const embed = joinEmbed(PLAYER, DISCORD);
    expect(embed.data.description).toBe("**기니 (giinii77)** 님이 서버에 접속했습니다.");
    expect(embed.data.title).toBeUndefined();
    expect(embed.data.fields).toBeUndefined();
    expect(embed.data.timestamp).toBeUndefined();
  });

  test("quit is one line only", () => {
    const embed = quitEmbed(PLAYER, DISCORD);
    expect(embed.data.description).toBe("**기니 (giinii77)** 님이 서버를 떠났습니다.");
    expect(embed.data.title).toBeUndefined();
    expect(embed.data.fields).toBeUndefined();
    expect(embed.data.timestamp).toBeUndefined();
  });
});

describe("deathEmbed", () => {
  test("uses the in-game korean line plus the death count", () => {
    const embed = deathEmbed({ ...DEATH, cause: "drowning", deathCount: 3 });
    expect(embed.data.description).toBe("기니 (giinii77) 이(가) 익사했습니다\n3번째로 죽으셨네요 으!!@!!");
    expect(embed.data.title).toBeUndefined();
    expect(embed.data.fields).toBeUndefined();
    expect(embed.data.footer).toBeUndefined();
    expect(embed.data.timestamp).toBeUndefined();
  });

  test("omits the count line when the plugin sends none", () => {
    const embed = deathEmbed({ ...DEATH, cause: "fall", deathCount: null });
    expect(embed.data.description).toBe("기니 (giinii77) 이(가) 너무 높은 곳에서 떨어져 죽었습니다");
  });

  test("falls back to a generic line for unknown causes", () => {
    expect(deathLine({ ...DEATH, cause: "anything" })).toBe("기니 (giinii77) 이(가) 사망했습니다");
    expect(deathLine({ ...DEATH, cause: null })).toBe("기니 (giinii77) 이(가) 사망했습니다");
  });

  test("names the killer for pvp deaths", () => {
    expect(deathLine({ ...DEATH, cause: "entity_attack", killer: "griefer" })).toBe(
      "기니 (giinii77) 이(가) griefer에 의해 살해되었습니다",
    );
  });

  test("works without a linked discord member", () => {
    expect(deathLine({ ...DEATH, discord: null, cause: "lava" })).toBe("giinii77이(가) 용암에 빠져 죽었습니다");
  });
});

describe("statusEmbed", () => {
  test("has no title and no timestamp", () => {
    const embed = statusEmbed("started", 0, 1000, []);
    expect(embed.data.title).toBeUndefined();
    expect(embed.data.description).toBe("서버가 시작되었습니다.");
    expect(embed.data.timestamp).toBeUndefined();
    expect(embed.data.fields).toEqual([{ name: "접속 중", value: "0명 / 1000명", inline: true }]);
    expect(statusEmbed("stopped", 3, 1000, []).data.description).toBe("서버가 종료되었습니다.");
  });
});
