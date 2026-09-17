import { db, now } from "./db";
import { providers, type ChatMessage, type ProviderName, type Purpose } from "./providers";
import { queue } from "./queue";

export type LlmResult = { text: string; filtered: boolean; ms: number; provider: ProviderName };

export class LlmError extends Error {}

const TEMPERATURE: Record<Purpose, number> = {
  bot: 0.5, // fallback only — the bot uses the participant's own setting (BotConfig.temperature)
  marker: 0,
  question_check: 0,
  answer_check: 0,
  ping: 0,
};

function logCall(purpose: Purpose, provider: ProviderName, model: string, r: {
  prompt?: number; completion?: number; ms: number; ok: boolean; filtered?: boolean; error?: string;
}) {
  db()
    .prepare(
      `INSERT INTO calls (purpose, provider, model, prompt_tokens, completion_tokens, ms, ok, filtered, error, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
    .run(purpose, provider, model, r.prompt ?? 0, r.completion ?? 0, r.ms, r.ok ? 1 : 0, r.filtered ? 1 : 0, r.error ?? null, now());
}

/** Every model call goes through here: queue (concurrency 8) → 20 s timeout → one retry → logged to `calls`. */
export async function llm(
  purpose: Purpose,
  providerName: ProviderName,
  messages: ChatMessage[],
  opts: { owner: string; json?: boolean; maxTokens?: number; temperature?: number; retries?: number }
): Promise<LlmResult> {
  const provider = providers()[providerName];
  const attempts = 1 + (opts.retries ?? 1);
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    const started = Date.now();
    try {
      const res = await queue.run(opts.owner, () =>
        provider.chat(messages, {
          purpose,
          temperature: opts.temperature ?? TEMPERATURE[purpose],
          json: opts.json,
          maxTokens: opts.maxTokens,
        })
      );
      logCall(purpose, providerName, provider.model, {
        prompt: res.usage.prompt, completion: res.usage.completion, ms: res.ms, ok: true, filtered: res.filtered,
      });
      return { text: res.text, filtered: !!res.filtered, ms: res.ms, provider: providerName };
    } catch (err) {
      lastErr = err;
      logCall(purpose, providerName, provider.model, {
        ms: Date.now() - started, ok: false, error: String((err as Error)?.message ?? err).slice(0, 300),
      });
    }
  }
  throw new LlmError(String((lastErr as Error)?.message ?? lastErr));
}

/** Pull the first JSON object out of a reply. Returns null if there isn't a usable one. */
export function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]) as T;
    } catch {
      return null;
    }
  }
}
