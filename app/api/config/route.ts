import type { NextRequest } from "next/server";
import { body, fail, json, withParticipant } from "@/lib/http";
import { saveConfig, type BotConfig } from "@/lib/participants";
import { getPhase } from "@/lib/settings";

export async function PUT(req: NextRequest) {
  const patch = await body<BotConfig>(req);
  return withParticipant(req, (p) => {
    if (getPhase() === "wrapup") return fail("Activity 2 is closed now.", 403);
    const clean: Partial<BotConfig> = {};
    if (typeof patch.system_prompt === "string") clean.system_prompt = patch.system_prompt;
    if (typeof patch.fallback_text === "string") clean.fallback_text = patch.fallback_text;
    if (typeof patch.temperature === "number") clean.temperature = patch.temperature;
    if (typeof patch.strictness === "string") clean.strictness = patch.strictness;
    for (const k of ["question_check", "answer_check", "one_job"] as const) if (typeof patch[k] === "boolean") clean[k] = patch[k];
    for (const k of ["knowledge", "input_rules", "output_rules", "topics"] as const) if (Array.isArray(patch[k])) (clean as Record<string, unknown>)[k] = patch[k];
    return json({ config: saveConfig(p.id, clean) });
  });
}
