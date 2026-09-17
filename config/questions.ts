// The four Activity 2 questions — word for word from the deck ("Decide what a good answer must do"
// and "Some of these are not allowed to fail"). Do not let them drift.

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
