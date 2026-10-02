import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type Interaction,
} from "discord.js";
import { errorEmbed, successEmbed } from "../minecraft/embeds";
import type { Services } from "../services";

export const ADMIN_PERMISSIONS = PermissionFlagsBits.Administrator;

export function displayNameOf(interaction: Interaction): string {
  if (interaction.inCachedGuild()) {
    const member = interaction.member;
    return member.displayName || member.user.username;
  }
  if (interaction.user) return interaction.user.globalName || interaction.user.username;
  return "unknown";
}

export function isAdmin(interaction: Interaction): boolean {
  if (!interaction.inCachedGuild()) return false;
  return Boolean(interaction.memberPermissions?.has(ADMIN_PERMISSIONS));
}

export async function sendError(interaction: ChatInputCommandInteraction, reason: string): Promise<void> {
  const embed = errorEmbed(reason);
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ embeds: [embed], components: [] });
  } else {
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

export async function sendSuccess(
  interaction: ChatInputCommandInteraction,
  title: string,
  description: string,
): Promise<void> {
  const embed = successEmbed(title, description);
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ embeds: [embed], components: [] });
  } else {
    await interaction.reply({ embeds: [embed] });
  }
}

export function confirmRow(token: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`mcreg:go:${token}`).setLabel("등록").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`mcreg:no:${token}`).setLabel("취소").setStyle(ButtonStyle.Secondary),
  );
}

export function editionRow(token: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`mcreg:pick:${token}:JAVA`).setLabel("Java Edition").setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`mcreg:pick:${token}:BEDROCK`)
      .setLabel("Bedrock Edition")
      .setStyle(ButtonStyle.Primary),
  );
}

export function leaderboardRow(guildId: string, page: number, totalPages: number): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (page > 1) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`mclb:${guildId}:${page - 1}`).setLabel("◀ 이전").setStyle(ButtonStyle.Secondary),
    );
  }
  if (page < totalPages) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`mclb:${guildId}:${page + 1}`).setLabel("다음 ▶").setStyle(ButtonStyle.Secondary),
    );
  }
  if (row.components.length === 0) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`mclb:${guildId}:${page}`).setLabel("최신화").setStyle(ButtonStyle.Secondary),
    );
  }
  return row;
}

export interface CommandContext {
  interaction: ChatInputCommandInteraction;
  services: Services;
}
