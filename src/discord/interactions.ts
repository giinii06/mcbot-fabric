import {
  PermissionFlagsBits,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
} from "discord.js";
import { createRateLimiter } from "../core/rate-limit";
import { commandRegistry } from "../minecraft/commands";
import { editionPreview, pendingRegistrations } from "../minecraft/commands/register";
import { commitRegistration, whitelistRemove } from "../minecraft/registration";
import { buildLeaderboard } from "../minecraft/leaderboard";
import { leaderboardEmbed, errorEmbed, successEmbed, infoEmbed } from "../minecraft/embeds";
import { leaderboardRow } from "./replies";
import type { Services } from "../services";

export interface RouterDeps {
  services: Services;
  /** 4 commands / 6s per user - keeps spammed chat commands bounded. */
  commandLimiter?: ReturnType<typeof createRateLimiter>;
}

function hasAdmin(interaction: Interaction): boolean {
  if (!interaction.inCachedGuild()) return false;
  return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.Administrator));
}

async function replyWith(interaction: ChatInputCommandInteraction, embeds: unknown[], ephemeral = true) {
  const payload = { embeds: embeds as never[] };
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
  } else {
    await interaction.reply({ ...payload, ephemeral });
  }
}

export function createInteractionRouter(deps: RouterDeps): (interaction: Interaction) => Promise<void> {
  const limiter = deps.commandLimiter ?? createRateLimiter(4, 6_000);
  const services = deps.services;

  const handleRegistrationButton = async (interaction: ButtonInteraction): Promise<void> => {
    const parts = interaction.customId.split(":");
    const [prefix, action, token, edition] = parts;
    if (prefix !== "mcreg" || !action || !token) return;

    if (action === "pick") {
      const payload = editionPreview(token, (edition as "JAVA" | "BEDROCK") ?? "JAVA");
      await interaction.deferUpdate();
      if (!payload) {
        await interaction
          .editReply({ embeds: [errorEmbed("만료된 요청입니다. 다시 `/유저등록`으로 시도해 주세요.")], components: [] })
          .catch(() => undefined);
        return;
      }
      await interaction.editReply(payload);
      return;
    }

    if (action === "no") {
      pendingRegistrations.commit(token);
      await interaction.deferUpdate();
      await interaction
        .editReply({ embeds: [infoEmbed("등록 취소", "등록을 취소했습니다.")], components: [] })
        .catch(() => undefined);
      return;
    }

    if (action === "go") {
      const pending = pendingRegistrations.commit(token);
      await interaction.deferUpdate();
      if (!pending || !pending.chosen) {
        await interaction
          .editReply({ embeds: [errorEmbed("만료된 요청입니다. 다시 `/유저등록`으로 시도해 주세요.")], components: [] })
          .catch(() => undefined);
        return;
      }
      if (interaction.user.id !== pending.userId) {
        await interaction
          .editReply({ embeds: [errorEmbed("본인의 등록 요청만 확인할 수 있습니다.")], components: [] })
          .catch(() => undefined);
        return;
      }

      const result = await commitRegistration(services, {
        guildId: pending.guildId,
        userId: pending.userId,
        displayName: pending.displayName,
        candidate: pending.chosen,
      });

      if (!result.ok) {
        await interaction
          .editReply({ embeds: [errorEmbed(result.reason)], components: [] })
          .catch(() => undefined);
        return;
      }

      await interaction
        .editReply({
          embeds: [
            successEmbed(
              "등록 완료",
              `**${pending.displayName}** → \`${result.registration.minecraftUsername}\` (${result.registration.minecraftEdition}) 연결이 완료되었습니다. 화이트리스트에 추가되었습니다.`,
            ),
          ],
          components: [],
        })
        .catch(() => undefined);
    }
  };

  const handleLeaderboardButton = async (interaction: ButtonInteraction): Promise<void> => {
    const parts = interaction.customId.split(":");
    const [prefix, guildId, pageRaw] = parts;
    if (prefix !== "mclb" || !guildId || !pageRaw) return;
    const page = Number.parseInt(pageRaw, 10);
    if (!Number.isFinite(page)) return;

    await interaction.deferUpdate();
    const result = await buildLeaderboard(services, guildId, page);
    await interaction
      .editReply({
        embeds: [leaderboardEmbed(result.entries, result.page, result.totalPages)],
        components: [leaderboardRow(guildId, result.page, result.totalPages)],
      })
      .catch(() => undefined);
  };

  return async (interaction: Interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        const module = commandRegistry.get(interaction.commandName);
        if (!module) return;

        if (module.admin && !hasAdmin(interaction)) {
          await interaction
            .reply({ embeds: [errorEmbed("이 명령은 관리자만 사용할 수 있습니다.")], ephemeral: true })
            .catch(() => undefined);
          return;
        }

        if (!limiter.hit(interaction.user.id)) {
          await interaction
            .reply({
              embeds: [errorEmbed(`잠시 후 다시 시도해 주세요. (${limiter.retryAfterSeconds(interaction.user.id)}초)`)],
              ephemeral: true,
            })
            .catch(() => undefined);
          return;
        }

        await module.execute({ interaction: interaction as ChatInputCommandInteraction, services });
        return;
      }

      if (interaction.isButton()) {
        const customId = interaction.customId;
        if (customId.startsWith("mcreg:")) {
          await handleRegistrationButton(interaction);
          return;
        }
        if (customId.startsWith("mclb:")) {
          await handleLeaderboardButton(interaction);
        }
      }
    } catch (err) {
      services.log.error("interaction failed", {
        type: interaction.type,
        error: err instanceof Error ? err.message : String(err),
      });
      const chat = interaction as ChatInputCommandInteraction;
      if (typeof chat.editReply === "function" && (chat.deferred || chat.replied)) {
        await chat
          .editReply({ embeds: [errorEmbed("처리 중 오류가 발생했습니다.")], components: [] })
          .catch(() => undefined);
      } else if (typeof chat.reply === "function" && !chat.replied) {
        await chat
          .reply({ embeds: [errorEmbed("처리 중 오류가 발생했습니다.")], ephemeral: true })
          .catch(() => undefined);
      }
    }
  };
}

// re-exported so tests can exercise the rollback helper directly
export { whitelistRemove };
