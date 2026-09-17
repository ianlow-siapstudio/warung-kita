import { questions } from "@/config/questions";
import { db } from "./db";
import { PRESENTER, describeConfig, type BotConfig } from "./participants";
import { FIND_GROUPS, FIND_TYPES, findGroupOf, isFindType } from "@/config/finds";
import { botChoices, measuringProvider, providers, type ProviderName } from "./providers";
import { queue } from "./queue";
import { barFor, type RulesSnapshot } from "./runs";
import { cachedDemoOn, getBotModel, getPhase, getRunsPerTest, getSetting } from "./settings";

// gpt-4o-mini list price, USD per million tokens. Good enough for an estimate.
const PRICE_IN = 0.15, PRICE_OUT = 0.6;

const p95 = (values: number[]) => {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
};

export function providerStrip(name: ProviderName, sinceMs = 10 * 60_000) {
  const rows = db().prepare("SELECT ms, ok, filtered FROM calls WHERE provider=? AND created_at>?").all(name, Date.now() - sinceMs) as { ms: number; ok: number; filtered: number }[];
  const errors = rows.filter((r) => !r.ok).length;
  return {
    calls: rows.length,
    errors,
    errorRate: rows.length ? errors / rows.length : 0,
    p95: p95(rows.filter((r) => r.ok).map((r) => r.ms)),
    filtered: rows.filter((r) => r.filtered).length,
  };
}

export function overview() {
  const d = db();
  const one = <T,>(sql: string, ...args: unknown[]) => d.prepare(sql).get(...args) as T;
  const bot = getBotModel();
  const all = providers();

  const calls = one<{ n: number; pin: number; pout: number }>("SELECT COUNT(*) n, COALESCE(SUM(prompt_tokens),0) pin, COALESCE(SUM(completion_tokens),0) pout FROM calls");
  const recentMs = (d.prepare("SELECT ms FROM calls WHERE ok=1 AND created_at>?").all(Date.now() - 10 * 60_000) as { ms: number }[]).map((r) => r.ms);
  const botStrip = providerStrip(bot);

  return {
    phase: getPhase(),
    runsPerTest: getRunsPerTest(),
    cachedDemo: cachedDemoOn(),
    botModel: bot,
    botChoices: botChoices().map((name) => ({
      name,
      label: all[name].label,
      model: all[name].model,
      configured: all[name].configured,
      strip: providerStrip(name),
    })),
    marker: measuringProvider() === "azure"
      ? `Azure · deployment ${all.azure.model}`
      : "Offline mock — Azure isn't configured",
    banner: botStrip.calls >= 5 && botStrip.errorRate >= 0.2
      ? `${all[bot].label} is failing: ${botStrip.errors} of ${botStrip.calls} calls in the last 10 minutes errored.`
      : null,
    stats: {
      online: one<{ n: number }>("SELECT COUNT(*) n FROM participants WHERE last_seen>?", Date.now() - 30_000).n,
      participants: one<{ n: number }>("SELECT COUNT(*) n FROM participants WHERE name_key<>?", PRESENTER).n,
      messages: one<{ n: number }>("SELECT COUNT(*) n FROM messages").n,
      runs: one<{ n: number }>("SELECT COUNT(*) n FROM runs").n,
      calls: calls.n,
      cost: (calls.pin * PRICE_IN + calls.pout * PRICE_OUT) / 1_000_000,
      p95: p95(recentMs),
      errors: one<{ n: number }>("SELECT COUNT(*) n FROM calls WHERE ok=0").n,
      filterBlocks: one<{ n: number }>("SELECT COUNT(*) n FROM calls WHERE filtered=1").n,
      markerErrors: one<{ n: number }>("SELECT COUNT(*) n FROM results WHERE reason='marker error'").n,
      queue: queue.stats,
    },
    participants: d.prepare(
      `SELECT p.id, p.name, p.name_key, p.last_seen,
        (SELECT COUNT(*) FROM runs r WHERE r.participant_id=p.id) runs,
        (SELECT COUNT(*) FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.participant_id=p.id AND m.role='user') messages
       FROM participants p ORDER BY p.name_key`
    ).all(),
    cached: d.prepare("SELECT id, provider, label, created_at FROM cached_demo ORDER BY provider, id").all(),
    presenterRuns: d.prepare(
      `SELECT r.id, r.total, r.max, r.bot_model, r.started_at, r.cached FROM runs r JOIN participants p ON p.id=r.participant_id
       WHERE p.name_key=? AND r.status='done' ORDER BY r.id DESC LIMIT 5`
    ).all(PRESENTER),
  };
}

export function feed(limit = 150) {
  return db().prepare(
    `SELECT m.id, m.content AS reply, m.category, m.report_note, m.pinned, m.blocked_by, m.created_at, p.name,
       (SELECT u.content FROM messages u WHERE u.conversation_id=m.conversation_id AND u.role='user' AND u.id<m.id ORDER BY u.id DESC LIMIT 1) AS question
     FROM messages m JOIN conversations c ON c.id=m.conversation_id JOIN participants p ON p.id=c.participant_id
     WHERE m.role='assistant' AND c.phase='activity1'
     ORDER BY m.id DESC LIMIT ?`
  ).all(limit);
}

export function harvest() {
  const d = db();
  const counts = Object.fromEntries(
    (d.prepare(
      `SELECT m.category, COUNT(*) n FROM messages m JOIN conversations c ON c.id=m.conversation_id
       WHERE m.role='assistant' AND c.phase='activity1' AND m.category IS NOT NULL GROUP BY m.category`
    ).all() as { category: string; n: number }[]).map((r) => [r.category, r.n])
  );
  return {
    tiles: FIND_GROUPS.map((g) => ({
      key: g.key,
      label: g.label,
      count: Object.entries(counts).filter(([k]) => findGroupOf(k) === g.key).reduce((s, [, n]) => s + n, 0) + (Number(getSetting(`tile_adjust_${g.key}`)) || 0),
    })),
    pinned: feed(500).filter((m) => (m as { pinned: number }).pinned),
  };
}

export function leaderboard() {
  const d = db();
  const people = d.prepare("SELECT id, name, published_run_id FROM participants WHERE name_key<>? ORDER BY name_key").all(PRESENTER) as { id: number; name: string; published_run_id: number | null }[];
  const rows = [];
  for (const p of people) {
    const runs = d.prepare(
      "SELECT id, total, max, bot_model, config_snapshot, rules_snapshot, runs_per_test FROM runs WHERE participant_id=? AND status IN ('done','interrupted') ORDER BY id"
    ).all(p.id) as { id: number; total: number; max: number; bot_model: string; config_snapshot: string; rules_snapshot: string; runs_per_test: number }[];
    if (!runs.length) {
      rows.push({ id: p.id, name: p.name, runs: 0, latest: null, best: null, first: null, max: null, controls: "—", models: [] as string[], mustMet: null, shipped: null as string | null });
      continue;
    }
    const first = runs[0], latest = runs[runs.length - 1];
    const best = runs.reduce((a, b) => (b.total / b.max > a.total / a.max ? b : a));
    // Did the latest run clear the bar on every must-not-fail question?
    const snap = JSON.parse(latest.rules_snapshot) as RulesSnapshot;
    const passes = d.prepare("SELECT question_key, SUM(pass) n FROM results WHERE run_id=? GROUP BY question_key").all(latest.id) as { question_key: string; n: number }[];
    const must = questions.filter((q) => snap.tiers[q.key] === "must");
    const mustMet = must.length
      ? must.every((q) => (passes.find((x) => x.question_key === q.key)?.n ?? 0) >= barFor("must", latest.runs_per_test))
      : null;
    rows.push({
      id: p.id,
      name: p.name,
      runs: runs.length,
      latest: latest.total,
      best: best.total,
      first: first.total,
      max: latest.max,
      controls: describeConfig(JSON.parse(latest.config_snapshot) as BotConfig),
      models: [...new Set(runs.map((r) => r.bot_model))],
      mustMet,
      // "v3 · 19/20" when they published a version to customers.
      shipped: (() => {
        const i = runs.findIndex((r) => r.id === p.published_run_id);
        return i < 0 ? null : `v${i + 1} · ${runs[i].total}/${runs[i].max}`;
      })(),
    });
  }
  return rows;
}

/**
 * Activity 1 leaderboard, from what participants reported: how many of the four targets each person
 * hit, then how many finds in total. The presenter can clear a report that isn't a real find.
 */
export function findsLeaderboard() {
  const rows = db().prepare(
    `SELECT p.id, p.name, m.category, COUNT(*) n, MIN(m.reported_at) first_at
     FROM messages m JOIN conversations c ON c.id=m.conversation_id JOIN participants p ON p.id=c.participant_id
     WHERE c.phase='activity1' AND m.role='assistant' AND m.category IS NOT NULL AND p.name_key<>?
     GROUP BY p.id, m.category`
  ).all(PRESENTER) as { id: number; name: string; category: string; n: number; first_at: number | null }[];
  const people = new Map<number, { id: number; name: string; hits: Record<string, number>; total: number; firstAt: number }>();
  for (const r of rows) {
    if (!isFindType(r.category)) continue;
    const p = people.get(r.id) ?? { id: r.id, name: r.name, hits: {}, total: 0, firstAt: Infinity };
    p.hits[r.category] = r.n;
    p.total += r.n;
    p.firstAt = Math.min(p.firstAt, r.first_at ?? Infinity);
    people.set(r.id, p);
  }
  return [...people.values()]
    .map((p) => ({ ...p, targets: FIND_TYPES.filter((t) => p.hits[t.key]).length }))
    .sort((a, b) => b.targets - a.targets || b.total - a.total || a.firstAt - b.firstAt)
    .map(({ firstAt: _f, ...p }, i) => ({ ...p, rank: i + 1 }));
}
