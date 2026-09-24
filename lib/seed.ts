import type Database from "better-sqlite3";

/**
 * Idempotent. Creates the `presenter` account — the name is reserved for whoever is running the
 * room, and every board and leaderboard leaves it out so the demo account never wins.
 */
export function seed(d: Database.Database) {
  if (!d.prepare("SELECT id FROM participants WHERE name_key='presenter'").get()) {
    d.prepare("INSERT INTO participants (name, name_key, created_at) VALUES ('presenter','presenter',?)").run(Date.now());
  }
  if (!d.prepare("SELECT 1 FROM settings WHERE key='phase'").get()) {
    d.prepare("INSERT INTO settings (key, value) VALUES ('phase','closed')").run();
  }
}
