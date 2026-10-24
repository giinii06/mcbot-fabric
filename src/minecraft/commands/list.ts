import { mapWithConcurrency } from "../../core/async";
import { truncate } from "../../core/user";
import { playerLabel, infoEmbed } from "../embeds";
import { sendError } from "../../discord/replies";
import type { CommandModule } from "./types";

const MAX_ROWS = 20;

export const listCommand: CommandModule = {
  name: "유저목록",
  description: "서버에 등록된 Minecraft 계정 목록을 보여줍니다.",
  admin: true,
  ephemeral: true,

  async execute({ interaction, services }) {
    await interaction.deferReply({ ephemeral: true });
    const guildId = interaction.guildId;
    if (!guildId) {
      await sendError(interaction, "서버에서만 사용할 수 있습니다.");
      return;
    }

    const registrations = services.repos.listRegistrations(guildId);
    if (registrations.length === 0) {
      await interaction.editReply({
        embeds: [infoEmbed("마인크래프트 유저 목록", "등록된 사용자가 없습니다.")],
      });
      return;
    }

    const visible = registrations.slice(0, MAX_ROWS);
    const labels = await mapWithConcurrency(visible, 6, (reg) =>
      services.resolveMember(guildId, reg.discordUserId).then((member) => playerLabel(member, reg.minecraftUsername)),
    );

    const lines = visible.map((reg, index) => {
      const label = labels[index] ?? reg.minecraftUsername;
      const edition = reg.minecraftEdition === "JAVA" ? "Java" : "Bedrock";
      return `**${index + 1}.** ${label} - ${edition} - <t:${Math.floor(reg.createdAt / 1000)}:d>`;
    });

    const rest = registrations.length - visible.length;
    const suffix = rest > 0 ? `\n\n… 외 ${rest}개 계정` : "";

    await interaction.editReply({
      embeds: [
        infoEmbed(
          "마인크래프트 유저 목록",
          truncate(`${lines.join("\n")}${suffix}`, 3900),
          [{ name: "총 등록", value: `${registrations.length}개 계정`, inline: true }],
        ),
      ],
    });
  },
};
