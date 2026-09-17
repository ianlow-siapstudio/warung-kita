import type { NextRequest } from "next/server";
import { body, fail, json, withAdmin } from "@/lib/http";
import { llm } from "@/lib/llm";
import { providers, type ProviderName } from "@/lib/providers";

export async function POST(req: NextRequest) {
  const { provider } = await body<{ provider: ProviderName }>(req);
  return withAdmin(req, async () => {
    const p = provider && providers()[provider];
    if (!p) return fail("Unknown provider.");
    if (!p.configured) return json({ ok: false, error: "not configured" });
    const started = Date.now();
    try {
      const r = await llm("ping", p.name, [{ role: "user", content: "Reply with the single word: ok" }], { owner: "admin", maxTokens: 5, retries: 0 });
      return json({ ok: true, ms: Date.now() - started, text: r.text.slice(0, 40), filtered: r.filtered });
    } catch (err) {
      let error = String((err as Error).message).slice(0, 200);
      if (/api version not supported/i.test(error)) error += " — for AI Foundry, leave AZURE_OPENAI_API_VERSION blank (that date is the model version, not an API version).";
      return json({ ok: false, ms: Date.now() - started, error });
    }
  });
}
