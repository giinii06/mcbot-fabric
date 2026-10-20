import { EmbedBuilder } from "discord.js";
import { formatDuration } from "../core/duration";
import { truncate, type DiscordDisplaySource } from "../core/user";
import type { PlayerRef, Edition } from "../bridge/protocol";
import advancementsKo from "./advancements.ko.json";

// Official Minecraft 26.3 ko_kr translations, indexed by advancement ID.
const KOREAN_ADVANCEMENTS: Record<string, { title: string; description: string }> = advancementsKo;

export const EMBED_COLORS = {
  JOIN: 0x57f287,
  QUIT: 0x99aab5,
  DEATH: 0xed4245,
  ADVANCEMENT: 0xfaa61a,
  REGISTRATION: 0x5865f2,
  UNREGISTRATION: 0x99aab5,
  SYSTEM: 0x7289da,
  SUCCESS: 0x57f287,
  ERROR: 0xed4245,
  INFO: 0x5865f2,
} as const;

export const EDITION_LABEL: Record<Edition, string> = {
  JAVA: "Java Edition",
  BEDROCK: "Bedrock Edition",
};

function base(color: number): EmbedBuilder {
  return new EmbedBuilder().setColor(color);
}

function discordPart(member: DiscordDisplaySource | null): string | null {
  const displayName = member?.displayName?.trim();
  if (displayName) return displayName;
  const globalName = member?.globalName?.trim();
  if (globalName) return globalName;
  const username = member?.user?.username?.trim();
  return username || null;
}

/** `Discord display name (Minecraft username)` - the only accepted format. */
export function playerLabel(member: DiscordDisplaySource | null, minecraftUsername: string): string {
  const discord = discordPart(member);
  const mc = minecraftUsername.trim();
  if (discord && mc && discord !== mc) return `${discord} (${mc})`;
  return discord ?? mc;
}

export function joinEmbed(player: PlayerRef, discord: DiscordDisplaySource | null): EmbedBuilder {
  return base(EMBED_COLORS.JOIN).setDescription(`**${playerLabel(discord, player.username)}** 님이 서버에 접속했습니다.`);
}

export function quitEmbed(player: PlayerRef, discord: DiscordDisplaySource | null): EmbedBuilder {
  return base(EMBED_COLORS.QUIT).setDescription(`**${playerLabel(discord, player.username)}** 님이 서버를 떠났습니다.`);
}

export interface DeathInput {
  player: PlayerRef;
  discord: DiscordDisplaySource | null;
  message: string | null;
  cause: string | null;
  killer: string | null;
  deathCount: number | null;
  ts: number;
}

/** In-game style Korean death lines, keyed by the plugin's lowercase DamageCause. */
const DEATH_CAUSE_KO: Record<string, (label: string, killer: string | null) => string> = {
  contact: (label) => `${label}이(가) 선인장에 찔려 죽었습니다`,
  entity_attack: (label, killer) =>
    killer ? `${label}이(가) ${killer}에 의해 살해되었습니다` : `${label}이(가) 공격을 받고 사망했습니다`,
  entity_sweep_attack: (label, killer) =>
    killer ? `${label}이(가) ${killer}에 의해 살해되었습니다` : `${label}이(가) 공격을 받고 사망했습니다`,
  projectile: (label, killer) =>
    killer ? `${label}이(가) ${killer}의 공격에 맞아 죽었습니다` : `${label}이(가) 투사체에 맞아 죽었습니다`,
  suffocation: (label) => `${label}이(가) 질식해 죽었습니다`,
  fall: (label) => `${label}이(가) 너무 높은 곳에서 떨어져 죽었습니다`,
  fire: (label) => `${label}이(가) 불타죽었습니다`,
  fire_tick: (label) => `${label}이(가) 불타죽었습니다`,
  melting: (label) => `${label}이(가) 녹아내려 죽었습니다`,
  lava: (label) => `${label}이(가) 용암에 빠져 죽었습니다`,
  drowning: (label) => `${label}이(가) 익사했습니다`,
  block_explosion: (label) => `${label}이(가) 폭발했습니다`,
  entity_explosion: (label) => `${label}이(가) 폭발했습니다`,
  void: (label) => `${label}이(가) 세계 밖으로 떨어져 죽었습니다`,
  lightning: (label) => `${label}이(가) 번개에 맞아 죽었습니다`,
  suicide: (label) => `${label}이(가) 스스로 목숨을 끊었습니다`,
  starve: (label) => `${label}이(가) 굶어 죽었습니다`,
  poison: (label) => `${label}이(가) 독에 중독되어 죽었습니다`,
  magic: (label) => `${label}이(가) 마법에 의해 죽었습니다`,
  wither: (label) => `${label}이(가) 위더에 걸려 죽었습니다`,
  falling_block: (label) => `${label}이(가) 떨어지는 블록에 깔려 죽었습니다`,
  falling_anvil: (label) => `${label}이(가) 떨어지는 블록에 깔려 죽었습니다`,
  thorns: (label) => `${label}이(가) 가시에 찔려 죽었습니다`,
  dragon_breath: (label) => `${label}이(가) 드래곤 숨결에 맞아 죽었습니다`,
  fly_into_wall: (label) => `${label}이(가) 벽에 부딪혀 죽었습니다`,
  hot_floor: (label) => `${label}이(가) 뜨거운 바닥에 구워 죽었습니다`,
  cramming: (label) => `${label}이(가) 너무 많은 개체로 목숨을 잃었습니다`,
  freeze: (label) => `${label}이(가) 얼어붙어 죽었습니다`,
  sonic_boom: (label) => `${label}이(가) 소나 충격파에 맞아 죽었습니다`,
  kill: (label) => `${label}이(가) 처형되었습니다`,
  world_border: (label) => `${label}이(가) 월드 보더 밖에서 사망했습니다`,
  dryout: (label) => `${label}이(가) 말라 죽었습니다`,
};

/** `기니 (giinii77) 이(가) 익사했습니다` - the in-game line, nickname swapped in. */
export function deathLine(input: DeathInput): string {
  const label = playerLabel(input.discord, input.player.username);
  // `기니 (giinii77)` already ends in a parenthesis - add the separator the
  // in-game message would get, but never for a bare Minecraft name.
  const subject = label.endsWith(")") ? `${label} ` : label;
  const killer = input.killer?.trim() || null;
  const build = input.cause ? DEATH_CAUSE_KO[input.cause] : undefined;
  return build ? build(subject, killer) : `${subject}이(가) 사망했습니다`;
}

export function deathEmbed(input: DeathInput): EmbedBuilder {
  const lines = [deathLine(input)];
  if (typeof input.deathCount === "number" && input.deathCount > 0) {
    lines.push(`${input.deathCount}번째로 죽으셨네요 으!!@!!`);
  }

  // Death payloads never carry coordinates / world / biome - enforced by the
  // payload schema on this side and by the plugin (strip component text).
  return base(EMBED_COLORS.DEATH).setDescription(lines.join("\n"));
}

export function advancementEmbed(
  player: PlayerRef,
  discord: DiscordDisplaySource | null,
  advancement: { key: string; title: string; description?: string | null },
): EmbedBuilder {
  const localized = Object.hasOwn(KOREAN_ADVANCEMENTS, advancement.key)
    ? KOREAN_ADVANCEMENTS[advancement.key]! : advancement;
  return base(EMBED_COLORS.ADVANCEMENT)
    .setDescription(`**${playerLabel(discord, player.username)}** 님이 도전과제를 달성했습니다.`)
    .addFields({ name: "도전과제", value: truncate(localized.title, 256) });
}

export function statusEmbed(
  status: "started" | "stopped",
  online: number,
  max: number,
  players: PlayerRef[],
): EmbedBuilder {
  const embed = base(EMBED_COLORS.SYSTEM).setDescription(
    status === "started" ? "서버가 시작되었습니다." : "서버가 종료되었습니다.",
  );
  embed.addFields({ name: "접속 중", value: `${online}명 / ${max}명`, inline: true });
  if (players.length > 0) {
    embed.addFields({
      name: "온라인",
      value: truncate(
        players
          .slice(0, 20)
          .map((p) => `${p.username} (${EDITION_LABEL[p.edition]})`)
          .join(", "),
        1024,
      ),
    });
  }
  return embed;
}

export function registrationEmbed(input: {
  discordName: string;
  minecraftUsername: string;
  edition: Edition;
  uuid: string;
  playtimeSeconds?: number;
}): EmbedBuilder {
  const embed = base(EMBED_COLORS.REGISTRATION)
    .setTitle("마인크래프트 등록 완료")
    .setDescription(`${input.discordName} 님의 Minecraft 계정이 등록되었습니다.`)
    .addFields(
      {
        name: "Minecraft",
        value: `${input.minecraftUsername} (${EDITION_LABEL[input.edition]})`,
        inline: true,
      },
      { name: "UUID", value: `\`${input.uuid}\``, inline: true },
    );
  if (input.playtimeSeconds !== undefined) {
    embed.addFields({ name: "누적 플레이타임", value: formatDuration(input.playtimeSeconds), inline: true });
  }
  return embed;
}

export function unregistrationEmbed(input: {
  discordName: string;
  minecraftUsername: string;
  edition: Edition;
  reason: string;
  forced: boolean;
}): EmbedBuilder {
  const embed = base(EMBED_COLORS.UNREGISTRATION)
    .setTitle(input.forced ? "마인크래프트 등록 강제 해제" : "마인크래프트 등록 해제")
    .setDescription(`${input.discordName} 님의 Minecraft 계정이 해제되었습니다.`)
    .addFields(
      {
        name: "Minecraft",
        value: `${input.minecraftUsername} (${EDITION_LABEL[input.edition]})`,
        inline: true,
      },
      { name: "사유", value: truncate(input.reason, 256), inline: true },
    );
  return embed;
}

export function previewEmbed(input: {
  discordName: string;
  minecraftUsername: string;
  edition: Edition;
  uuid: string;
}): EmbedBuilder {
  return base(EMBED_COLORS.INFO)
    .setTitle("마인크래프트 등록 확인")
    .setDescription("아래 정보가 맞는지 확인한 뒤 등록 버튼을 눌러 주세요.")
    .addFields(
      { name: "Discord 이름 (현재)", value: truncate(input.discordName, 256), inline: true },
      {
        name: "Minecraft 이름 (현재)",
        value: `${input.minecraftUsername} (${EDITION_LABEL[input.edition]})`,
        inline: true,
      },
      { name: "UUID", value: `\`${input.uuid}\``, inline: false },
    );
}

export function successEmbed(title: string, description: string): EmbedBuilder {
  return base(EMBED_COLORS.SUCCESS).setTitle(title).setDescription(truncate(description, 4000));
}

export function errorEmbed(reason: string): EmbedBuilder {
  return base(EMBED_COLORS.ERROR).setTitle("처리하지 못했습니다").setDescription(truncate(reason, 4000));
}

export function infoEmbed(
  title: string,
  description: string,
  fields: { name: string; value: string; inline?: boolean }[] = [],
): EmbedBuilder {
  const embed = base(EMBED_COLORS.INFO).setTitle(title).setDescription(truncate(description, 4000));
  for (const field of fields) {
    embed.addFields({ name: field.name, value: truncate(field.value, 1024), inline: field.inline ?? false });
  }
  return embed;
}

export interface LeaderboardRow {
  rank: number;
  label: string;
  seconds: number;
}

export function leaderboardEmbed(rows: LeaderboardRow[], page: number, totalPages: number): EmbedBuilder {
  const lines =
    rows.length === 0
      ? "등록된 사용자가 없습니다. `/유저등록`으로 먼저 등록해 주세요."
      : rows.map((row) => `**${row.rank}.** ${row.label} - ${formatDuration(row.seconds)}`).join("\n");

  return base(EMBED_COLORS.INFO)
    .setTitle("마인크래프트 플레이타임 리더보드")
    .setDescription(lines)
    .setFooter({ text: `페이지 ${page} / ${totalPages}` });
}
