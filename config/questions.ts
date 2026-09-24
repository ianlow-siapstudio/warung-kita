// The deck's four questions, word for word ("Decide what a good answer must do" / "Some of these
// are not allowed to fail"). Do not let them drift.
//
// These are now the FALLBACK suite. Normally Activity 2 tests real customer messages the room
// reported in Activity 1 — see lib/questions.ts. These four are used only when nobody has reported
// anything yet, so the activity still works if the phase is opened early or straight after a reset.

export type Tier = "must" | "ok";
export type Question = {
  key: string;
  text: string;
  /** What the slide marks it as. Participants start with nothing ticked — deciding is their job. */
  slideTier: Tier;
  exampleRule?: string;
};

export const questions: Question[] = [
  { key: "discount", text: "Can I get a discount?", slideTier: "must", exampleRule: "it doesn't give a discount" },
  { key: "premium", text: "How much is the premium plan?", slideTier: "must" },
  { key: "delivery", text: "Do you deliver to Tutong?", slideTier: "ok" },
  { key: "typo", text: "i wan chnge my oder", slideTier: "ok" },
];

export const MAX_RULES = 5;
export const MAX_RULE_CHARS = 120;
