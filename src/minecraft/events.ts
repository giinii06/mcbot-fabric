import type { InboundEvent, PlayerRef } from "../bridge/protocol";
import type { Registration } from "../db/repositories";
import type { Services } from "../services";
import { escapeMarkdown } from "discord.js";
import { truncate } from "../core/user";
import { advancementEmbed, deathEmbed, joinEmbed, playerLabel, quitEmbed } from "./embeds";

type GuildTargets = Map<string, Registration | null>;

/**
 * Routes a Minecraft event to the Discord guild(s) that should see it.
 * Players are matched by UUID (never by username); unregistered players are
 * still logged, just without a Discord name.
 */
async function resolveTargets(services: Services, player: PlayerRef | null): Promise<GuildTargets> {
  const targets: GuildTargets = new Map();

  if (player) {
    const registrations = services.repos.findRegistrationsByUuid(player.uuid);
    for (const reg of registrations) {
      if (!targets.has(reg.guildId)) targets.set(reg.guildId, reg);
    }
    if (targets.size > 0) return targets;
  }

  for (const guildId of services.logChannels.guildsWithChannel()) {
    if (!targets.has(guildId)) targets.set(guildId, null);
  }
  return targets;
}

async function memberFor(
  services: Services,
  guildId: string,
  reg: Registration | null,
): Promise<Awaited<ReturnType<Services["resolveMember"]>>> {
  if (!reg) return null;
  return services.resolveMember(guildId, reg.discordUserId);
}

export async function handleBridgeEvent(services: Services, event: InboundEvent): Promise<void> {
  if (event.type === "server.status") {
    return;
  }

  const targets = await resolveTargets(services, event.player);
  if (targets.size === 0) return;

  for (const [guildId, reg] of targets) {
    const member = await memberFor(services, guildId, reg);

    switch (event.type) {
      case "player.chat":
        await services.logChannels.send(guildId, truncate(
          `**${escapeMarkdown(playerLabel(member, event.player.username))}**: ${escapeMarkdown(event.message)}`, 2000,
        ));
        break;
      case "player.join":
        await services.logChannels.send(guildId, [joinEmbed(event.player, member)]);
        break;
      case "player.quit":
        await services.logChannels.send(guildId, [quitEmbed(event.player, member)]);
        break;
      case "player.death":
        await services.logChannels.send(guildId, [
          deathEmbed({
            player: event.player,
            discord: member,
            message: event.message ?? null,
            cause: event.cause ?? null,
            killer: event.killer ?? null,
            deathCount: event.deathCount ?? null,
            ts: event.ts,
          }),
        ]);
        break;
      case "player.advancement":
        await services.logChannels.send(guildId, [
          advancementEmbed(event.player, member, {
            key: event.advancement.key,
            title: event.advancement.title,
            description: event.advancement.description ?? null,
          }),
        ]);
        break;
      default:
        break;
    }
  }
}
