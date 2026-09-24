import crypto from "node:crypto";
import { ATTACK_RUNS, ATTACKS, type Attack } from "@/config/attacks";
import { copy } from "@/config/copy";
import { getQuestions, type TestQuestion } from "./questions";
import { respond, type BlockedBy } from "./bot";
import { describeChanges } from "./diff";
import { db, now } from "./db";
import { llm, LlmError, parseJson, RateLimited } from "./llm";
import {
  describeConfig, getConfig, getRules, getTiers, PRESENTER,
  type BotConfig, type Participant, type RuleSet, type TierSet,
} from "./participants";
import { attackJudgePrompt, markerPrompt } from "./prompts";
import { type ProviderName } from "./providers";
import { queue } from "./queue";
import { getBotModel, getRunsPerTest, measuringProvider, type Phase } from "./settings";

export type ResultRow = {
  question_key: string;
  iteration: number;
  answer: string;
  original_answer: string | null;
  blocked_by: BlockedBy;
  pass: boolean;
  failed_rules: number[];
  reason: string;
};

export type RulesSnapshot = { rules: RuleSet; tiers: TierSet; questions?: TestQuestion[] };

export { barFor } from "./gate";

export function rulesHash(rules: RuleSet): string {
  const norm = Object.keys(rules).sort().map((k) => (rules[k] ?? []).map((r) => r.trim().toLowerCase().replace(/\s+/g, " ")));
  return crypto.createHash("sha1").update(JSON.stringify(norm)).digest("hex");
}

const ownerFor = (pid: number) => `p${pid}`;

function insertResult(runId: number, r: ResultRow) {
  db()
    .prepare(
      `INSERT INTO results (run_id, question_key, iteration, answer, original_answer, blocked_by, pass, failed_rules, reason, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
    .run(runId, r.question_key, r.iteration, r.answer, r.original_answer, r.blocked_by, r.pass ? 1 : 0, JSON.stringify(r.failed_rules), r.reason, now());
}

function finishRun(runId: number, status = "done") {
  db()
    // `total` is the questions' score; attack results are counted separately.
    .prepare(`UPDATE runs SET status=?, finished_at=?, total=(SELECT COUNT(*) FROM results WHERE run_id=? AND pass=1 AND question_key NOT LIKE 'attack:%') WHERE id=?`)
    .run(status, now(), runId, runId);
}

/** A run left "running" by a restart or a crash. After this long it is closed so nobody is stuck. */
const STALE_RUN_MS = 10 * 60_000;

export function closeStaleRuns() {
  db()
    .prepare(
      `UPDATE runs SET status='interrupted', finished_at=?,
         total=(SELECT COUNT(*) FROM results WHERE run_id=runs.id AND pass=1 AND question_key NOT LIKE 'attack:%')
       WHERE status='running' AND started_at < ?`
    )
    .run(now(), now() - STALE_RUN_MS);
}

export function activeRunId(pid: number): number | null {
  closeStaleRuns();
  const row = db().prepare("SELECT id FROM runs WHERE participant_id=? AND status='running' ORDER BY id DESC LIMIT 1").get(pid) as { id: number } | undefined;
  return row?.id ?? null;
}

async function markOne(question: string, answer: string, rules: string[], owner: string) {
  try {
    const res = await llm("marker", measuringProvider(), [{ role: "user", content: markerPrompt(question, answer, rules) }], { owner, json: true, maxTokens: 150 });
    const j = parseJson<{ pass?: unknown; failed_rules?: unknown; reason?: unknown }>(res.text);
    if (!j || typeof j.pass !== "boolean") {
      // Worth seeing in the log: a model that can't hold the JSON shape can't be the marker.
      console.error("marker: unreadable reply", JSON.stringify(res.text.slice(0, 200)));
      return { pass: false, failed_rules: [], reason: copy.markerFailed };
    }
    const failed = Array.isArray(j.failed_rules) ? j.failed_rules.map(Number).filter((n) => n >= 1 && n <= rules.length) : [];
    return { pass: j.pass, failed_rules: j.pass ? [] : failed, reason: String(j.reason ?? "").slice(0, 300) || (j.pass ? "It follows the rules." : "It broke a rule.") };
  } catch {
    return { pass: false, failed_rules: [], reason: copy.markerFailed };
  }
}

async function judgeAttack(attack: Attack, answer: string, owner: string) {
  try {
    const res = await llm("marker", measuringProvider(), [{ role: "user", content: attackJudgePrompt(attack.message, answer, attack.failsIf) }], { owner, json: true, maxTokens: 150 });
    const j = parseJson<{ pass?: unknown; reason?: unknown }>(res.text);
    if (!j || typeof j.pass !== "boolean") return { pass: false, failed_rules: [], reason: copy.markerFailed };
    return { pass: j.pass, failed_rules: [], reason: String(j.reason ?? "").slice(0, 300) || (j.pass ? "The attack didn't get through." : "The attack got through.") };
  } catch {
    return { pass: false, failed_rules: [], reason: copy.markerFailed };
  }
}

async function liveJob(runId: number, pid: number, config: BotConfig, snap: RulesSnapshot, n: number, bot: ProviderName, withAttacks: boolean, suite: TestQuestion[]) {
  const owner = ownerFor(pid);
  // Each question N times, then every attack test ATTACK_RUNS times.
  type Task = { key: string; text: string; i: number; attack?: Attack };
  const tasks: Task[] = [];
  for (let i = 1; i <= n; i++) for (const q of suite) tasks.push({ key: q.key, text: q.text, i });
  if (withAttacks) for (let i = 1; i <= ATTACK_RUNS; i++) for (const a of ATTACKS) tasks.push({ key: a.key, text: a.message, i, attack: a });

  // Up to 4 of this person's tasks in flight; the global queue keeps everyone to 8 calls at once.
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const t = tasks[next++];
      let answer = "", original: string | null = null, blocked: BlockedBy = null;
      try {
        const reply = await respond(config, [{ role: "user", content: t.text }], bot, owner);
        answer = reply.text; original = reply.original; blocked = reply.blockedBy;
      } catch (err) {
        if (!(err instanceof LlmError)) console.error(err);
        insertResult(runId, {
          question_key: t.key, iteration: t.i, answer: "", original_answer: null, blocked_by: null, pass: false, failed_rules: [],
          // Being throttled is the room's fault, not the draft's — say which happened.
          reason: err instanceof RateLimited ? copy.aiBusy : copy.aiSilent,
        });
        continue;
      }
      // An attack a check blocked never reached the customer — they only saw the participant's safe reply.
      const stoppedByCheck = t.attack && blocked && blocked !== "azure_filter";
      const mark = stoppedByCheck
        ? { pass: true, failed_rules: [], reason: "A check blocked it — the customer only saw your safe reply." }
        : t.attack ? await judgeAttack(t.attack, answer, owner) : await markOne(t.text, answer, snap.rules[t.key] ?? [], owner);
      insertResult(runId, { question_key: t.key, iteration: t.i, answer, original_answer: original, blocked_by: blocked, ...mark });
    }
  };
  try {
    await Promise.all(Array.from({ length: 4 }, worker));
    finishRun(runId);
  } catch (err) {
    console.error("run failed", err);
    finishRun(runId, "error");
  }
}

/** Has this person finished a test before? Decides whether the attack suite runs. */
function hasFinishedRun(pid: number): boolean {
  return !!db().prepare("SELECT 1 FROM runs WHERE participant_id=? AND status<>'running' LIMIT 1").get(pid);
}

export function startRun(p: Participant, phase: Phase): { runId: number } | { error: string } {
  const existing = activeRunId(p.id);
  if (existing) return { runId: existing };

  const suite = getQuestions(p.id);
  const rules = getRules(p.id);
  if (!suite.length) return { error: "There are no tests yet — nobody reported anything in Activity 1." };
  if (suite.some((q) => !(rules[q.key]?.length))) return { error: "Every question needs at least one rule first." };
  const snap: RulesSnapshot = { rules, tiers: getTiers(p.id), questions: suite };
  const config = getConfig(p.id);
  const bot = getBotModel();
  const n = getRunsPerTest();
  // Round 1 is the questions only. The attack suite — three times as many calls — joins from
  // the second test, which is exactly when "Fix it" opens and publishing becomes possible.
  const withAttacks = hasFinishedRun(p.id);

  const info = db()
    .prepare(
      `INSERT INTO runs (participant_id, phase, runs_per_test, bot_model, config_snapshot, rules_snapshot, attacks_max, status, started_at, max)
       VALUES (?,?,?,?,?,?,?, 'running', ?, ?)`
    )
    .run(p.id, phase, n, bot, JSON.stringify(config), JSON.stringify(snap), withAttacks ? ATTACKS.length * ATTACK_RUNS : 0, now(), n * suite.length);
  const runId = Number(info.lastInsertRowid);

  void liveJob(runId, p.id, config, snap, n, bot, withAttacks, suite);
  return { runId };
}

export type RunView = ReturnType<typeof runView>;

export function runView(runId: number) {
  const run = db().prepare("SELECT * FROM runs WHERE id=?").get(runId) as
    | { id: number; participant_id: number; phase: string; runs_per_test: number; bot_model: string; config_snapshot: string; rules_snapshot: string; attacks_max: number; status: string; started_at: number; finished_at: number | null; total: number | null; max: number }
    | undefined;
  if (!run) return null;
  const results = (db().prepare("SELECT * FROM results WHERE run_id=? ORDER BY id").all(runId) as Record<string, unknown>[]).map((r) => ({
    id: r.id as number,
    question_key: r.question_key as string,
    iteration: r.iteration as number,
    answer: r.answer as string,
    original_answer: r.original_answer as string | null,
    blocked_by: r.blocked_by as BlockedBy,
    pass: !!r.pass,
    failed_rules: JSON.parse(r.failed_rules as string) as number[],
    reason: r.reason as string,
  }));
  const config = JSON.parse(run.config_snapshot) as BotConfig;
  const snap = JSON.parse(run.rules_snapshot) as RulesSnapshot;
  return {
    id: run.id,
    participant_id: run.participant_id,
    status: run.status,
    runs_per_test: run.runs_per_test,
    bot_model: run.bot_model,
    started_at: run.started_at,
    finished_at: run.finished_at,
    total: run.status === "running" ? results.filter((r) => r.pass && !r.question_key.startsWith("attack:")).length : run.total ?? 0,
    attacks_held: results.filter((r) => r.pass && r.question_key.startsWith("attack:")).length,
    attacks_max: run.attacks_max,
    total_tasks: run.max + run.attacks_max,
    max: run.max,
    done: results.length,
    summary: describeConfig(config),
    config,
    rules: snap.rules,
    tiers: snap.tiers,
    // The tests as they were when this run happened — older runs may have had a different suite.
    questions: snap.questions ?? [],
    results,
    queuePosition: run.status === "running" ? queue.positionOf(ownerFor(run.participant_id)) : 0,
  };
}

export function runHistory(pid: number) {
  const rows = db().prepare(
    `SELECT id, status, started_at, total, max, bot_model, config_snapshot, rules_snapshot,
       (SELECT COUNT(*) FROM results WHERE run_id=runs.id AND blocked_by IS NOT NULL AND blocked_by<>'azure_filter') AS blocked,
       (SELECT COUNT(*) FROM results WHERE run_id=runs.id AND pass=1 AND question_key LIKE 'attack:%') AS attacks_held,
       attacks_max
     FROM runs WHERE participant_id=? ORDER BY id`
  ).all(pid) as {
    id: number; status: string; started_at: number; total: number | null; max: number; bot_model: string; config_snapshot: string; rules_snapshot: string; blocked: number; attacks_held: number; attacks_max: number;
  }[];
  const snaps = rows.map((r) => {
    const rs = JSON.parse(r.rules_snapshot) as RulesSnapshot;
    return { config: JSON.parse(r.config_snapshot) as BotConfig, rules: rs.rules, tiers: rs.tiers };
  });
  return {
    runs: rows.map((r, i) => ({
      id: r.id,
      status: r.status,
      started_at: r.started_at,
      total: r.total,
      max: r.max,
      bot_model: r.bot_model,
      blocked: r.blocked,
      attacks_held: r.attacks_held,
      attacks_max: r.attacks_max,
      summary: describeConfig(snaps[i].config),
      // null for the first run; [] when nothing changed.
      changes: i === 0 ? null : describeChanges(snaps[i - 1], snaps[i], Object.keys(snaps[i].rules)),
    })),
    last: snaps.length ? snaps[snaps.length - 1] : null,
  };
}
