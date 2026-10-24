import { unregister, refreshDisplayName } from "../registration";
import { displayNameOf, sendError, sendSuccess } from "../../discord/replies";
import { editionOption, type CommandModule } from "./types";
import type { Edition } from "../../db/repositories";

export const unregisterCommand: CommandModule = {
  name: "유저해제",
  description: "본인의 Minecraft 계정 연결을 해제합니다.",
  ephemeral: true,
  options: [editionOption],

  async execute({ interaction, services }) {
    await interaction.deferReply({ ephemeral: true });
    const guildId = interaction.guildId;
    if (!guildId) {
      await sendError(interaction, "서버에서만 사용할 수 있습니다.");
      return;
    }

    const displayName = displayNameOf(interaction);
    refreshDisplayName(services, guildId, interaction.user.id, displayName);

    const result = await unregister(services, {
      guildId,
      userId: interaction.user.id,
      edition: interaction.options.getString("에디션", true) as Edition,
      actorId: interaction.user.id,
      reason: "본인 요청",
    });

    if (!result.ok) {
      await sendError(interaction, result.reason);
      return;
    }

    await sendSuccess(
      interaction,
      "등록이 해제되었습니다",
      `**${result.registration.minecraftUsername}** (${result.registration.minecraftEdition}) 계정 연결이 해제되었습니다.`,
    );
  },
};
