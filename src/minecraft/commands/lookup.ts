import { ApplicationCommandOptionType } from "discord.js";
import { formatDuration } from "../../core/duration";
import { playerLabel, infoEmbed } from "../embeds";
import { sendError } from "../../discord/replies";
import type { CommandModule } from "./types";

export const lookupCommand: CommandModule = {
  name: "유저조회",
  description: "등록된 Minecraft 계정 정보를 조회합니다.",
  admin: true,
  ephemeral: true,
  options: [
    {
      type: ApplicationCommandOptionType.User,
      name: "유저",
      description: "조회할 Discord 사용자 (생략 시 본인)",
      required: false,
    },
  ],

  async execute({ interaction, services }) {
    await interaction.deferReply({ ephemeral: true });
    const guildId = interaction.guildId;
    if (!guildId) {
      await sendError(interaction, "서버에서만 사용할 수 있습니다.");
      return;
    }

    const target = interaction.options.getUser("유저") ?? interaction.user;
    const registration = services.repos.getRegistration(guildId, target.id);
    if (!registration) {
      await sendError(interaction, "등록된 Minecraft 계정이 없습니다.");
      return;
    }

    const member = await services.resolveMember(guildId, target.id);
    const label = playerLabel(member, registration.minecraftUsername);

    let playtime = "조회 실패";
    try {
      const response = await services.bridge.getPlaytime(registration.minecraftUuid);
      playtime = formatDuration(response.seconds);
    } catch {
      playtime = "조회 실패";
    }

    let online = "확인 불가";
    try {
      const players = await services.bridge.getOnlinePlayers();
      online = players.some((p) => p.uuid === registration.minecraftUuid) ? "접속 중" : "접속하지 않음";
    } catch {
      online = "확인 불가";
    }

    await interaction.editReply({
      embeds: [
        infoEmbed("마인크래프트 유저 조회", `${label} 님의 등록 정보입니다.`, [
          { name: "Minecraft", value: registration.minecraftUsername, inline: true },
          { name: "에디션", value: registration.minecraftEdition, inline: true },
          { name: "UUID", value: `\`${registration.minecraftUuid}\``, inline: false },
          { name: "플레이타임", value: playtime, inline: true },
          { name: "접속 상태", value: online, inline: true },
          {
            name: "등록일",
            value: `<t:${Math.floor(registration.createdAt / 1000)}:d>`,
            inline: true,
          },
        ]),
      ],
    });
  },
};
