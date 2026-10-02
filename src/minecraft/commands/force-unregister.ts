import { ApplicationCommandOptionType } from "discord.js";
import { unregister } from "../registration";
import { playerLabel } from "../embeds";
import { sendError, sendSuccess } from "../../discord/replies";
import type { CommandModule } from "./types";

export const forceUnregisterCommand: CommandModule = {
  name: "유저강제해제",
  description: "관리자가 다른 사용자의 Minecraft 계정 연결을 해제합니다.",
  admin: true,
  ephemeral: true,
  options: [
    {
      type: ApplicationCommandOptionType.User,
      name: "유저",
      description: "연결을 해제할 Discord 사용자",
      required: true,
    },
  ],

  async execute({ interaction, services }) {
    await interaction.deferReply({ ephemeral: true });
    const guildId = interaction.guildId;
    if (!guildId) {
      await sendError(interaction, "서버에서만 사용할 수 있습니다.");
      return;
    }

    const target = interaction.options.getUser("유저", true);
    const registration = services.repos.getRegistration(guildId, target.id);
    if (!registration) {
      await sendError(interaction, "해당 사용자는 등록된 Minecraft 계정이 없습니다.");
      return;
    }

    const member = await services.resolveMember(guildId, target.id);
    const label = playerLabel(member, registration.minecraftUsername);

    const result = await unregister(services, {
      guildId,
      userId: target.id,
      actorId: interaction.user.id,
      forced: true,
      reason: "관리자 강제 해제",
    });

    if (!result.ok) {
      await sendError(interaction, result.reason);
      return;
    }

    await sendSuccess(
      interaction,
      "강제 해제 완료",
      `${label} 님의 연결이 해제되었습니다. (실행자: ${interaction.user.username})`,
    );
  },
};
