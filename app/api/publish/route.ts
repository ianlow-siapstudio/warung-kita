import type { NextRequest } from "next/server";
import { getQuestions } from "@/lib/questions";
import { db } from "@/lib/db";
import { shipGate } from "@/lib/gate";
import { body, fail, json, withParticipant } from "@/lib/http";
import { getConfig, getRules, getTiers } from "@/lib/participants";
import { runView } from "@/lib/runs";
import { getPhase } from "@/lib/settings";

/** Publish a tested draft to customers — only if it passes the ship gate. */
export async function POST(req: NextRequest) {
  const { runId } = await body<{ runId: number }>(req);
  return withParticipant(req, (p) => {
    const phase = getPhase();
    if (phase !== "activity2") return fail("Publishing isn't open right now.", 403);
    const latest = db().prepare("SELECT id FROM runs WHERE participant_id=? ORDER BY id DESC LIMIT 1").get(p.id) as { id: number } | undefined;
    if (!latest || latest.id !== Number(runId)) return fail("You can only publish your latest test.");
    const run = runView(latest.id)!;
    const draft = { config: getConfig(p.id), rules: getRules(p.id), tiers: getTiers(p.id) };
    const gate = shipGate(run, { config: run.config, rules: run.rules, tiers: run.tiers }, draft, run.questions.map((q) => q.key));
    if (!gate.ready) return fail(gate.summary);
    db().prepare("UPDATE participants SET published_run_id=? WHERE id=?").run(latest.id, p.id);
    return json({ publishedRunId: latest.id });
  });
}
