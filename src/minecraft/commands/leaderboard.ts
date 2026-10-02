import { buildLeaderboard } from "../leaderboard";
import { leaderboardEmbed } from "../embeds";
import { leaderboardRow, sendError } from "../../discord/replies";
import type { CommandModule } from "./types";

export const leaderboardCommand: CommandModule = {
  name: "마크리더보드",
  description: "Minecraft 누적 플레이타임 리더보드를 보여줍니다.",

  async execute({ interaction, services }) {
    await interaction.deferReply();
    const guildId = interaction.guildId;
    if (!guildId) {
      await sendError(interaction, "서버에서만 사용할 수 있습니다.");
      return;
    }

    const result = await buildLeaderboard(services, guildId, 1);
    await interaction.editReply({
      embeds: [leaderboardEmbed(result.entries, result.page, result.totalPages)],
      components: [leaderboardRow(guildId, result.page, result.totalPages)],
    });
  },
};
