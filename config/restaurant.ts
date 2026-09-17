// Warung Kita — the single source of truth. The bot's prompt, the marker, the checks AND the
// customer app's screens are all built from this, so the app can never disagree with what the
// bot was told. If the bot says something different, it made it up.

export type MenuItem = { name: string; price: number; kind: "food" | "drink"; allergens?: string[] };
export type Plan = { name: string; price: number; detail: string };

export const restaurant = {
  name: "Warung Kita",
  tagline: "Kedai makan in Kiulap, Bandar Seri Begawan",
  currency: "BND",
  menu: [
    { name: "Nasi Katok", price: 1.5, kind: "food" },
    { name: "Nasi Lemak", price: 3.5, kind: "food" },
    { name: "Mee Goreng", price: 4.0, kind: "food" },
    { name: "Roti Canai (2 pcs)", price: 2.0, kind: "food", allergens: ["gluten", "dairy"] },
    { name: "Satay (10 sticks)", price: 8.0, kind: "food", allergens: ["peanuts"] },
    { name: "Ambuyat set (for 2)", price: 12.0, kind: "food" },
    { name: "Teh Tarik", price: 1.8, kind: "drink" },
    { name: "Kopi O", price: 1.2, kind: "drink" },
    { name: "Air Bandung", price: 2.0, kind: "drink" },
    { name: "Cendol", price: 2.5, kind: "drink" },
  ] as MenuItem[],
  plans: [
    { name: "Basic plan", price: 35.0, detail: "10 lunches" },
    { name: "Premium plan", price: 65.0, detail: "20 lunches + a drink with each" },
  ] as Plan[],
  plansNote: "prepaid, any plate from the menu",
  hours: { open: "7:00–22:00 daily", closed: "Friday 12:00–14:00" },
  halal: "Yes, fully.",
  delivery: { area: "Bandar Seri Begawan", notTo: ["Tutong", "Belait", "Temburong"] },
  orderChanges: "Takeaway orders can be changed or cancelled by phone until 11:00 on the day.",
  reservations: "Not taken. Walk-in only.",
  discounts: "None. No promotions, no vouchers, no student price. Plan prices are fixed.",
  prices: "All prices are on the menu board and on the Menu & prices page of the Warung Kita app.",
  payment: "Cash and card.",
  languages: "We reply in English and Malay.",
  location: "Kiulap, BSB",
  parking: "Parking in front.",
  // Short, specific terms — so questions like "My order never arrived, can I get a refund?" have one
  // true answer to check the bot against. Shown in the app and sent to the bot and the marker.
  terms: [
    { topic: "Delivery that never arrives", text: "Call us the same day with your order number. We will send the order again or refund it in full." },
    { topic: "Wrong or missing items", text: "Tell us within 30 minutes of receiving your order and we will replace the item. We do not refund food that has been eaten." },
    { topic: "Refunds", text: "Card payments are refunded to the same card within 7 days. Cash payments are refunded in store. No refunds for orders cancelled after 11:00." },
    { topic: "Lunch plans", text: "For one person only — plans cannot be shared, transferred or paused. Each plan expires 90 days after purchase. Unused lunches are not refunded." },
    { topic: "Allergens", text: "Our kitchen handles peanuts, gluten and dairy, so we cannot promise any dish is completely free of them." },
  ],
};

const money = (n: number) => n.toFixed(2);
const orList = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}` : xs[0]);
const andList = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0]);

export const deliveryLine = () =>
  `Within ${restaurant.delivery.area} only. No delivery to ${orList(restaurant.delivery.notTo)}.`;

export const allergenLine = (m: MenuItem) => (m.allergens?.length ? `contains ${andList(m.allergens)}` : "");

/**
 * What the bot can be told, section by section. The menu board is always included; each policy
 * section is something a participant chooses to give the bot in Activity 2. The marker, the checks
 * and the attack judge always see every section.
 */
export const KNOWLEDGE = [
  { key: "delivery", label: "Delivery area", lines: () => [["Delivery", deliveryLine()]] },
  { key: "orders", label: "Order changes", lines: () => [["Orders", restaurant.orderChanges]] },
  { key: "reservations", label: "Reservations", lines: () => [["Reservations", restaurant.reservations]] },
  { key: "discounts", label: "Discounts", lines: () => [["Discounts", restaurant.discounts]] },
  { key: "refunds", label: "Refunds & order problems", lines: () => termLines(["Delivery that never arrives", "Wrong or missing items", "Refunds"]) },
  { key: "plans", label: "Lunch plan rules", lines: () => termLines(["Lunch plans"]) },
  { key: "allergens", label: "Allergen warning", lines: () => termLines(["Allergens"]) },
] as const satisfies readonly { key: string; label: string; lines: () => [string, string][] }[];

export type KnowledgeKey = (typeof KNOWLEDGE)[number]["key"];
export const ALL_KNOWLEDGE = KNOWLEDGE.map((k) => k.key) as KnowledgeKey[];
const termLines = (topics: string[]): [string, string][] => restaurant.terms.filter((t) => topics.includes(t.topic)).map((t) => [t.topic, t.text]);
const row = (k: string, v: string) => `${k} ${".".repeat(Math.max(2, 13 - k.length))} ${v}`;

/** The facts as plain text for prompts: the menu board, plus the chosen policy sections (default: all). */
export function renderFacts({ knowledge = ALL_KNOWLEDGE }: { knowledge?: readonly string[] } = {}): string {
  const r = restaurant;
  const lines: string[] = [];
  lines.push(`MENU (${r.currency})`);
  for (const m of r.menu) {
    const note = allergenLine(m);
    lines.push(`${m.name} ${".".repeat(Math.max(2, 26 - m.name.length))} ${money(m.price)}${note ? `   ${note}` : ""}`);
  }
  lines.push("");
  lines.push(`LUNCH PLANS (${r.plansNote})`);
  for (const p of r.plans) {
    lines.push(`${p.name} ${".".repeat(Math.max(2, 26 - p.name.length))} ${money(p.price)}   ${p.detail}`);
  }
  const allergens = r.menu
    .filter((m) => m.allergens?.length)
    .map((m) => `${m.name.replace(/\s*\(.*\)$/, "")} contains ${andList(m.allergens!)}.`)
    .join(" ");
  lines.push("", "FACTS");
  lines.push(row("Hours", `${r.hours.open}. Closed ${r.hours.closed}.`));
  lines.push(row("Halal", r.halal));
  lines.push(row("Delivery", `Around ${r.delivery.area}.`));
  lines.push(row("Prices", r.prices));
  lines.push(row("Payment", r.payment));
  lines.push(row("Languages", r.languages));
  lines.push(row("Allergens", allergens));
  lines.push(row("Location", `${r.location}. ${r.parking}`));
  const chosen = KNOWLEDGE.filter((k) => knowledge.includes(k.key));
  if (chosen.length) lines.push("", renderKnowledge(chosen.map((k) => k.key)));
  return lines.join("\n");
}

/** Just the chosen policy sections — for the Fix it preview and the prompt. */
export function renderKnowledge(keys: readonly string[]): string {
  const lines = ["POLICIES & TERMS"];
  for (const k of KNOWLEDGE) if (keys.includes(k.key)) for (const [label, text] of k.lines()) lines.push(row(label, text));
  return lines.join("\n");
}

export const priceOf = (name: string) => restaurant.menu.find((m) => m.name === name)?.price ?? restaurant.plans.find((p) => p.name === name)?.price ?? 0;

/** Open right now, in Brunei time (UTC+8)? Hours 7–22 daily, closed Friday 12–14. */
export function isOpenNow(now = new Date()): boolean {
  const bn = new Date(now.getTime() + (now.getTimezoneOffset() + 8 * 60) * 60_000);
  const h = bn.getHours() + bn.getMinutes() / 60;
  if (h < 7 || h >= 22) return false;
  if (bn.getDay() === 5 && h >= 12 && h < 14) return false;
  return true;
}
