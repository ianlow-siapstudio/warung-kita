// Activity 2's test suite is built from what the room broke in Activity 1: real customer messages
// people reported, one per target. Your own report wins; where you found nothing, the room's does.
// The deck's four questions are only a safety net for a room that reported nothing at all.

import { FIND_TYPES } from "@/config/finds";
import { questions as deckQuestions, type Question, type Tier } from "@/config/questions";
import { SAMPLES } from "@/config/samples";
import { db } from "./db";

/**
 * One test per Activity 1 target. Each costs runs_per_test bot calls plus the same again to mark,
 * so this is the single biggest lever on how long a round takes for a full room.
 */
export const MAX_QUESTIONS = FIND_TYPES.length;
const MAX_TEXT = 400;

export type TestQuestion = Question & {
  /** The Activity 1 target it was reported as, or null for the fallback set. */
  category: string | null;
  /** Where the test came from: this person's find, the room's, a seeded sample, or the deck. */
  source: "mine" | "room" | "sample" | "deck";
};

type Reported = { id: number; category: string; question: string | null; reports: number };

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** Reports by one person (newest first), or by everyone else (most-reported message first). */
function reported(pid: number, mine: boolean): Reported[] {
  const rows = db()
    .prepare(
      `SELECT m.id, m.category, COUNT(*) OVER (PARTITION BY m.category) AS reports,
         (SELECT u.content FROM messages u
           WHERE u.conversation_id = m.conversation_id AND u.role = 'user' AND u.id < m.id
           ORDER BY u.id DESC LIMIT 1) AS question
       FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE c.phase = 'activity1' AND m.role = 'assistant' AND m.category IS NOT NULL
         AND c.participant_id ${mine ? "=" : "<>"} ?
       ORDER BY reports DESC, m.reported_at DESC`
    )
    .all(pid) as Reported[];
  return rows.filter((r) => r.question && r.question.trim() && FIND_TYPES.some((f) => f.key === r.category));
}

/**
 * Up to MAX_QUESTIONS real messages, one per target: every target this person reported themselves,
 * then the targets they missed filled in from the room. Empty when nobody has reported anything.
 */
export function buildSuite(pid: number): TestQuestion[] {
  const picked: TestQuestion[] = [];
  const usedCategory = new Set<string>();
  const usedText = new Set<string>();

  const take = (rows: Reported[], source: "mine" | "room" | "sample") => {
    for (const r of rows) {
      if (picked.length >= MAX_QUESTIONS) return;
      if (usedCategory.has(r.category) || usedText.has(norm(r.question!))) continue;
      usedCategory.add(r.category);
      usedText.add(norm(r.question!));
      picked.push({
        key: r.id < 0 ? `sample:${r.category}` : `report:${r.id}`,
        text: r.question!.trim().slice(0, MAX_TEXT),
        slideTier: "ok",
        category: r.category,
        source,
      });
    }
  };

  take(reported(pid, true), "mine");
  take(reported(pid, false), "room");
  // Whatever the room never broke, fill from the seeded samples so every suite covers all ten.
  take(SAMPLES.map((s, i) => ({ id: -(i + 1), category: s.target, question: s.text, reports: 0 })), "sample");
  return picked;
}

const deckSuite = (): TestQuestion[] => deckQuestions.map((q) => ({ ...q, category: null, source: "deck" as const }));

function readSuite(pid: number): TestQuestion[] {
  return (
    db()
      .prepare("SELECT key, text, category, source FROM questions WHERE participant_id=? ORDER BY position")
      .all(pid) as { key: string; text: string; category: string | null; source: TestQuestion["source"] }[]
  ).map((r) => ({ key: r.key, text: r.text, slideTier: "ok" as Tier, category: r.category, source: r.source }));
}

function writeSuite(pid: number, suite: TestQuestion[]) {
  const d = db();
  d.transaction(() => {
    d.prepare("DELETE FROM questions WHERE participant_id=?").run(pid);
    const ins = d.prepare("INSERT INTO questions (participant_id, key, text, category, source, position) VALUES (?,?,?,?,?,?)");
    suite.forEach((q, i) => ins.run(pid, q.key, q.text, q.category, q.source, i));
  })();
}

/**
 * This person's test suite. Built once and then frozen, so "before → after" always compares the
 * same tests and nothing changes under someone who is part-way through writing their rules.
 */
export function getQuestions(pid: number): TestQuestion[] {
  const stored = readSuite(pid);
  if (stored.length) return stored;
  const built = buildSuite(pid);
  const suite = built.length ? built : deckSuite();
  writeSuite(pid, suite);
  return suite;
}

/**
 * Called when the presenter opens Activity 2, so the whole room's tests are drawn from the same
 * moment. A suite that had to fall back to the deck (opened before anyone reported) is redrawn,
 * but only while nobody has tested against it yet.
 */
export function buildSuitesForRoom() {
  const d = db();
  for (const { id } of d.prepare("SELECT id FROM participants").all() as { id: number }[]) {
    const stored = readSuite(id);
    const tested = d.prepare("SELECT 1 FROM runs WHERE participant_id=? LIMIT 1").get(id);
    if (stored.length && !(stored[0].source === "deck" && !tested)) continue;
    const built = buildSuite(id);
    if (built.length) writeSuite(id, built);
    else if (!stored.length) writeSuite(id, deckSuite());
  }
}
