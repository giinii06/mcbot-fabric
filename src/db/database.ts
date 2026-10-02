import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { MIGRATIONS } from "./schema";

export function userVersion(db: Database): number {
  const row = db.query("PRAGMA user_version").get() as { user_version: number } | null;
  return row?.user_version ?? 0;
}

export function migrate(db: Database): number {
  let version = userVersion(db);
  while (version < MIGRATIONS.length) {
    const migration = MIGRATIONS[version];
    if (!migration) break;
    const apply = db.transaction(() => {
      db.exec(migration.sql);
      db.exec(`PRAGMA user_version = ${version + 1}`);
    });
    apply();
    version += 1;
  }
  return version;
}

export function openDatabase(path: string): Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}
