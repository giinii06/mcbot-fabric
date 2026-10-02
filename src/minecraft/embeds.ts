import { EmbedBuilder } from "discord.js";
import { formatDuration } from "../core/duration";
import { truncate, type DiscordDisplaySource } from "../core/user";
import type { PlayerRef, Edition } from "../bridge/protocol";

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
  return new EmbedBuilder().setColor(color).setTimestamp(new Date());
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
  return base(EMBED_COLORS.JOIN)
    .setTitle("마인크래프트 접속")
    .setDescription(`**${playerLabel(discord, player.username)}** 님이 서버에 접속했습니다.`)
    .addFields({ name: "플랫폼", value: EDITION_LABEL[player.edition], inline: true });
}

export function quitEmbed(player: PlayerRef, discord: DiscordDisplaySource | null): EmbedBuilder {
  return base(EMBED_COLORS.QUIT)
    .setTitle("마인크래프트 퇴장")
    .setDescription(`**${playerLabel(discord, player.username)}** 님이 서버를 떠났습니다.`)
    .addFields({ name: "플랫폼", value: EDITION_LABEL[player.edition], inline: true });
}

export interface DeathInput {
  player: PlayerRef;
  discord: DiscordDisplaySource | null;
  message: string | null;
  cause: string | null;
  killer: string | null;
  ts: number;
}

export function deathEmbed(input: DeathInput): EmbedBuilder {
  const embed = base(EMBED_COLORS.DEATH)
    .setTitle("마인크래프트 사망")
    .setDescription(`**${playerLabel(input.discord, input.player.username)}** 님이 사망했습니다.`)
    .setTimestamp(new Date(input.ts));

  const details: string[] = [];
  if (input.cause) details.push(`원인: ${input.cause}`);
  if (input.killer) details.push(`처치: ${input.killer}`);
  if (details.length > 0) embed.addFields({ name: "상세", value: truncate(details.join(" · "), 1024) });

  // Death payloads never carry coordinates / world / biome - enforced by the
  // payload schema on this side and by the plugin (strip component text).
  if (input.message) embed.setFooter({ text: truncate(input.message, 200) });
  return embed;
}

export function advancementEmbed(
  player: PlayerRef,
  discord: DiscordDisplaySource | null,
  advancement: { key: string; title: string; description?: string | null },
): EmbedBuilder {
  const embed = base(EMBED_COLORS.ADVANCEMENT)
    .setTitle("도전과제 달성")
    .setDescription(`**${playerLabel(discord, player.username)}** 님이 도전과제를 달성했습니다.`)
    .addFields({ name: "도전과제", value: truncate(advancement.title, 256) });

  const description = advancement.description?.trim();
  if (description) embed.addFields({ name: "설명", value: truncate(description, 1024) });
  return embed;
}

export function statusEmbed(
  status: "started" | "stopped",
  online: number,
  max: number,
  players: PlayerRef[],
): EmbedBuilder {
  const embed = base(EMBED_COLORS.SYSTEM).setTitle(
    status === "started" ? "마인크래프트 서버 시작" : "마인크래프트 서버 종료",
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
