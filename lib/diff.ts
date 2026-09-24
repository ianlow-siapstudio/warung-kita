// What changed between two runs, in plain words. Shared by the server (score history) and the
// browser (the "changed since your last run" line) — so no server-only imports here.

import { KNOWLEDGE } from "@/config/restaurant";

const knowledgeLabel = (k: string) => (KNOWLEDGE.find((x) => x.key === k)?.label ?? k).toLowerCase();

export type Snapshot = {
  config: { system_prompt: string; question_check: boolean; answer_check: boolean; one_job: boolean; fallback_text: string; temperature?: number; strictness?: string;
    knowledge?: string[]; input_rules?: string[]; output_rules?: string[]; topics?: string[] };
  rules: Record<string, string[]>;
  tiers: Record<string, string>;
};

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export function describeChanges(prev: Snapshot, next: Snapshot, questionKeys: string[]): string[] {
  const out: string[] = [];
  const a = prev.config, b = next.config;
  if (norm(a.system_prompt) !== norm(b.system_prompt)) out.push("rewrote the prompt");
  const added = (b.knowledge ?? []).filter((k) => !(a.knowledge ?? []).includes(k));
  const removed = (a.knowledge ?? []).filter((k) => !(b.knowledge ?? []).includes(k));
  if (added.length) out.push(`gave it ${added.map(knowledgeLabel).join(", ")}`);
  if (removed.length) out.push(`took away ${removed.map(knowledgeLabel).join(", ")}`);
  const listChanged = (x?: string[], y?: string[]) => (x ?? []).map(norm).join("|") !== (y ?? []).map(norm).join("|");
  if (listChanged(a.input_rules, b.input_rules)) out.push("changed input check rules");
  if (listChanged(a.output_rules, b.output_rules)) out.push("changed output check rules");
  if (listChanged(a.topics, b.topics)) out.push("changed allowed topics");
  if (a.question_check !== b.question_check) out.push(`input check ${b.question_check ? "on" : "off"}`);
  if (a.answer_check !== b.answer_check) out.push(`output check ${b.answer_check ? "on" : "off"}`);
  if (a.one_job !== b.one_job) out.push(`topic limit ${b.one_job ? "on" : "off"}`);
  if (norm(a.fallback_text) !== norm(b.fallback_text)) out.push("changed the safe reply");
  if ((a.strictness ?? "balanced") !== (b.strictness ?? "balanced")) out.push(`checks ${a.strictness ?? "balanced"} → ${b.strictness ?? "balanced"}`);
  if ((a.temperature ?? 0.5) !== (b.temperature ?? 0.5)) out.push(`creativity ${a.temperature ?? 0.5} → ${b.temperature ?? 0.5}`);

  const ruleQs = questionKeys
    .map((k, i) => ((prev.rules[k] ?? []).map(norm).join("|") !== (next.rules[k] ?? []).map(norm).join("|") ? i + 1 : 0))
    .filter(Boolean);
  if (ruleQs.length) out.push(`changed rules on Q${ruleQs.join(", Q")}`);

  const tierQs = questionKeys.map((k, i) => ((prev.tiers[k] ?? "ok") !== (next.tiers[k] ?? "ok") ? i + 1 : 0)).filter(Boolean);
  if (tierQs.length) out.push(`changed must-not-fail on Q${tierQs.join(", Q")}`);
  return out;
}

/** Things that change the bot (as opposed to how it's marked). Used for the one-at-a-time nudge. */
export const botChanges = (changes: string[]) => changes.filter((c) => !c.startsWith("changed rules") && !c.startsWith("changed must"));
