import type { InboundEvent, PlayerRef } from "../bridge/protocol";
import type { Registration } from "../db/repositories";
import type { Services } from "../services";
import { escapeMarkdown } from "discord.js";
import { truncate } from "../core/user";
import { advancementEmbed, deathEmbed, joinEmbed, playerLabel, quitEmbed } from "./embeds";

type GuildTargets = Map<string, Registration | null>;
const PRIVATE_LOG_GUILD = "1214203256620847124";

/**
 * Broadcasts Minecraft events to every guild with a configured log channel.
 * Players are matched by UUID (never by username); unregistered players are
 * still logged, using a registered guild's Discord name when available.
 * Players registered in PRIVATE_LOG_GUILD are logged only in that guild.
 */
async function resolveTargets(services: Services, player: PlayerRef | null): Promise<GuildTargets> {
  const targets: GuildTargets = new Map();

  for (const guildId of services.logChannels.guildsWithChannel()) {
    targets.set(guildId, null);
  }

  if (player) {
    const registrations = services.repos.findRegistrationsByUuid(player.uuid);
    const privateRegistration = registrations.find((reg) => reg.guildId === PRIVATE_LOG_GUILD);
    if (privateRegistration) {
      return targets.has(PRIVATE_LOG_GUILD)
        ? new Map([[PRIVATE_LOG_GUILD, privateRegistration]])
        : new Map();
    }
    for (const reg of registrations) {
      if (targets.has(reg.guildId)) targets.set(reg.guildId, reg);
    }
    for (const [guildId, reg] of targets) {
      if (!reg) targets.set(guildId, registrations[0] ?? null);
    }
  }

  return targets;
}

async function memberFor(
  services: Services,
  reg: Registration | null,
): Promise<Awaited<ReturnType<Services["resolveMember"]>>> {
  if (!reg) return null;
  return await services.resolveMember(reg.guildId, reg.discordUserId)
    ?? (reg.discordDisplayName ? { displayName: reg.discordDisplayName } : null);
}

export async function handleBridgeEvent(services: Services, event: InboundEvent): Promise<void> {
  if (event.type === "player.identity") {
    services.identity.rememberBedrock(event.player);
    return;
  }
  if (event.type === "server.status") {
    return;
  }

  const targets = await resolveTargets(services, event.player);
  if (targets.size === 0) return;

  await Promise.all(Array.from(targets, async ([guildId, reg]) => {
    const member = await memberFor(services, reg);

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
  }));
}
