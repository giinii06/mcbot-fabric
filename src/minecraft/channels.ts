import { Routes } from "discord.js";
import { REST } from "discord.js";
import type { EmbedBuilder } from "discord.js";
import type { Repositories } from "../db/repositories";
import type { Logger } from "../log";

export interface ChannelSender {
  send(channelId: string, embeds: EmbedBuilder[]): Promise<void>;
}

export function createDiscordSender(token: string): ChannelSender {
  const rest = new REST({ version: "10" }).setToken(token);
  return {
    async send(channelId, embeds) {
      await rest.post(Routes.channelMessages(channelId), {
        body: { embeds: embeds.map((e) => e.toJSON()) },
      });
    },
  };
}

export interface LogChannelService {
  get(guildId: string): string | null;
  set(guildId: string, channelId: string): void;
  clear(guildId: string): void;
  /** Sends to the guild log channel. Returns false when delivery failed. */
  send(guildId: string, embeds: EmbedBuilder[]): Promise<boolean>;
  /** Every guild that currently has a log channel configured. */
  guildsWithChannel(): string[];
}

export function createLogChannelService(deps: {
  repos: Repositories;
  sender: ChannelSender;
  log: Logger;
  now?: () => number;
}): LogChannelService {
  const now = deps.now ?? Date.now;

  return {
    get(guildId) {
      return deps.repos.getLogChannel(guildId)?.channelId ?? null;
    },

    set(guildId, channelId) {
      deps.repos.setLogChannel(guildId, channelId, now());
    },

    clear(guildId) {
      deps.repos.clearLogChannel(guildId);
    },

    async send(guildId, embeds) {
      const channelId = deps.repos.getLogChannel(guildId)?.channelId;
      if (!channelId) return false;
      try {
        await deps.sender.send(channelId, embeds);
        return true;
      } catch (err) {
        deps.log.warn("failed to deliver log message", {
          guildId,
          channelId,
          error: err instanceof Error ? err.message : String(err),
        });
        return false;
      }
    },

    guildsWithChannel() {
      // Registrations are guild scoped; the log channel table is tiny, so a
      // full scan of configured guilds is cheaper than maintaining a cache.
      const rows = deps.repos.listConfiguredLogGuilds();
      return rows;
    },
  };
}
