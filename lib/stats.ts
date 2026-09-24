import { copy } from "@/config/copy";

import { db } from "./db";
import { PRESENTER, describeConfig, type BotConfig } from "./participants";
import { FIND_GROUPS, FIND_TYPES, isFindType, typesInGroup } from "@/config/finds";
import { botChoices, markerChoices, providers, type ProviderName } from "./providers";
import { queue } from "./queue";
import { barFor, type RulesSnapshot } from "./runs";
import { getBotModel, getPhase, getRunsPerTest, getSetting, measuringProvider } from "./settings";

// gpt-4o-mini list price, USD per million tokens. Good enough for an estimate.
const PRICE_IN = 0.15, PRICE_OUT = 0.6;

const p95 = (values: number[]) => {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
};

export function providerStrip(name: ProviderName, sinceMs = 10 * 60_000) {
  const rows = db().prepare("SELECT ms, ok, filtered, error FROM calls WHERE provider=? AND created_at>?").all(name, Date.now() - sinceMs) as { ms: number; ok: number; filtered: number; error: string | null }[];
  // Being throttled is a queue problem, not a broken provider — count the two apart.
  const throttled = rows.filter((r) => !r.ok && r.error?.startsWith("429")).length;
  const garbled = rows.filter((r) => !r.ok && r.error?.startsWith("unreadable")).length;
  const errors = rows.filter((r) => !r.ok && !r.error?.startsWith("429") && !r.error?.startsWith("unreadable")).length;
  return {
    calls: rows.length,
    errors,
    throttled,
    garbled,
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
    botModel: bot,
    botChoices: botChoices().map((name) => ({
      name,
      label: all[name].label,
      model: all[name].model,
      configured: all[name].configured,
      strip: providerStrip(name),
    })),
    markerModel: measuringProvider(),
    markerChoices: markerChoices().map((name) => ({ name, label: all[name].label, model: all[name].model })),
    banner: botStrip.calls >= 5 && botStrip.errorRate >= 0.2
      ? `${all[bot].label} is failing: ${botStrip.errors} of ${botStrip.calls} calls in the last 10 minutes errored.`
      : botStrip.throttled >= 20
        ? `${all[bot].label} is rate limiting us: ${botStrip.throttled} calls in the last 10 minutes were told to slow down. Tests still finish, but they queue. Lower MAX_CONCURRENT_CALLS or raise the deployment's tokens-per-minute.`
        : null,
    stats: {
      online: one<{ n: number }>("SELECT COUNT(*) n FROM participants WHERE last_seen>?", Date.now() - 30_000).n,
      participants: one<{ n: number }>("SELECT COUNT(*) n FROM participants WHERE name_key<>?", PRESENTER).n,
      messages: one<{ n: number }>("SELECT COUNT(*) n FROM messages").n,
      runs: one<{ n: number }>("SELECT COUNT(*) n FROM runs").n,
      calls: calls.n,
      cost: (calls.pin * PRICE_IN + calls.pout * PRICE_OUT) / 1_000_000,
      p95: p95(recentMs),
      errors: one<{ n: number }>("SELECT COUNT(*) n FROM calls WHERE ok=0 AND COALESCE(error,'') NOT LIKE '429%' AND COALESCE(error,'') NOT LIKE 'unreadable%'").n,
      throttled: one<{ n: number }>("SELECT COUNT(*) n FROM calls WHERE ok=0 AND error LIKE '429%'").n,
      // Answered 200 with a truncated or garbled body, then retried. Normal on ILMU; not a fault.
      garbled: one<{ n: number }>("SELECT COUNT(*) n FROM calls WHERE ok=0 AND error LIKE 'unreadable%'").n,
      filterBlocks: one<{ n: number }>("SELECT COUNT(*) n FROM calls WHERE filtered=1").n,
      markerErrors: one<{ n: number }>("SELECT COUNT(*) n FROM results WHERE reason=?", copy.markerFailed).n,
      queue: queue.stats,
    },
    participants: d.prepare(
      `SELECT p.id, p.name, p.name_key, p.last_seen,
        (SELECT COUNT(*) FROM runs r WHERE r.participant_id=p.id) runs,
        (SELECT COUNT(*) FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.participant_id=p.id AND m.role='user') messages
       FROM participants p ORDER BY p.name_key`
    ).all(),
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
  // One tile per group (the slide's four), each listing its targets — the presenter can +1 any target.
  const countOf = (key: string) => (counts[key] ?? 0) + (Number(getSetting(`tile_adjust_${key}`)) || 0);
  return {
    tiles: FIND_GROUPS.map((g) => {
      const types = typesInGroup(g.key).map((t) => ({ key: t.key, label: t.label, short: t.short, count: countOf(t.key) }));
      return { key: g.key, label: g.label, count: types.reduce((s, t) => s + t.count, 0), types };
    }),
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
    // Everyone has their own suite now, so read the keys off the run that produced these results.
    const must = (snap.questions ?? []).map((q) => q.key).filter((k) => snap.tiers[k] === "must");
    const mustMet = must.length
      ? must.every((k) => (passes.find((x) => x.question_key === k)?.n ?? 0) >= barFor("must", latest.runs_per_test))
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
      // "v3 · 19/20" when they published a version to customers. The version number counts every
      // run they started, so it matches the v-number they see in their own studio.
      shipped: (() => {
        const run = runs.find((r) => r.id === p.published_run_id);
        if (!run) return null;
        const v = (d.prepare("SELECT COUNT(*) n FROM runs WHERE participant_id=? AND id<=?").get(p.id, run.id) as { n: number }).n;
        return `v${v} · ${run.total}/${run.max}`;
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
