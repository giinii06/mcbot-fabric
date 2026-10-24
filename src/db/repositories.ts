import type { Database } from "bun:sqlite";

export type Edition = "JAVA" | "BEDROCK";

export interface Registration {
  guildId: string;
  discordUserId: string;
  discordDisplayName: string | null;
  minecraftUuid: string;
  minecraftUsername: string;
  minecraftEdition: Edition;
  createdAt: number;
  updatedAt: number;
}

export interface LogChannel {
  guildId: string;
  channelId: string;
  updatedAt: number;
}

export interface AuditEntry {
  guildId: string;
  action: string;
  actorDiscordUserId: string | null;
  targetDiscordUserId: string | null;
  targetMinecraftUuid: string | null;
  detail: string | null;
}

export interface Repositories {
  getRegistration(guildId: string, discordUserId: string, edition: Edition): Registration | null;
  findRegistrationByUuid(guildId: string, minecraftUuid: string): Registration | null;
  /** Cross-guild lookup used by the event router. */
  findRegistrationsByUuid(minecraftUuid: string): Registration[];
  listRegistrations(guildId: string): Registration[];
  countRegistrations(guildId: string): number;
  insertRegistration(reg: Registration): void;
  updateRegistrationDisplay(guildId: string, discordUserId: string, displayName: string, at: number): void;
  deleteRegistration(guildId: string, discordUserId: string, edition: Edition): boolean;
  getLogChannel(guildId: string): LogChannel | null;
  listConfiguredLogGuilds(): string[];
  setLogChannel(guildId: string, channelId: string, at: number): void;
  clearLogChannel(guildId: string): void;
  addAudit(entry: AuditEntry, at: number): void;
  listAudit(guildId: string, limit: number): AuditEntry[];
}

interface RegistrationRow {
  guild_id: string;
  discord_user_id: string;
  discord_display_name: string | null;
  minecraft_uuid: string;
  minecraft_username: string;
  minecraft_edition: Edition;
  created_at: number;
  updated_at: number;
}

function toRegistration(row: RegistrationRow): Registration {
  return {
    guildId: row.guild_id,
    discordUserId: row.discord_user_id,
    discordDisplayName: row.discord_display_name,
    minecraftUuid: row.minecraft_uuid,
    minecraftUsername: row.minecraft_username,
    minecraftEdition: row.minecraft_edition,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createRepositories(db: Database): Repositories {
  return {
    getRegistration(guildId, discordUserId, edition) {
      const row = db
        .query<RegistrationRow, [string, string, Edition]>(
          `SELECT * FROM minecraft_registrations WHERE guild_id = ? AND discord_user_id = ? AND minecraft_edition = ?`,
        )
        .get(guildId, discordUserId, edition);
      return row ? toRegistration(row) : null;
    },

    findRegistrationByUuid(guildId, minecraftUuid) {
      const row = db
        .query<RegistrationRow, [string, string]>(
          `SELECT * FROM minecraft_registrations WHERE guild_id = ? AND minecraft_uuid = ?`,
        )
        .get(guildId, minecraftUuid);
      return row ? toRegistration(row) : null;
    },

    findRegistrationsByUuid(minecraftUuid) {
      const rows = db
        .query<RegistrationRow, [string]>(
          `SELECT * FROM minecraft_registrations WHERE minecraft_uuid = ? ORDER BY guild_id ASC`,
        )
        .all(minecraftUuid);
      return rows.map(toRegistration);
    },

    listRegistrations(guildId) {
      const rows = db
        .query<RegistrationRow, [string]>(
          `SELECT * FROM minecraft_registrations WHERE guild_id = ? ORDER BY created_at ASC, minecraft_username ASC`,
        )
        .all(guildId);
      return rows.map(toRegistration);
    },

    countRegistrations(guildId) {
      const row = db
        .query<{ n: number }, [string]>(
          `SELECT COUNT(*) AS n FROM minecraft_registrations WHERE guild_id = ?`,
        )
        .get(guildId);
      return row?.n ?? 0;
    },

    insertRegistration(reg) {
      db.query(
        `INSERT INTO minecraft_registrations
           (guild_id, discord_user_id, discord_display_name, minecraft_uuid, minecraft_username,
            minecraft_edition, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        reg.guildId,
        reg.discordUserId,
        reg.discordDisplayName,
        reg.minecraftUuid,
        reg.minecraftUsername,
        reg.minecraftEdition,
        reg.createdAt,
        reg.updatedAt,
      );
    },

    updateRegistrationDisplay(guildId, discordUserId, displayName, at) {
      db.query(
        `UPDATE minecraft_registrations SET discord_display_name = ?, updated_at = ?
         WHERE guild_id = ? AND discord_user_id = ?`,
      ).run(displayName, at, guildId, discordUserId);
    },

    deleteRegistration(guildId, discordUserId, edition) {
      const res = db
        .query(`DELETE FROM minecraft_registrations WHERE guild_id = ? AND discord_user_id = ? AND minecraft_edition = ?`)
        .run(guildId, discordUserId, edition);
      return res.changes > 0;
    },

    getLogChannel(guildId) {
      const row = db
        .query<{ guild_id: string; channel_id: string; updated_at: number }, [string]>(
          `SELECT * FROM minecraft_log_channels WHERE guild_id = ?`,
        )
        .get(guildId);
      if (!row) return null;
      return { guildId: row.guild_id, channelId: row.channel_id, updatedAt: row.updated_at };
    },

    listConfiguredLogGuilds() {
      const rows = db.query<{ guild_id: string }, []>(`SELECT guild_id FROM minecraft_log_channels`).all();
      return rows.map((row) => row.guild_id);
    },

    clearLogChannel(guildId) {
      db.query(`DELETE FROM minecraft_log_channels WHERE guild_id = ?`).run(guildId);
    },

    setLogChannel(guildId, channelId, at) {
      db.query(
        `INSERT INTO minecraft_log_channels (guild_id, channel_id, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (guild_id) DO UPDATE SET channel_id = excluded.channel_id, updated_at = excluded.updated_at`,
      ).run(guildId, channelId, at);
    },

    addAudit(entry, at) {
      db.query(
        `INSERT INTO minecraft_audit_log
           (guild_id, action, actor_discord_user_id, target_discord_user_id, target_minecraft_uuid, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        entry.guildId,
        entry.action,
        entry.actorDiscordUserId,
        entry.targetDiscordUserId,
        entry.targetMinecraftUuid,
        entry.detail,
        at,
      );
    },

    listAudit(guildId, limit) {
      const rows = db
        .query<
          {
            guild_id: string;
            action: string;
            actor_discord_user_id: string | null;
            target_discord_user_id: string | null;
            target_minecraft_uuid: string | null;
            detail: string | null;
          },
          [string, number]
        >(
          `SELECT * FROM minecraft_audit_log WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?`,
        )
        .all(guildId, limit);
      return rows.map((row) => ({
        guildId: row.guild_id,
        action: row.action,
        actorDiscordUserId: row.actor_discord_user_id,
        targetDiscordUserId: row.target_discord_user_id,
        targetMinecraftUuid: row.target_minecraft_uuid,
        detail: row.detail,
      }));
    },
  };
}
