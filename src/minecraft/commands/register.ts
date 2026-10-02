import { ApplicationCommandOptionType } from "discord.js";
import { createPendingStore } from "../pending";
import { prepareRegistration, refreshDisplayName } from "../registration";
import { errorEmbed, infoEmbed, previewEmbed } from "../embeds";
import { confirmRow, displayNameOf, editionRow, sendError, type CommandContext } from "../../discord/replies";
import type { CommandModule } from "./types";

/** Pending "which edition / confirm" flows for `/유저등록` (5 minute TTL). */
export const pendingRegistrations = createPendingStore();

export const registerCommand: CommandModule = {
  name: "유저등록",
  description: "Minecraft 계정을 Discord 계정에 연결합니다.",
  ephemeral: true,
  options: [
    {
      type: ApplicationCommandOptionType.String,
      name: "마크아이디",
      description: "Minecraft 아이디 또는 Xbox gamertag",
      required: true,
    },
  ],

  async execute({ interaction, services }: CommandContext) {
    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    if (!guildId) {
      await sendError(interaction, "서버에서만 사용할 수 있습니다.");
      return;
    }

    const displayName = displayNameOf(interaction);
    const input = interaction.options.getString("마크아이디", true);
    refreshDisplayName(services, guildId, userId, displayName);

    const prepared = await prepareRegistration(services, { guildId, userId, displayName, input });
    if (!prepared.ok) {
      await sendError(interaction, prepared.reason);
      return;
    }

    const candidates = prepared.candidates;
    const first = candidates[0];
    if (!first) {
      await sendError(interaction, "등록할 수 없는 계정입니다.");
      return;
    }

    if (prepared.identity.status === "BOTH" && candidates.length > 1) {
      const pending = pendingRegistrations.put({
        guildId,
        userId,
        displayName,
        input: prepared.identity.input,
        candidates,
        chosen: null,
        identity: prepared.identity,
      });
      await interaction.editReply({
        embeds: [
          infoEmbed(
            "Minecraft 에디션을 선택해 주세요",
            "동일한 아이디로 Java와 Bedrock 계정이 모두 존재합니다. 사용할 에디션을 선택하면 등록 화면으로 이동합니다.",
            candidates.map((candidate) => ({
              name: candidate.edition === "JAVA" ? "Java Edition" : "Bedrock Edition",
              value: `${candidate.username} - \`${candidate.uuid}\``,
              inline: true,
            })),
          ),
        ],
        components: [editionRow(pending.token)],
      });
      return;
    }

    const pending = pendingRegistrations.put({
      guildId,
      userId,
      displayName,
      input: prepared.identity.input,
      candidates,
      chosen: first,
      identity: prepared.identity,
    });

    await interaction.editReply({
      embeds: [
        previewEmbed({
          discordName: displayName,
          minecraftUsername: first.username,
          edition: first.edition,
          uuid: first.uuid,
        }),
      ],
      components: [confirmRow(pending.token)],
    });
  },
};

/** Button step 2: an edition was picked for a "both editions exist" input. */
export function editionPreview(pendingToken: string, edition: "JAVA" | "BEDROCK") {
  const pending = pendingRegistrations.choose(pendingToken, edition);
  if (!pending) return null;
  const candidate = pending.chosen;
  if (!candidate) return null;
  return {
    embeds: [
      previewEmbed({
        discordName: pending.displayName,
        minecraftUsername: candidate.username,
        edition: candidate.edition,
        uuid: candidate.uuid,
      }),
    ],
    components: [confirmRow(pending.token)],
  };
}