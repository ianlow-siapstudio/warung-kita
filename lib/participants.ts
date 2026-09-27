import type { NextRequest } from "next/server";
import { copy } from "@/config/copy";
import { MAX_RULES, MAX_RULE_CHARS, type Tier } from "@/config/questions";
import { testRuleFor } from "@/config/finds";
import { getQuestions } from "./questions";
import { db, now } from "./db";
import { ALL_KNOWLEDGE, type KnowledgeKey } from "@/config/restaurant";
import { naiveInstructions, type Strictness } from "./prompts";

export const PRESENTER = "presenter";
export const NAME_COOKIE = "wk_name";

export type Participant = { id: number; name: string; name_key: string };
export type BotConfig = {
  /** The participant's instructions only. The menu & facts are attached when the bot is called. */
  system_prompt: string;
  question_check: boolean;
  answer_check: boolean;
  one_job: boolean;
  fallback_text: string;
  /** How creative the bot's answers are, 0–1. Reasoning models (gpt-5*, o-series) ignore it. */
  temperature: number;
  /** How strict the input check, output check and topic limit are. */
  strictness: Strictness;
  /** Which policy sections the bot is given (it always gets the menu board). */
  knowledge: KnowledgeKey[];
  /** Input check: "Block the customer's message if it…" */
  input_rules: string[];
  /** Output check: "Block the answer if it…" */
  output_rules: string[];
  /** Topic limit: "Only answer messages about…" */
  topics: string[];
};

export const MAX_CHECK_RULES = 8;
const cleanList = (v: unknown): string[] =>
  (Array.isArray(v) ? v : []).map((x) => String(x).trim().slice(0, 120)).filter(Boolean).slice(0, MAX_CHECK_RULES);
const cleanKnowledge = (v: unknown): KnowledgeKey[] => (Array.isArray(v) ? v : []).filter((k): k is KnowledgeKey => ALL_KNOWLEDGE.includes(k));
const parseList = (s: string | null) => { try { return JSON.parse(s ?? "[]"); } catch { return []; } };

export const STRICTNESS: Strictness[] = ["relaxed", "balanced", "strict"];
const cleanStrictness = (s: unknown): Strictness => (STRICTNESS.includes(s as Strictness) ? (s as Strictness) : "balanced");

/** 0.5 keeps small models (ILMU nano) coherent while the naive prompt still breaks. */
export const DEFAULT_TEMPERATURE = 0.5;
export const clampTemperature = (t: number) => Math.round(Math.min(1, Math.max(0, Number.isFinite(t) ? t : DEFAULT_TEMPERATURE)) * 10) / 10;

export const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

export function findByName(name: string): Participant | undefined {
  return db().prepare("SELECT id, name, name_key FROM participants WHERE name_key=?").get(nameKey(name)) as Participant | undefined;
}

export function createParticipant(name: string): Participant {
  const clean = name.trim().replace(/\s+/g, " ");
  const info = db().prepare("INSERT INTO participants (name, name_key, created_at, last_seen) VALUES (?,?,?,?)").run(clean, nameKey(clean), now(), now());
  return { id: Number(info.lastInsertRowid), name: clean, name_key: nameKey(clean) };
}

/** The participant making this request: cookie first, then the x-wk-name header (localStorage copy). */
export function currentParticipant(req: NextRequest): Participant | undefined {
  const raw = req.cookies.get(NAME_COOKIE)?.value || req.headers.get("x-wk-name") || "";
  let name = raw;
  try { name = decodeURIComponent(raw); } catch {}
  if (!name.trim()) return undefined;
  return findByName(name);
}

export function touch(p: Participant) {
  db().prepare("UPDATE participants SET last_seen=? WHERE id=?").run(now(), p.id);
}

export const defaultConfig = (): BotConfig => ({
  system_prompt: naiveInstructions(),
  question_check: false,
  answer_check: false,
  one_job: false,
  fallback_text: copy.defaultFallback,
  temperature: DEFAULT_TEMPERATURE,
  strictness: "balanced",
  knowledge: [],
  input_rules: [],
  output_rules: [],
  topics: [],
});

/** Activity 1 forces this on everyone. */
export const naiveConfig = defaultConfig;

export function getConfig(pid: number): BotConfig {
  const row = db().prepare("SELECT * FROM config WHERE participant_id=?").get(pid) as
    | { system_prompt: string; question_check: number; answer_check: number; one_job: number; fallback_text: string; temperature: number | null; strictness: string | null; knowledge: string | null; input_rules: string | null; output_rules: string | null; topics: string | null }
    | undefined;
  if (!row) return defaultConfig();
  return {
    system_prompt: row.system_prompt,
    question_check: !!row.question_check,
    answer_check: !!row.answer_check,
    one_job: !!row.one_job,
    fallback_text: row.fallback_text,
    temperature: clampTemperature(row.temperature ?? DEFAULT_TEMPERATURE),
    strictness: cleanStrictness(row.strictness),
    knowledge: cleanKnowledge(parseList(row.knowledge)),
    input_rules: cleanList(parseList(row.input_rules)),
    output_rules: cleanList(parseList(row.output_rules)),
    topics: cleanList(parseList(row.topics)),
  };
}

export function saveConfig(pid: number, patch: Partial<BotConfig>): BotConfig {
  const next = { ...getConfig(pid), ...patch };
  next.system_prompt = String(next.system_prompt).slice(0, 8000);
  next.fallback_text = String(next.fallback_text).slice(0, 500) || copy.defaultFallback;
  next.temperature = clampTemperature(next.temperature);
  next.strictness = cleanStrictness(next.strictness);
  next.knowledge = cleanKnowledge(next.knowledge);
  next.input_rules = cleanList(next.input_rules);
  next.output_rules = cleanList(next.output_rules);
  next.topics = cleanList(next.topics);
  db()
    .prepare(
      `INSERT INTO config (participant_id, system_prompt, question_check, answer_check, one_job, fallback_text, temperature, strictness, knowledge, input_rules, output_rules, topics, updated_at)
       VALUES (@pid, @system_prompt, @question_check, @answer_check, @one_job, @fallback_text, @temperature, @strictness, @knowledge, @input_rules, @output_rules, @topics, @updated_at)
       ON CONFLICT(participant_id) DO UPDATE SET system_prompt=excluded.system_prompt, question_check=excluded.question_check,
         answer_check=excluded.answer_check, one_job=excluded.one_job, fallback_text=excluded.fallback_text,
         temperature=excluded.temperature, strictness=excluded.strictness,
         knowledge=excluded.knowledge, input_rules=excluded.input_rules, output_rules=excluded.output_rules,
         topics=excluded.topics, updated_at=excluded.updated_at`
    )
    .run({
      pid,
      system_prompt: next.system_prompt,
      question_check: next.question_check ? 1 : 0,
      answer_check: next.answer_check ? 1 : 0,
      one_job: next.one_job ? 1 : 0,
      fallback_text: next.fallback_text,
      temperature: next.temperature,
      strictness: next.strictness,
      knowledge: JSON.stringify(next.knowledge),
      input_rules: JSON.stringify(next.input_rules),
      output_rules: JSON.stringify(next.output_rules),
      topics: JSON.stringify(next.topics),
      updated_at: now(),
    });
  return next;
}

export type RuleSet = Record<string, string[]>;
export type TierSet = Record<string, Tier>;

/** A new participant gets the example rule on question 1 so they can see the shape.
 *  Nothing is marked "must not fail" — the slide asks them to decide. */
export function ensureStarterRules(pid: number) {
  const suite = getQuestions(pid);
  const has = db().prepare("SELECT 1 FROM rules WHERE participant_id=? LIMIT 1").get(pid);
  const hasTiers = db().prepare("SELECT 1 FROM tiers WHERE participant_id=? LIMIT 1").get(pid);
  if (has || hasTiers) return;
  // One worked example, as the slide shows — the rest is theirs to write.
  const first = suite[0];
  const example = first?.exampleRule ?? testRuleFor(first?.category ?? null);
  if (first && example) saveRules(pid, first.key, [example]);
  for (const q of suite) setTier(pid, q.key, "ok");
}

export function getRules(pid: number): RuleSet {
  const rows = db().prepare("SELECT question_key, text FROM rules WHERE participant_id=? ORDER BY position").all(pid) as { question_key: string; text: string }[];
  const out: RuleSet = Object.fromEntries(getQuestions(pid).map((q) => [q.key, [] as string[]]));
  for (const r of rows) out[r.question_key]?.push(r.text);
  return out;
}

export function saveRules(pid: number, questionKey: string, rules: string[]) {
  if (!getQuestions(pid).some((q) => q.key === questionKey)) throw new Error("unknown question");
  const clean = rules.map((r) => String(r).trim().slice(0, MAX_RULE_CHARS)).filter(Boolean).slice(0, MAX_RULES);
  const d = db();
  d.transaction(() => {
    d.prepare("DELETE FROM rules WHERE participant_id=? AND question_key=?").run(pid, questionKey);
    const ins = d.prepare("INSERT INTO rules (participant_id, question_key, text, position) VALUES (?,?,?,?)");
    clean.forEach((t, i) => ins.run(pid, questionKey, t, i));
  })();
  return clean;
}

export function getTiers(pid: number): TierSet {
  const rows = db().prepare("SELECT question_key, tier FROM tiers WHERE participant_id=?").all(pid) as { question_key: string; tier: Tier }[];
  const out: TierSet = Object.fromEntries(getQuestions(pid).map((q) => [q.key, "ok" as Tier]));
  for (const r of rows) out[r.question_key] = r.tier;
  return out;
}

export function setTier(pid: number, questionKey: string, tier: Tier) {
  db()
    .prepare("INSERT INTO tiers (participant_id, question_key, tier) VALUES (?,?,?) ON CONFLICT(participant_id, question_key) DO UPDATE SET tier=excluded.tier")
    .run(pid, questionKey, tier === "must" ? "must" : "ok");
}

/** Plain summary of what was on, for "your scores so far". */
export function describeConfig(c: BotConfig): string {
  const edited = c.system_prompt.trim() !== naiveInstructions().trim();
  const extras: string[] = [];
  const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  if (c.knowledge?.length) extras.push(`${c.knowledge.length} policies`);
  if (c.question_check) extras.push(`input check (${c.input_rules?.length ?? 0})`);
  if (c.answer_check) extras.push(`output check (${c.output_rules?.length ?? 0})`);
  if (c.one_job) extras.push(`topic limit (${c.topics?.length ?? 0})`);
  if ((c.question_check || c.answer_check || c.one_job) && (c.strictness ?? "balanced") !== "balanced") extras.push(`${c.strictness} checks`);
  if ((c.temperature ?? DEFAULT_TEMPERATURE) !== DEFAULT_TEMPERATURE) extras.push(`creativity ${c.temperature}`);
  if (!extras.length) return edited ? "prompt only" : "original prompt";
  return `${edited ? "your prompt" : "original prompt"} + ${extras.join(" + ")}`;
}
