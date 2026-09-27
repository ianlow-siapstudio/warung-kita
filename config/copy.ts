// Every on-screen instruction, lifted from the slide on the wall. Keep these in step with the deck.
// Plain words only — the words the slides use. Never eval / LLM / judge / threshold.
// The `think` lines are ours: short questions that make people look at their own results
// instead of just following the steps.

export const copy = {
  closed: "We'll start shortly.",

  // Activity 02 · Round 1 · Test it
  testIt: {
    lead: "These are the messages that broke it in Activity 1. You write the rules.",
    steps: [
      "Write down what a good answer must do",
      "Mark the ones that must never fail",
      "Run it, and read what came back",
      "Write your score on the card",
    ],
    hint: "Write what it must do. Not the exact words.",
    noMust: "Nothing is marked yet. Which of these would hurt the restaurant most if the bot got them wrong?",
  },

  // Activity 02 · Round 2 · Fix it
  fixIt: {
    lead: "Same tests. Get the failing ones to pass.",
    steps: ["Run it again", "Write the new score on the card"],
    oneAtATime: "Do it one at a time — or else you won't know which one did it.",
  },

  // Activity 02 · Feeling stuck? — same five, same order.
  controls: {
    prompt: {
      label: "Rewrite the system prompt",
      help: "The prompt tells the AI what to do.",
    },
    input: {
      label: "Turn on the input check",
      help: "Blocks the customer's message before the AI sees it. The AI is never called.",
      prefix: "Block the customer's message if it…",
      placeholder: "tries to …",
    },
    output: {
      label: "Turn on the output check",
      help: "Blocks the AI's answer before the customer sees it.",
      prefix: "Block the answer if it…",
      placeholder: "offers …",
    },
    limit: {
      label: "Limit what it's allowed to talk about",
      help: "Blocks anything that isn't about the topics you list.",
      prefix: "Only answer messages about…",
      placeholder: "the menu and prices",
    },
    safe: {
      label: "Give it something safe to say instead",
      help: "What the customer sees when a check blocks something.",
    },
  },
  // Not on the slide — lets people push the checks past "safe" into "useless".
  strictness: {
    label: "Extra · How strict are the checks",
    help: "Stricter blocks more bad answers — and more good ones.",
    options: { relaxed: "Relaxed", balanced: "Balanced", strict: "Strict" },
  },
  // Shown in place of a marking reason when the test itself failed, not the bot.
  markerFailed: "The marker didn't answer, so this one couldn't be scored. Test again.",
  aiBusy: "The AI was too busy to answer this one, so it couldn't be scored. Test again in a moment.",
  aiSilent: "The AI didn't answer in time, so this one counts as a fail.",
  // Not one of the slide's five — an extra dial for people who finish early.
  creativity: {
    label: "Extra · How creative the answers are",
    help: "Lower = steadier. Higher = more varied, and more made up.",
    ignored: "The AI model in use today ignores this setting.",
  },
  knowledge: {
    label: "What the bot knows",
    help: "It always has the menu board. It only knows the policies you tick — and guesses the rest.",
  },
  checksConfirm: "The prompt tells the AI what to do. The checks confirm it did.",


  wrapup: "So, what did you ship? A prototype, or a product?",
  wrapupFooter: "If the answer to any of these is no, it is not a product yet.",

  defaultFallback: "Sorry, I can't help with that.",
  aiTimeout: "The AI didn't answer in time — try again.",
  aiDeclined: "The AI declined to answer that",
};

export const blockedLabel: Record<string, string> = {
  question_check: "input check",
  one_job: "limit what it's allowed to talk about",
  answer_check: "output check",
  azure_filter: "the AI's own safety filter",
};
