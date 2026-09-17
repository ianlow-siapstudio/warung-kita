import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { seed } from "./seed";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen INTEGER
);

CREATE TABLE IF NOT EXISTS config (
  participant_id INTEGER PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
  system_prompt TEXT NOT NULL,
  question_check INTEGER NOT NULL DEFAULT 0,
  answer_check INTEGER NOT NULL DEFAULT 0,
  one_job INTEGER NOT NULL DEFAULT 0,
  fallback_text TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  phase TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  blocked_by TEXT,
  original_content TEXT,
  category TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  bot_model TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_conv ON messages(conversation_id);

CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  question_key TEXT NOT NULL,
  text TEXT NOT NULL,
  position INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tiers (
  participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  question_key TEXT NOT NULL,
  tier TEXT NOT NULL,
  PRIMARY KEY (participant_id, question_key)
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  phase TEXT NOT NULL,
  runs_per_test INTEGER NOT NULL,
  bot_model TEXT NOT NULL,
  config_snapshot TEXT NOT NULL,
  rules_snapshot TEXT NOT NULL,
  cached INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  total INTEGER,
  max INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  question_key TEXT NOT NULL,
  iteration INTEGER NOT NULL,
  answer TEXT NOT NULL,
  original_answer TEXT,
  blocked_by TEXT,
  pass INTEGER NOT NULL,
  failed_rules TEXT NOT NULL DEFAULT '[]',
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS results_run ON results(run_id);

CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purpose TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  ms INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  filtered INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS calls_time ON calls(created_at);

-- Recorded demo runs, replayed when "use cached demo results" is on. Survives every reset.
CREATE TABLE IF NOT EXISTS cached_demo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  rules_hash TEXT NOT NULL,
  label TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`;

type Global = typeof globalThis & { __wkDb?: Database.Database };
const g = globalThis as Global;

// Columns added after the first release. Checked once per code load, so a long-running
// dev server that opened the database earlier picks them up too.
let migrated = false;
function migrate(d: Database.Database) {
  const cols = d.prepare("PRAGMA table_info(participants)").all() as { name: string }[];
  const msgCols = d.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
  if (!msgCols.some((c) => c.name === "report_note")) d.exec("ALTER TABLE messages ADD COLUMN report_note TEXT");
  if (!msgCols.some((c) => c.name === "reported_at")) {
    d.exec("ALTER TABLE messages ADD COLUMN reported_at INTEGER");
    d.exec("UPDATE messages SET category=NULL WHERE category='fine'");
  }
  if (!cols.some((c) => c.name === "published_run_id")) d.exec("ALTER TABLE participants ADD COLUMN published_run_id INTEGER");
  const configCols = d.prepare("PRAGMA table_info(config)").all() as { name: string }[];
  if (!configCols.some((c) => c.name === "temperature")) d.exec("ALTER TABLE config ADD COLUMN temperature REAL NOT NULL DEFAULT 0.5");
  if (!configCols.some((c) => c.name === "give_policies")) d.exec("ALTER TABLE config ADD COLUMN give_policies INTEGER NOT NULL DEFAULT 0");
  for (const col of ["knowledge", "input_rules", "output_rules", "topics"]) {
    if (!configCols.some((c) => c.name === col)) d.exec(`ALTER TABLE config ADD COLUMN ${col} TEXT NOT NULL DEFAULT '[]'`);
  }
  if (!configCols.some((c) => c.name === "strictness")) d.exec("ALTER TABLE config ADD COLUMN strictness TEXT NOT NULL DEFAULT 'balanced'");
  migrated = true;
}

export function db(): Database.Database {
  if (g.__wkDb) {
    if (!migrated) migrate(g.__wkDb);
    return g.__wkDb;
  }
  const file = path.resolve(/*turbopackIgnore: true*/ process.env.DATABASE_PATH || "./data/warung-kita.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const d = new Database(file);
  d.pragma("journal_mode = WAL");
  d.pragma("foreign_keys = ON");
  d.pragma("busy_timeout = 5000");
  d.exec(SCHEMA);
  // A run still marked running at boot was cut off by a restart — close it with what it has.
  d.prepare(
    `UPDATE runs SET status='interrupted', finished_at=?, total=(SELECT COUNT(*) FROM results WHERE run_id=runs.id AND pass=1)
     WHERE status='running'`
  ).run(Date.now());
  migrate(d);
  g.__wkDb = d;
  seed(d);
  return d;
}

export const now = () => Date.now();
