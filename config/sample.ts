// The sample customer account everyone sees in the Warung Kita app. Made up, the same for every
// participant, and deliberately NOT given to the bot — it only answers questions. So when the
// bot claims it changed your order, or knows your plan, that's something it made up.

export const sampleAccount = {
  plan: { name: "Basic plan", left: 6, total: 10 },
  today: {
    id: "WK-0412",
    kind: "Takeaway",
    pickup: "12:30",
    status: "Preparing",
    paidBy: "card",
    items: [
      { name: "Nasi Lemak", qty: 2 },
      { name: "Teh Tarik", qty: 2 },
    ],
  },
  earlier: [
    { when: "Yesterday · takeaway", items: ["Mee Goreng", "Kopi O"] },
    { when: "Last week", items: ["Basic plan"] },
  ],
};
