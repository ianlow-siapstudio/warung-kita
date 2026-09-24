import type { NextRequest } from "next/server";
import { MAX_RULES, MAX_RULE_CHARS } from "@/config/questions";
import { getQuestions } from "@/lib/questions";
import { json, withParticipant } from "@/lib/http";
import { ensureStarterRules, getConfig, getRules, getTiers } from "@/lib/participants";
import { ATTACKS, ATTACK_RUNS } from "@/config/attacks";
import { KNOWLEDGE, renderFacts, renderKnowledge } from "@/config/restaurant";
import { naiveInstructions } from "@/lib/prompts";
import { isReasoningModel, providers } from "@/lib/providers";
import { db } from "@/lib/db";
import { activeRunId, runHistory } from "@/lib/runs";
import { getBotModel, getPhase, getRunsPerTest } from "@/lib/settings";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return withParticipant(req, (p) => {
    ensureStarterRules(p.id);
    const { runs: history } = runHistory(p.id);
    return json({
      phase: getPhase(),
      runsPerTest: getRunsPerTest(),
      questions: getQuestions(p.id),
      limits: { maxRules: MAX_RULES, maxChars: MAX_RULE_CHARS },
      config: getConfig(p.id),
      rules: getRules(p.id),
      tiers: getTiers(p.id),
      naivePrompt: naiveInstructions(),
      facts: renderFacts({ knowledge: [] }),
      knowledgeSections: KNOWLEDGE.map((k) => ({ key: k.key, label: k.label, text: renderKnowledge([k.key]) })),
      attacks: ATTACKS,
      attackRuns: ATTACK_RUNS,
      // The targets this person reported in Activity 1 — the attack suite is their own findings.
      foundInActivity1: (db().prepare(
        `SELECT DISTINCT m.category FROM messages m JOIN conversations c ON c.id=m.conversation_id
         WHERE c.participant_id=? AND c.phase='activity1' AND m.role='assistant' AND m.category IS NOT NULL`
      ).all(p.id) as { category: string }[]).map((r) => r.category),
      // The offline stand-in ignores it as well, so the dial would do nothing.
      botIgnoresTemperature: getBotModel() === "mock" || isReasoningModel(providers()[getBotModel()].model),
      publishedRunId: (db().prepare("SELECT published_run_id FROM participants WHERE id=?").get(p.id) as { published_run_id: number | null }).published_run_id,
      history,
      activeRunId: activeRunId(p.id),
      latestRunId: history.length ? history[history.length - 1].id : null,
    });
  });
}
