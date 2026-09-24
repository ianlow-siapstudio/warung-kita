import OpenAI, { AzureOpenAI } from "openai";
import { mockChat } from "./mock";

export type ProviderName = "azure" | "ilmu" | "mock";
export type Purpose = "bot" | "marker" | "question_check" | "answer_check" | "ping";
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type ChatOpts = { temperature: number; json?: boolean; maxTokens?: number; purpose: Purpose };
export type ChatResult = {
  text: string;
  usage: { prompt: number; completion: number };
  ms: number;
  filtered?: boolean;
};

export interface Provider {
  name: ProviderName;
  label: string;
  model: string;
  configured: boolean;
  chat(messages: ChatMessage[], opts: ChatOpts): Promise<ChatResult>;
}

const TIMEOUT_MS = 20_000;

function isContentFilterError(err: unknown): boolean {
  const e = err as { status?: number; code?: string; error?: { code?: string; innererror?: { code?: string } } };
  if (!e || e.status !== 400) return false;
  const codes = [e.code, e.error?.code, e.error?.innererror?.code].filter(Boolean).map(String);
  return codes.some((c) => c.includes("content_filter") || c === "ResponsibleAIPolicyViolation");
}

export const isReasoningModel = (model: string) => /^(gpt-5|o\d)/i.test(model);

/**
 * Azure's newer "v1" API is plain OpenAI-compatible at https://<resource>/openai/v1 and needs no API
 * version. Accepts that URL, the resource URL, or an AI Foundry project URL (…/api/projects/<name>).
 */
export function azureV1BaseUrl(endpoint: string): string {
  const url = new URL(endpoint);
  return `${url.origin}/openai/v1`;
}

function openAiCompatible(
  name: ProviderName,
  label: string,
  model: string,
  client: OpenAI | null,
  supportsJsonMode: boolean
): Provider {
  return {
    name,
    label,
    model,
    configured: !!client,
    async chat(messages, opts) {
      if (!client) throw new Error(`${label} is not configured`);
      const started = Date.now();
      const limit = opts.maxTokens ?? 500;
      try {
        const res = await client.chat.completions.create({
          model,
          messages,
          // Reasoning models (gpt-5*, o-series) reject temperature and max_tokens, and spend part of the
          // token budget thinking — so ask for minimal thinking and leave room for the answer.
          ...(isReasoningModel(model)
            ? { max_completion_tokens: limit + 2000, reasoning_effort: /^o\d/i.test(model) ? ("low" as const) : ("minimal" as const) }
            : { temperature: opts.temperature, max_tokens: limit }),
          ...(opts.json && supportsJsonMode ? { response_format: { type: "json_object" as const } } : {}),
        });
        const choice = res.choices[0];
        return {
          text: choice?.message?.content ?? "",
          usage: { prompt: res.usage?.prompt_tokens ?? 0, completion: res.usage?.completion_tokens ?? 0 },
          ms: Date.now() - started,
          filtered: choice?.finish_reason === "content_filter",
        };
      } catch (err) {
        if (isContentFilterError(err)) {
          return { text: "", usage: { prompt: 0, completion: 0 }, ms: Date.now() - started, filtered: true };
        }
        throw err;
      }
    },
  };
}

function build(): Record<ProviderName, Provider> {
  const env = process.env;

  const azureOk = !!(env.AZURE_OPENAI_ENDPOINT && env.AZURE_OPENAI_API_KEY && env.AZURE_OPENAI_DEPLOYMENT);
  const deployment = env.AZURE_OPENAI_DEPLOYMENT || "gpt-4o-mini";
  // With an API version: the classic Azure API. Without one: the v1 API (what AI Foundry shows).
  const azureClient = !azureOk
    ? null
    : env.AZURE_OPENAI_API_VERSION
      ? new AzureOpenAI({
          endpoint: env.AZURE_OPENAI_ENDPOINT,
          apiKey: env.AZURE_OPENAI_API_KEY,
          deployment,
          apiVersion: env.AZURE_OPENAI_API_VERSION,
          timeout: TIMEOUT_MS,
          maxRetries: 0,
        })
      : new OpenAI({ baseURL: azureV1BaseUrl(env.AZURE_OPENAI_ENDPOINT!), apiKey: env.AZURE_OPENAI_API_KEY, timeout: TIMEOUT_MS, maxRetries: 0 });

  // ILMU: assumed OpenAI-compatible (/chat/completions, Bearer key). Swap for a thin adapter if not.
  const ilmuOk = !!(env.ILMU_BASE_URL && env.ILMU_API_KEY && env.ILMU_MODEL);
  const ilmuClient = ilmuOk
    ? new OpenAI({ baseURL: env.ILMU_BASE_URL, apiKey: env.ILMU_API_KEY, timeout: TIMEOUT_MS, maxRetries: 0 })
    : null;

  return {
    azure: openAiCompatible("azure", `Azure ${deployment}`, deployment, azureClient, true),
    ilmu: openAiCompatible("ilmu", "ILMU", env.ILMU_MODEL || "ilmu", ilmuClient, false),
    mock: {
      name: "mock",
      label: "Offline mock",
      model: "mock",
      configured: true,
      chat: mockChat,
    },
  };
}

type Global = typeof globalThis & { __wkProviders?: { key: string; list: Record<ProviderName, Provider> } };
const g = globalThis as Global;

// Rebuilt when the code or the credentials change, so a running dev server picks both up.
const BUILD = "2";

export function providers(): Record<ProviderName, Provider> {
  const e = process.env;
  const key = [BUILD, e.AZURE_OPENAI_ENDPOINT, e.AZURE_OPENAI_DEPLOYMENT, e.AZURE_OPENAI_API_VERSION, e.AZURE_OPENAI_API_KEY?.length, e.ILMU_BASE_URL, e.ILMU_MODEL].join("|");
  if (g.__wkProviders?.key !== key) g.__wkProviders = { key, list: build() };
  return g.__wkProviders.list;
}

/** The default for everything that measures (marker, checks, attack judge). Overridden by the admin's pick. */
export function defaultMeasuringProvider(): ProviderName {
  const env = process.env.MEASURING_PROVIDER as ProviderName | undefined;
  if (env && providers()[env]?.configured) return env;
  return providers().azure.configured ? "azure" : "mock";
}

/** Which providers can be picked to do the measuring. */
export function markerChoices(): ProviderName[] {
  const all = providers();
  const list = (["azure", "ilmu"] as ProviderName[]).filter((n) => all[n].configured);
  if (!list.length || process.env.ENABLE_MOCK === "1") list.push("mock");
  return list;
}

/** Which bot choices the admin dropdown offers. */
export function botChoices(): ProviderName[] {
  const list: ProviderName[] = ["azure", "ilmu"];
  if (!providers().azure.configured || process.env.ENABLE_MOCK === "1") list.push("mock");
  return list;
}
