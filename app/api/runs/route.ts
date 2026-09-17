import type { NextRequest } from "next/server";
import { fail, json, withParticipant } from "@/lib/http";
import { PRESENTER } from "@/lib/participants";
import { startRun } from "@/lib/runs";
import { getPhase } from "@/lib/settings";

export function POST(req: NextRequest) {
  return withParticipant(req, (p) => {
    const phase = getPhase();
    if (phase === "demo" && p.name_key !== PRESENTER) return fail("Watch the screen — you'll run your own tests in a moment.", 403);
    if (phase !== "activity2" && phase !== "demo") return fail("Running tests isn't open right now.", 403);
    const r = startRun(p, phase);
    if ("error" in r) return fail(r.error);
    return json(r);
  });
}
