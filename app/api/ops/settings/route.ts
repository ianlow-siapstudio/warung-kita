import type { NextRequest } from "next/server";
import { body, fail, json, withAdmin } from "@/lib/http";
import { botChoices, markerChoices, type ProviderName } from "@/lib/providers";
import { buildSuitesForRoom } from "@/lib/questions";
import { PHASES, setSetting, type Phase } from "@/lib/settings";

export async function POST(req: NextRequest) {
  const b = await body<{ phase: Phase; runsPerTest: number; botModel: ProviderName; markerModel: ProviderName }>(req);
  return withAdmin(req, () => {
    if (b.phase !== undefined) {
      if (!PHASES.includes(b.phase)) return fail("Unknown phase.");
      setSetting("phase", b.phase);
      // Everyone's tests come from the same snapshot of what the room reported.
      if (b.phase === "activity2") buildSuitesForRoom();
    }
    if (b.runsPerTest !== undefined) {
      const n = Number(b.runsPerTest);
      if (![3, 5, 10].includes(n)) return fail("Runs per test must be 3, 5 or 10.");
      setSetting("runs_per_test", String(n));
    }
    if (b.botModel !== undefined) {
      if (!botChoices().includes(b.botModel)) return fail("Unknown bot model.");
      setSetting("bot_model", b.botModel);
    }
    if (b.markerModel !== undefined) {
      if (!markerChoices().includes(b.markerModel)) return fail("Unknown marker model.");
      setSetting("marker_model", b.markerModel);
    }
    return json({ ok: true });
  });
}
