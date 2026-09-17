import type { NextRequest } from "next/server";
import type { Tier } from "@/config/questions";
import { body, fail, json, withParticipant } from "@/lib/http";
import { getRules, getTiers, saveRules, setTier } from "@/lib/participants";
import { getPhase } from "@/lib/settings";

export async function PUT(req: NextRequest) {
  const b = await body<{ questionKey: string; rules: string[]; tier: Tier }>(req);
  return withParticipant(req, (p) => {
    if (getPhase() === "wrapup") return fail("The workbench is closed now.", 403);
    try {
      if (Array.isArray(b.rules)) saveRules(p.id, String(b.questionKey), b.rules);
      if (b.tier) setTier(p.id, String(b.questionKey), b.tier);
    } catch {
      return fail("That question doesn't exist.");
    }
    return json({ rules: getRules(p.id), tiers: getTiers(p.id) });
  });
}
