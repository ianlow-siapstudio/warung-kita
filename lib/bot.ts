import { copy } from "@/config/copy";
import { llm, parseJson } from "./llm";
import type { BotConfig } from "./participants";
import { composeSystemPrompt, inputCheckPrompt, outputCheckPrompt } from "./prompts";
import { type ChatMessage, type ProviderName } from "./providers";
import { measuringProvider } from "./settings";
import { db } from "./db";

export type BlockedBy = "question_check" | "one_job" | "answer_check" | "azure_filter" | null;
export type BotReply = { text: string; blockedBy: BlockedBy; original: string | null; botModel: ProviderName };

/**
 * One customer turn. Order: question check → (bot) → answer check. Each adds at most one cheap call.
 * Throws LlmError if the AI doesn't answer (after one retry).
 */
export async function respond(
  config: BotConfig,
  history: { role: "user" | "assistant"; content: string }[],
  botModel: ProviderName,
  owner: string
): Promise<BotReply> {
  const measuring = measuringProvider();
  const question = history[history.length - 1]?.content ?? "";

  // Input check (block rules) and topic limit (allowed topics): one call. A check with no rules does nothing.
  const blockRules = config.question_check ? config.input_rules : [];
  const topics = config.one_job ? config.topics : [];
  if (blockRules.length || topics.length) {
    const prevBot = [...history].reverse().find((m) => m.role === "assistant")?.content;
    const res = await llm("question_check", measuring, [{ role: "user", content: inputCheckPrompt(question, { blockRules, topics, strictness: config.strictness, previousBotMessage: prevBot }) }], { owner, json: true, maxTokens: 40 });
    // If Azure's own jailbreak shield refuses to even read the message, whichever check is on blocks it.
    const v = res.filtered ? { matches: blockRules.length ? [1] : [], on_topic: !!blockRules.length } : parseJson<{ matches?: unknown; on_topic?: boolean }>(res.text) ?? {};
    const matched = Array.isArray(v.matches) && v.matches.some((n) => Number(n) >= 1 && Number(n) <= blockRules.length);
    if (blockRules.length && matched) return { text: config.fallback_text, blockedBy: "question_check", original: null, botModel };
    if (topics.length && v.on_topic === false) return { text: config.fallback_text, blockedBy: "one_job", original: null, botModel };
  }

  const messages: ChatMessage[] = [{ role: "system", content: composeSystemPrompt(config.system_prompt, config.knowledge) }, ...history.slice(-20)];
  const answer = await llm("bot", botModel, messages, { owner, maxTokens: 400, temperature: config.temperature });
  if (answer.filtered) return { text: copy.aiDeclined, blockedBy: "azure_filter", original: null, botModel };

  if (config.answer_check && config.output_rules.length) {
    const res = await llm("answer_check", measuring, [{ role: "user", content: outputCheckPrompt(question, answer.text, { blockRules: config.output_rules, strictness: config.strictness }) }], { owner, json: true, maxTokens: 40 });
    const broken = parseJson<{ breaks?: unknown }>(res.text)?.breaks;
    const block = res.filtered || (Array.isArray(broken) && broken.some((n) => Number(n) >= 1 && Number(n) <= config.output_rules.length));
    if (block) return { text: config.fallback_text, blockedBy: "answer_check", original: answer.text, botModel };
  }

  return { text: answer.text, blockedBy: null, original: null, botModel };
}
