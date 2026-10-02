import { syncWhitelist } from "../sync";
import { infoEmbed, errorEmbed } from "../embeds";
import { sendError } from "../../discord/replies";
import { truncate } from "../../core/user";
import type { CommandModule } from "./types";

export const whitelistSyncCommand: CommandModule = {
  name: "화이트리스트동기-sync",
  description: "Discord 등록 목록과 Minecraft 화이트리스트를 동기화합니다.",
  admin: true,
  ephemeral: true,

  async execute({ interaction, services }) {
    await interaction.deferReply({ ephemeral: true });
    const guildId = interaction.guildId;
    if (!guildId) {
      await sendError(interaction, "서버에서만 사용할 수 있습니다.");
      return;
    }

    const result = await syncWhitelist(services, guildId);

    if (!result.ok && result.added === 0 && result.removed === 0) {
      await interaction.editReply({
        embeds: [errorEmbed(result.reason ?? "동기화에 실패했습니다.")],
      });
      return;
    }

    const sections: string[] = [
      `추가 ${result.added}건 · 제거 ${result.removed}건 · 유지 ${result.unchanged}건`,
    ];
    if (result.addedEntries.length > 0) {
      sections.push(`**추가됨**\n${truncate(result.addedEntries.join("\n"), 900)}`);
    }
    if (result.removedEntries.length > 0) {
      sections.push(`**제거됨**\n${truncate(result.removedEntries.join("\n"), 900)}`);
    }
    if (result.failed.length > 0) {
      sections.push(`**실패**\n${truncate(result.failed.join("\n"), 900)}`);
    }

    services.repos.addAudit(
      {
        guildId,
        action: "WHITELIST_SYNC",
        actorDiscordUserId: interaction.user.id,
        targetDiscordUserId: null,
        targetMinecraftUuid: null,
        detail: `added=${result.added} removed=${result.removed} unchanged=${result.unchanged} failed=${result.failed.length}`,
      },
      services.now(),
    );

    await interaction.editReply({
      embeds: [
        infoEmbed(
          result.ok ? "화이트리스트 동기화 완료" : "화이트리스트 동기화 (일부 실패)",
          truncate(sections.join("\n\n"), 3900),
        ),
      ],
    });
  },
};
