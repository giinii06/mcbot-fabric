/**
 * SQLite schema. Applied in order, guarded by `PRAGMA user_version`.
 * Never rewrite an applied migration - append a new one.
 */
export interface Migration {
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    name: "001_minecraft_tables",
    sql: `
      CREATE TABLE IF NOT EXISTS minecraft_log_channels (
        guild_id   TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS minecraft_registrations (
        guild_id            TEXT    NOT NULL,
        discord_user_id     TEXT    NOT NULL,
        minecraft_uuid      TEXT    NOT NULL,
        minecraft_username  TEXT    NOT NULL,
        minecraft_edition   TEXT    NOT NULL CHECK (minecraft_edition IN ('JAVA', 'BEDROCK')),
        created_at          INTEGER NOT NULL,
        updated_at          INTEGER NOT NULL,
        PRIMARY KEY (guild_id, discord_user_id)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_minecraft_registrations_uuid
        ON minecraft_registrations (guild_id, minecraft_uuid);

      CREATE INDEX IF NOT EXISTS idx_minecraft_registrations_discord
        ON minecraft_registrations (discord_user_id);

      CREATE TABLE IF NOT EXISTS minecraft_audit_log (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id              TEXT    NOT NULL,
        action                TEXT    NOT NULL,
        actor_discord_user_id TEXT,
        target_discord_user_id TEXT,
        target_minecraft_uuid TEXT,
        detail                TEXT,
        created_at            INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_minecraft_audit_guild
        ON minecraft_audit_log (guild_id, created_at);
    `,
  },
  {
    name: "002_minecraft_uuid_lookup",
    sql: `
      CREATE INDEX IF NOT EXISTS idx_minecraft_registrations_uuid_only
        ON minecraft_registrations (minecraft_uuid);
    `,
  },
  {
    name: "003_minecraft_display_name",
    sql: `
      ALTER TABLE minecraft_registrations ADD COLUMN discord_display_name TEXT;
    `,
  },
];
