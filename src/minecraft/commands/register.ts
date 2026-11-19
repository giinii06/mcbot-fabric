import { ApplicationCommandOptionType } from "discord.js";
import { createPendingStore } from "../pending";
import { prepareRegistration, refreshDisplayName } from "../registration";
import { previewEmbed } from "../embeds";
import { confirmRow, displayNameOf, sendError, type CommandContext } from "../../discord/replies";
import type { CommandModule } from "./types";

/** Pending "which edition / confirm" flows for `/유저등록` (5 minute TTL). */
export const pendingRegistrations = createPendingStore();

/** Shown by `/유저등록베드락` now that the server only accepts Java Edition. */
export const BEDROCK_DISABLED_REASON =
  "이 서버는 Java Edition 전용으로 전환되었습니다. Bedrock 등록은 더 이상 지원하지 않습니다. `/유저등록`으로 Java 계정을 등록해 주세요.";

export const registerCommand: CommandModule = {
  name: "유저등록",
  description: "Java Edition 계정을 Discord 계정에 연결합니다.",
  ephemeral: true,
  options: [
    {
      type: ApplicationCommandOptionType.String,
      name: "마크아이디",
      description: "등록할 에디션의 Minecraft 아이디",
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

    const prepared = await prepareRegistration(services, {
      guildId,
      userId,
      displayName,
      input,
      edition: "JAVA",
    });
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

export const bedrockRegisterCommand: CommandModule = {
  name: "유저등록베드락",
  description: "이 서버는 Java 전용이라 Bedrock 등록을 지원하지 않습니다.",
  ephemeral: true,
  options: registerCommand.options,

  async execute({ interaction }: CommandContext) {
    // Keep the command registered so old Discord clients get a clear answer.
    // Never resolve identities, touch the bridge, or create pending state.
    await sendError(interaction, BEDROCK_DISABLED_REASON);
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