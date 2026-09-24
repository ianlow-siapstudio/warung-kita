import { db, now } from "./db";
import { providers, type ChatMessage, type ProviderName, type Purpose } from "./providers";
import { queue } from "./queue";

export type LlmResult = { text: string; filtered: boolean; ms: number; provider: ProviderName };

export class LlmError extends Error {}
/** Thrown when the provider kept saying "too many requests". Not the bot's fault, and not a fail. */
export class RateLimited extends LlmError {}

/** How long the provider asked us to wait, or null when this error isn't a rate limit. */
function rateLimitWait(err: unknown): number | null {
  const e = err as { status?: number; message?: string; headers?: Headers | Record<string, string> };
  const status = e?.status ?? (/\b429\b/.test(String(e?.message ?? "")) ? 429 : undefined);
  if (status !== 429 && status !== 503) return null;
  const h = e?.headers;
  const header = (k: string) => (h instanceof Headers ? h.get(k) : (h as Record<string, string> | undefined)?.[k]);
  const ms = Number(header("retry-after-ms"));
  if (ms > 0) return ms;
  const secs = Number(header("retry-after"));
  if (secs > 0) return secs * 1000;
  return 0; // rate limited, but not told how long — back off on our own
}

/**
 * A rate limit is normal when a room tests together. Waiting costs time; giving up costs a wrong
 * score on someone's card — so be patient. A marking that never happens reads as "your bot failed".
 */
const RATE_LIMIT_RETRIES = 10;

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
  const attempts = 1 + (opts.retries ?? (opts.json ? 4 : 1));
  let lastErr: unknown;
  let tries = 0;
  let waits = 0;
  while (true) {
    const started = Date.now();
    try {
      const res: Awaited<ReturnType<typeof provider.chat>> = await queue.run(opts.owner, () =>
        provider.chat(messages, {
          purpose,
          temperature: opts.temperature ?? TEMPERATURE[purpose],
          json: opts.json,
          maxTokens: opts.maxTokens,
        })
      );
      // A provider under strain can answer 200 with a truncated body. When we asked for JSON and
      // didn't get any, that is a failed call, not a failed answer — retry it like any other.
      const unusable = !!opts.json && !res.filtered && parseJson(res.text) === null;
      logCall(purpose, providerName, provider.model, {
        prompt: res.usage.prompt, completion: res.usage.completion, ms: res.ms, ok: !unusable, filtered: res.filtered,
        error: unusable ? `unreadable reply: ${res.text.slice(0, 80)}` : undefined,
      });
      if (unusable) {
        queue.tighten();
        lastErr = new Error("the model replied with something that isn't JSON");
        if (++tries >= attempts) break;
        await new Promise((r) => setTimeout(r, 150 + Math.random() * 400));
        continue;
      }
      return { text: res.text, filtered: !!res.filtered, ms: res.ms, provider: providerName };
    } catch (err) {
      lastErr = err;
      logCall(purpose, providerName, provider.model, {
        ms: Date.now() - started, ok: false, error: String((err as Error)?.message ?? err).slice(0, 300),
      });
      const asked = rateLimitWait(err);
      if (asked !== null && waits < RATE_LIMIT_RETRIES) {
        waits++;
        // Honour what the provider asked for; otherwise back off, a little further every time.
        const wait = asked || Math.min(15_000, 400 * 2 ** waits);
        queue.slowDown(wait);
        await new Promise((r) => setTimeout(r, wait + Math.random() * 300));
        continue;
      }
      if (asked !== null) throw new RateLimited(String((err as Error)?.message ?? err));
      if (++tries >= attempts) break;
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
