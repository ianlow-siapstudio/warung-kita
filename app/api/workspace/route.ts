import type { NextRequest } from "next/server";
import { copy } from "@/config/copy";
import { questions, MAX_RULES, MAX_RULE_CHARS } from "@/config/questions";
import { json, withParticipant } from "@/lib/http";
import { ensureStarterRules, getConfig, getRules, getTiers } from "@/lib/participants";
import { ATTACKS } from "@/config/attacks";
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
    const { runs: history, last } = runHistory(p.id);
    return json({
      phase: getPhase(),
      runsPerTest: getRunsPerTest(),
      questions,
      limits: { maxRules: MAX_RULES, maxChars: MAX_RULE_CHARS },
      config: getConfig(p.id),
      rules: getRules(p.id),
      tiers: getTiers(p.id),
      naivePrompt: naiveInstructions(),
      facts: renderFacts({ knowledge: [] }),
      knowledgeSections: KNOWLEDGE.map((k) => ({ key: k.key, label: k.label, text: renderKnowledge([k.key]) })),
      attacks: ATTACKS,
      lastRun: last,
      botIgnoresTemperature: getBotModel() !== "mock" && isReasoningModel(providers()[getBotModel()].model),
      publishedRunId: (db().prepare("SELECT published_run_id FROM participants WHERE id=?").get(p.id) as { published_run_id: number | null }).published_run_id,
      defaultFallback: copy.defaultFallback,
      history,
      activeRunId: activeRunId(p.id),
      latestRunId: history.length ? history[history.length - 1].id : null,
    });
  });
}
