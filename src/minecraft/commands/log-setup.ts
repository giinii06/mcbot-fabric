import { infoEmbed, errorEmbed } from "../embeds";
import { sendError } from "../../discord/replies";
import type { CommandModule } from "./types";

export const logSetupCommand: CommandModule = {
  name: "마크로그설치",
  description: "현재 채널을 Minecraft 로그 채널로 지정합니다.",
  admin: true,

  async execute({ interaction, services }) {
    const guildId = interaction.guildId;
    const channelId = interaction.channelId;
    if (!guildId || !channelId) {
      await sendError(interaction, "채널에서만 사용할 수 있습니다.");
      return;
    }

    const previous = services.logChannels.get(guildId);
    services.logChannels.set(guildId, channelId);

    const delivered = await services.logChannels.send(guildId, [
      infoEmbed(
        "마인크래프트 로그 채널 설정 완료",
        `이 채널로 접속/퇴장/사망/도전과제/서버 상태 로그가 전송됩니다.\n채널: <#${channelId}>`,
      ),
    ]);

    if (!delivered) {
      if (previous) services.logChannels.set(guildId, previous);
      else services.logChannels.clear(guildId);
      await interaction.reply({
        embeds: [errorEmbed("채널에 메시지를 보낼 수 없습니다. 봇의 메시지 전송 권한을 확인해 주세요.")],
        ephemeral: true,
      });
      return;
    }

    services.repos.addAudit(
      {
        guildId,
        action: "LOG_CHANNEL_SET",
        actorDiscordUserId: interaction.user.id,
        targetDiscordUserId: null,
        targetMinecraftUuid: null,
        detail: channelId,
      },
      services.now(),
    );

    await interaction.reply({
      embeds: [
        infoEmbed("마인크래프트 로그 채널 설정", `<#${channelId}> 채널이 로그 채널로 지정되었습니다.`),
      ],
    });
  },
};
