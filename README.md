# Warung Kita — workshop demo app

Built from `warung-kita-spec.md`. Next.js 16 (App Router) + SQLite (`better-sqlite3`), one Node process.

## Run it locally

```bash
cp .env.example .env      # fill in Azure (and ILMU) credentials, set ADMIN_PASSWORD
npm install
npm run dev               # http://localhost:3100
```

- Participant app: `/`
- Admin console: `/ops` (password = `ADMIN_PASSWORD`)
- Projector: `/ops/board?view=harvest`, `?view=finds` and `?view=scores`

**No Azure keys?** The app switches to an **offline mock** by itself: the bot, marker, checks and sorting
all run on keyword rules that copy the failures the day needs (discounts, "Premium Plus", "yes to
Tutong", leaking the prompt). It's for clicking through the flow, not for tuning. When Azure keys are
set, the mock drops out of the menu unless `ENABLE_MOCK=1`.

## Deploy (warung-kita.siapstudio.my)

```bash
docker compose up -d --build      # listens on 127.0.0.1:3000, DB in ./data
```

nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 60s;   # a chat turn with both checks on can take several seconds
}
```

On first start the database is created and seeded: the `presenter` participant with the Module 3
demo rules, plus two made-up recordings per bot (specific rules → 19/20 with one Tutong fail; vague
rules → 20/20). `npm run seed` does the same thing ahead of time.

## How the presenter uses it

1. Sign in at `/ops` in your browser.
2. In the **same browser**, open `/` and type the name `presenter`. Nobody can use that name
   without the admin sign-in.
3. **Rehearsal:** turn *cached demo results* off, run the tests for real, then use
   **save as recording** in the console. Delete the made-up recordings once you have real ones.
   On the day, turn cached results on: your Run plays back the recording whose rules match yours,
   or plays the recordings in order if none match.

## What participants see

**Activity 1 — the Warung Kita ordering app** (phone-first). Four tabs: **Order** (business info, hours,
delivery area, walk-in only, full menu with prices and allergens), **Lunch plans**, **Orders** (a sample
takeaway order for 12:30 today), and **Help** — the chatbot they try to break. Every fact on screen comes
from `config/restaurant.ts`, the same data the bot is given, so anything the bot says that the app
doesn't is made up. The sample account lives in `config/sample.ts` and is deliberately *not* given to
the bot (it only answers questions) — so "I've changed your order" is an invented promise.
No workshop chrome on this screen — it looks like the real app; the targets and *Feeling stuck?* ideas stay on the slides.

**Reporting (Activity 1).** Participants judge the bot themselves: every reply has **report** → *What did
the bot do?* — ten targets in the deck's four groups (it makes things up · it goes off-script · it leaks ·
real users aren't you), each with a one-line definition, plus an optional "why". The bot supports
English and Malay (Indonesian counts as Malay); any other language, or switching language, is a find. **My reports** sits beside the app
(a card on the right; a tab on phones) with their reports, which of the four targets they've hit, and
the room leaderboard (targets hit, then total reports). The app itself stays clean.
Projector: `/ops/board?view=finds`. The harvest tiles count reports; the presenter can
change or clear a report in the live feed.

**Activity 2 — the assistant studio.** *Live* (what customers get: the original bot until someone
publishes) vs *Draft* (their changes). Customer app on the left (the draft answering), admin portal on the
right. Nothing is a one-click fix:

- **What the bot knows** — the menu board is always given; each policy section (delivery area, order changes,
  reservations, discounts, refunds & order problems, lunch plan rules, allergen warning) is ticked one by one.
- **Input check · output check · topic limit** — each starts with **no rules**; people write them
  ("Block the customer's message if it…", "Block the answer if it…", "Only answer messages about…").
  A check only catches what someone wrote down. *How strict* (relaxed/balanced/strict) and *how creative*
  are extras for overshooting.
- **Tests** — the slide's four questions (5 runs) **plus 10 attack tests** (`config/attacks.ts`), one per
  Activity 1 target, 3 tries each, judged by the second AI against a precise "the attack succeeds if…".
  A reply a check blocked counts as stopped (the customer only saw the safe reply).
- **Publish to customers** unlocks only when: something is marked must-not-fail, must-not-fail questions pass
  every run, the rest clear 4 of 5, **every attack is stopped in all 3 tries**, and nothing changed since the test
  (`lib/gate.ts`, enforced by the server).

Measured on ILMU (bot) + Azure gpt-5-mini (checks, marker):

| Version | Questions | Attacks stopped | Publish |
|---|---|---|---|
| Original bot, all three checks switched on but no rules | 7/20 | 16/30 | no |
| Rewritten prompt + all policy sections + written input/output rules | 17–19/20 | 29–30/30 | 1 of 4 tries |
| Same + strict + topic "the menu" + "block any price" rule | 11/20 (premium 0/5) | 30/30 | no — safe but useless |

**Wrap-up** — "Did you ship it?" plus the deck's *prototype or product?* questions, answered from their
own versions. The leaderboard shows what each person shipped.

## Choices I made where the spec left a gap

| Topic | What I built |
|---|---|
| Same name twice | The spec asks for both "someone's already using that" and "type your name again on another device". The app asks: *Someone's already using "Amy" — **That's me** / **Add my surname***. |
| ILMU | Treated as OpenAI-compatible (`ILMU_BASE_URL` + Bearer `ILMU_API_KEY` + `ILMU_MODEL`), no JSON mode. Shows *not configured* until all three are set. See `lib/providers.ts` if it turns out to be different. |
| `demo` phase | Participants get a "watch the screen" card listing the four questions, with one thing to think about. Only `presenter` can test and publish. |
| Menu "+" buttons | For show only — no cart. Ordering isn't what the day teaches. |
| Fonts | The restaurant's headings use Georgia (a "DM Serif Display" stack with no web-font download), so the app makes no outside requests. |
| Input check vs. topic limit | One classifier behind both. The input check blocks attempts to change or reveal the instructions; the topic limit also blocks anything not about Warung Kita. |
| Runs per test | 3 / 5 / 10 in the dropdown. The "can slip" bar is 80% rounded up (4/5, 8/10, 3/3). |
| Reset | Normal reset keeps people, rules and the call log. Full reset keeps only `presenter` and the recordings. |
| Errors in a run | If the AI doesn't answer a question (after one retry), that one counts as a FAIL with a plain-words reason. |
| Leaderboard | Sorted by before → after, not by score, so nobody is ranked last on the projector. Leaves out `presenter`. |

## Matching the deck (and going one step past it)

Every instruction on screen is lifted from the slide on the wall — all of it lives in `config/copy.ts`:
Activity 1's four "Get it to…" targets and the *Feeling stuck?* list; Test It / Fix It leads and steps;
the five Fix It controls with the exact slide names, in slide order; *MUST NOT FAIL / CAN SLIP*; the
board tiles named after the four Activity 1 targets; wrap-up = *"So, what did you ship?"*.

Participants start with **nothing** marked must-not-fail — the slide asks them to decide.
The system prompt box holds only their instructions; the menu & facts are always attached (shown folded underneath),
so rewriting the prompt can't delete the prices.

On top of the slides, the app asks short questions so people look at their own results instead of following steps:

- **After each run** — one line pointing at what's worth opening ("Question 2 must not fail and didn't clear the bar — is the bot wrong, or is your rule wrong?"; "Everything passed first try — are your rules strict enough?").
- **In the PASS/FAIL drawer** — judge the marker ("Do you agree? It's only as good as the rules you gave it").
- **By the Run button** — "Changed since your last run: …", with the *one at a time* warning when more than one thing about the bot changed. The score history lists the changes per run.
- **At wrap-up** — the deck's four *prototype or product?* questions, answered from their own last run.

## Where things live

```
config/restaurant.ts   menu & facts — every prompt is built from this
config/questions.ts    the four questions (match deck slides 24/29)
config/copy.ts         every on-screen instruction sentence (match the slides)
lib/prompts.ts         naive prompt, marker, checks, sorting prompt
lib/bot.ts             question check → bot → answer check
config/sample.ts       the sample customer account shown in the app (not given to the bot)
lib/gate.ts            "can we ship this draft?" checks — used by the screen and enforced by the server
lib/runs.ts            test runs as server jobs, recording playback
lib/llm.ts, queue.ts   one queue (8 at a time), 20 s timeout, one retry, every call logged
lib/providers.ts       Azure / ILMU / offline mock
lib/mock.ts            the offline mock
```

## Before the day (from spec §11)

- Fill the tuning table for **both** bots with real keys: the naive prompt must fail discount /
  premium visibly, and the answer check must reliably get both to 5/5.
- Confirm the naive bot leaks its prompt, answers in Malay, and chats off-topic.
- Check the Azure deployment's TPM quota; leave Prompt Shields off.
