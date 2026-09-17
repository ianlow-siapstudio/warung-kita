import type Database from "better-sqlite3";
import { questions } from "@/config/questions";
import type { CachedData, ResultRow } from "./runs";
import { rulesHash } from "./runs";

// Presenter's Module 3 demo rules: specific rules → one failure on delivery.
export const DEMO_RULES: Record<string, string[]> = {
  discount: ["it doesn't give a discount"],
  premium: ["it says the premium plan is B$65"],
  delivery: ["it says it only delivers within Bandar Seri Begawan"],
  typo: ["it understands they want to change their order"],
};

// The vague-rule re-run where everything passes.
export const VAGUE_RULES: Record<string, string[]> = {
  discount: ["it is polite"],
  premium: ["it answers the question"],
  delivery: ["it answers the question"],
  typo: ["it is helpful"],
};

const ANSWERS: Record<string, string[]> = {
  discount: [
    "Sorry, we don't offer any discounts — all our prices are fixed. Our Basic lunch plan is B$35 for 10 lunches if you eat with us often!",
    "Thanks for asking! We don't have discounts, vouchers or promotions, but our prices are on the menu board.",
    "I'm sorry, Warung Kita doesn't do discounts. Everything is priced on our menu & prices page.",
    "We don't have any discounts right now, sorry! Plan prices are fixed too.",
    "Unfortunately no — there are no discounts or student prices at Warung Kita.",
  ],
  premium: [
    "The Premium plan is B$65.00 — that's 20 lunches plus a drink with each one.",
    "Our Premium lunch plan costs B$65 for 20 lunches, and you get a drink with every lunch!",
    "Premium plan: B$65.00 for 20 prepaid lunches + a drink each time.",
    "It's B$65 for the Premium plan (20 lunches with a drink each).",
    "The Premium plan is B$65 — 20 lunches, each with a drink. Any plate from the menu!",
  ],
  delivery: [
    "Sorry, we only deliver within Bandar Seri Begawan, so Tutong is outside our delivery area.",
    "Unfortunately not — delivery is within BSB only. You're welcome to visit us in Kiulap!",
    "Yes, we deliver across Brunei, including Tutong! 🛵",
    "We don't deliver to Tutong, sorry — only within Bandar Seri Begawan.",
    "Sorry, Tutong is outside our delivery area. We deliver within Bandar Seri Begawan only.",
  ],
  typo: [
    "No problem! You can change or cancel a takeaway order by phone until 11:00 on the day. What would you like to change?",
    "Of course — please call us before 11:00 today and we'll change your takeaway order.",
    "Sure, orders can be changed by phone until 11:00 on the day. What do you need to change?",
    "You'd like to change your order? Just give us a call before 11:00 on the day.",
    "Happy to help! Takeaway orders can be changed or cancelled by phone until 11:00.",
  ],
};

function syntheticRun(vague: boolean): CachedData {
  const results: ResultRow[] = [];
  for (let i = 1; i <= 5; i++) {
    for (const q of questions) {
      const answer = ANSWERS[q.key][i - 1];
      const wrongDelivery = q.key === "delivery" && i === 3;
      const fail = wrongDelivery && !vague;
      results.push({
        question_key: q.key,
        iteration: i,
        answer,
        original_answer: null,
        blocked_by: null,
        pass: !fail,
        failed_rules: fail ? [1] : [],
        reason: fail
          ? "It says it delivers to Tutong, but Warung Kita only delivers within Bandar Seri Begawan."
          : wrongDelivery
            ? "It answers the question and is friendly."
            : "The answer follows every rule.",
      });
    }
  }
  return { runs_per_test: 5, results };
}

/** Idempotent. Creates the `presenter` participant and the cached demo runs. */
export function seed(d: Database.Database) {
  const t = Date.now();
  let presenter = d.prepare("SELECT id FROM participants WHERE name_key='presenter'").get() as { id: number } | undefined;
  if (!presenter) {
    const info = d.prepare("INSERT INTO participants (name, name_key, created_at) VALUES ('presenter','presenter',?)").run(t);
    presenter = { id: Number(info.lastInsertRowid) };
    const ins = d.prepare("INSERT INTO rules (participant_id, question_key, text, position) VALUES (?,?,?,?)");
    for (const [k, rules] of Object.entries(DEMO_RULES)) rules.forEach((r, i) => ins.run(presenter!.id, k, r, i));
    const tier = d.prepare("INSERT OR IGNORE INTO tiers (participant_id, question_key, tier) VALUES (?,?,?)");
    for (const q of questions) tier.run(presenter.id, q.key, q.slideTier);
  }

  const count = (d.prepare("SELECT COUNT(*) AS n FROM cached_demo").get() as { n: number }).n;
  if (count === 0) {
    const ins = d.prepare("INSERT INTO cached_demo (provider, rules_hash, label, data, created_at) VALUES (?,?,?,?,?)");
    for (const provider of ["azure", "ilmu", "mock"]) {
      ins.run(provider, rulesHash(DEMO_RULES), "seeded · specific rules · 19/20", JSON.stringify(syntheticRun(false)), t);
      ins.run(provider, rulesHash(VAGUE_RULES), "seeded · vague rules · 20/20", JSON.stringify(syntheticRun(true)), t);
    }
  }

  if (!d.prepare("SELECT 1 FROM settings WHERE key='phase'").get()) {
    d.prepare("INSERT INTO settings (key, value) VALUES ('phase','closed')").run();
  }
}
