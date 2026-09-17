import type { NextRequest } from "next/server";
import { body, fail, json, withAdmin } from "@/lib/http";
import { botChoices, type ProviderName } from "@/lib/providers";
import { PHASES, setSetting, type Phase } from "@/lib/settings";

export async function POST(req: NextRequest) {
  const b = await body<{ phase: Phase; runsPerTest: number; botModel: ProviderName; cachedDemo: boolean }>(req);
  return withAdmin(req, () => {
    if (b.phase !== undefined) {
      if (!PHASES.includes(b.phase)) return fail("Unknown phase.");
      setSetting("phase", b.phase);
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
    if (b.cachedDemo !== undefined) setSetting("cached_demo", b.cachedDemo ? "1" : "0");
    return json({ ok: true });
  });
}
