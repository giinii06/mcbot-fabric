import type { GuildMember } from "discord.js";
import type { DiscordDisplaySource } from "../core/user";

export type MemberResolver = (guildId: string, userId: string) => Promise<DiscordDisplaySource | null>;

/**
 * REST based member lookup - deliberately does not depend on the privileged
 * GUILD_MEMBERS intent, and never throws when the member left the guild.
 */
export function createMemberResolver(client: {
  guilds: { fetch(id: string): Promise<{ members: { fetch(id: string): Promise<GuildMember> } }> };
}): MemberResolver {
  return async (guildId, userId) => {
    try {
      const guild = await client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId);
      return {
        displayName: member.displayName,
        globalName: member.user.globalName,
        user: { username: member.user.username },
      };
    } catch {
      return null;
    }
  };
}
