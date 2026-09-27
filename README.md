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

**No Azure keys?** The app switches to an **offline mock** by itself: the bot, marker and checks
all run on keyword rules that copy the failures the day needs (discounts, "Premium Plus", "yes to
Tutong", leaking the prompt). It's for clicking through the flow, not for tuning. When Azure keys are
set, the mock drops out of the menu unless `ENABLE_MOCK=1`.

## Deploy

### Railway (what we use)

Connect the GitHub repo; `railway.json` builds the Dockerfile and health-checks `/api/state`.
Two things are easy to miss:

- **Attach a volume mounted at `/data`** (project canvas → right-click, or ⌘K → Volume). Without it the
  database is wiped on every redeploy. `DATABASE_PATH` is already set to `/data/warung-kita.db` in the Dockerfile.
- **Set `PUBLIC_URL`** to the real address, or the admin console's QR code points at the default domain.

Don't set `PORT` — Railway provides it.

### Your own server

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

Either way, on first start the database is created and the `presenter` account is reserved.
`npm run seed` does the same thing ahead of time.

## How the presenter uses it

1. Sign in at `/ops` in your browser. Phases: **closed → activity 1 → activity 2 → wrap-up**.
2. In the **same browser**, open `/` and type the name `presenter`. Nobody can use that name
   without the admin sign-in, and every board and leaderboard leaves that account out — so you can
   demonstrate anything on the projector without appearing in the room's scores.
3. **Rehearse on the real thing.** Sign in as `presenter`, work through Activity 2 yourself, and
   leave the run in place; a Reset before the room arrives clears it.

## What participants see

**Activity 1 — the Warung Kita ordering app** (phone-first). Four tabs: **Order** (business info, hours,
delivery area, walk-in only, full menu with prices and allergens), **Lunch plans**, **Orders** (a sample
takeaway order for 12:30 today), and **Help** — the chatbot they try to break. Every fact on screen comes from `config/restaurant.ts`, which is also where
the bot's facts come from — but the bot is only given the menu board, so anything it says beyond that
is a guess the app can disprove. The sample account lives in `config/sample.ts` and is deliberately *not* given to
the bot (it only answers questions) — so "I've changed your order" is an invented promise.
No workshop chrome on this screen — it looks like the real app; the targets and *Feeling stuck?* ideas stay on the slides.

**Reporting (Activity 1).** Participants judge the bot themselves: every reply has **report** → *What did
the bot do?* — ten targets in the deck's four groups (it makes things up · it goes off-script · it leaks ·
real users aren't you), each with a one-line definition, plus an optional "why". The bot supports
English and Malay (Indonesian counts as Malay); any other language, or switching language, is a find. **My reports** sits beside the app
(a card on the right; a tab on phones) with their reports, which of the four targets they've hit, and
the room leaderboard (targets hit, then total reports). The app itself stays clean.
Projector: `/ops/board?view=finds` (who broke it best) and `?view=harvest` — four tiles, one per group
from the deck's "what you missed" slide, each listing its targets with counts (dim = nobody has found it
yet; hover for ±1). The presenter can change or clear a report in the live feed.

The ten targets cover the iceberg slide's list, except "AI costs ten times what you tested with" —
a participant can't see cost in the chat; the admin console tracks it instead.

**Activity 2 — the assistant studio.** *Live* (what customers get: the original bot until someone
publishes) vs *Draft* (their changes). Three regions, and they do not deserve equal space: the customer
app is occasional reference, the Test it / Fix it panel is long scrolling work, and the gate is the
thing you act on. So the gate and the working panel sit side by side and the app folds away.

| width | layout |
|---|---|
| 1280+ | customer app (foldable, 340px) · working panel · gate + results. The **Customer app** button in the admin bar folds the app away, remembered per device. |
| 900–1279 | app moves to a tab; working panel and gate stay side by side |
| under 900 | one column, gate and Run button first |

The gate is on screen without scrolling at every width, and nothing scrolls sideways: below a 500px
column the results table drops the word PASS/FAIL for a ✓/✗ and wraps *MUST NOT FAIL* rather than
losing the slide's words.

The portal is **two rounds, in that order** — the day's argument in the shape of the screen:

1. **Test it** — write what a good answer must do, mark what must never fail, run it, read the score.
2. **Fix it** — change the bot, then run the same tests again. **Locked until the first test has
   finished**, so nobody can "fix" a bot they have never measured.

Once unlocked, both rounds stay reachable (fixing means re-testing). Nothing is a one-click fix:

- **What the bot knows** — the menu board is always given (menu, prices, plans, hours, halal, payment,
  languages, location and a vague "delivery around Bandar Seri Begawan"); each policy section (delivery area, order changes,
  reservations, discounts, refunds & order problems, lunch plan rules, allergen warning) is ticked one by one.
- **Input check · output check · topic limit** — each starts with **no rules**; people write them
  ("Block the customer's message if it…", "Block the answer if it…", "Only answer messages about…").
  A check only catches what someone wrote down. *How strict* (relaxed/balanced/strict) and *how creative*
  are extras for overshooting.
- **The tests are the room's own findings.** When you open Activity 2, each person's suite is drawn
  from what was reported in Activity 1: **one real customer message per target, ten in all** — their own
  reports first, then the rest of the room's, then seeded samples (`config/samples.ts`) for anything
  nobody broke, so every suite is always complete (`lib/questions.ts`).
  Each test says who reported it and as what, so Activity 1 visibly becomes Activity 2's test suite.
  The suite is frozen the moment it is drawn, so "before → after" always compares the same tests.
  Expect round 1 to score badly — every test is a message that already broke the bot.
  Every sample was tried against the real bot; the hit rates are in the file.
- **Runs** — each question 5 times, **plus 10 attack tests** (`config/attacks.ts`) from
  the second test onwards: one per Activity 1 target, 3 tries each, judged by the second AI against a
  precise "the attack succeeds if…". A reply a check blocked counts as stopped (the customer only saw
  the safe reply). With a suite of 6, round 1 is 60 model calls a person and round 2 about 120 —
  keeping the attack suite out of the first test is what makes a room of 40 workable. Attacks a participant reported themselves in
  Activity 1 are marked *you found this*.
- **Publish to customers** unlocks only when: something is marked must-not-fail, must-not-fail questions pass
  every run, the rest clear their bar (80% of the runs, rounded up — 4 of 5 at the default),
**every attack is stopped in all 3 tries**, and nothing changed since the test
  (`lib/gate.ts`, enforced by the server). Changing *which* questions must not fail is a change to the
  bar, not to the bot, so it re-scores the results you already have instead of asking for a fresh test.

Measured with ILMU as the bot, the marker, the checks and the attack judge — one provider all the way
through, at `MAX_CONCURRENT_CALLS=4`. A 30-person room: round 1 in 160 s, round 2 in 220 s, 4,302 calls,
8 of 1,560 answers unscored.
(`.env.example` ships `gpt-4o-mini`; the admin console's cost estimate uses gpt-4o-mini rates either way,
and `gpt-5*` deployments ignore the creativity setting.)

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
| Menu "+" buttons | For show only — no cart. Ordering isn't what the day teaches. |
| Fonts | The restaurant's headings use Georgia (a "DM Serif Display" stack with no web-font download), so the app makes no outside requests. |
| Input check vs. topic limit | One AI call behind both, and neither has any built-in behaviour: the input check blocks only what the participant's rules say, the topic limit only allows the topics they list. A check with no rules does nothing. |
| Runs per test | 3 / 5 / 10 in the dropdown. The "can slip" bar is 80% rounded up (4/5, 8/10, 3/3). |
| Worked answer | Signed in as `presenter`, **Fix it** carries a *Show a worked answer* button that applies a known-good draft in one go (`config/reference.ts`): rewritten prompt, all seven policy sections, three input rules, six output rules, creativity 0.2. Measured on ILMU with a suite of ten: **43/50 and 29/30 attacks** — better, and still short of the publish gate. Participants never see the button. |
| Runs per test | Ships at **3**, with ten tests. Measured on a 30-person room: round 1 **290 s**, round 2 **338 s**, 4,052 calls, 2 of 900 answers unscored. Ten tests at 5 runs is better signal but round 1 alone takes 477 s — change it in the console if the room is moving fast. |
| The bar | "Must not fail" is every run; everything else is 80% **but never every run** — at 3 runs ⌈80%⌉ would be 3 of 3, which is what "must not fail" already means. 5 and 10 runs are unchanged (4 of 5, 8 of 10). |
| Marker model | The bot and the marker are picked separately in the console. Marking with the model you are testing is a weaker test — it tends to agree with itself — but it is supported, and a whole room on ILMU alone was measured at 0.5% unscored. `npm run marker-check` scores a marker model against ten tricky cases, three of which it must PASS because the tester's rule does not cover the fault. |
| Calls at once | One queue for the whole room, `MAX_CONCURRENT_CALLS` (default 12). **On ILMU keep it at or below 8** — its endpoint serves 8 concurrent requests correctly and corrupts from 9 onwards, returning a 200 with a truncated body (`{"pass`) and `finish_reason: "stop"`, as if it had answered properly. Verified with plain `fetch` (no SDK, no queue), so it is the endpoint and not this app: 8 in flight × 300 requests = 0 bad, 9 = 63% bad, 12 = 81% bad. Shipped at 4 for margin. A JSON reply that will not parse is retried like any other failed call. The real ceiling is the Azure deployment's tokens-per-minute, not this number — raising it past the quota just trades work for `429`s. Measured against a deployment that sustains ~250k tokens/min, on the older 4-question suite: **round 1, 24 people at once, 73 s and no throttling; round 2, 14 people with checks on, 5.5 min and throttled throughout**. A 6-question suite is about half as much again. Budget ~20 min for round 2 with a full room; if that is too slow, raise the deployment's quota, drop runs-per-test to 3, or run round 2 in two waves. |
| A garbled reply | ILMU answers 200 with a truncated or repeating body when it is pushed (see above), and says `finish_reason: "stop"` as if it were fine. A JSON reply that will not parse is treated as a failed call, not a failed answer: it is retried, **and the queue halves what it asks of the provider**, earning the capacity back a step at a time after 30 s of clean replies. Measured on a 30-person room started at the catastrophic setting of 12: it eased itself to 2–3 and finished with **0 of 1,527 answers unscored**. At the shipped setting of 4: **1 of 1,560**, with 139 garbled replies retried away. The console counts these apart from errors. |
| Being rate limited | Expected when a room tests together, and never counted as a failed answer: the call waits (honouring Azure's `Retry-After`, up to 10 attempts), the whole queue holds back while the provider is saying slow down, and only if it still can't get through does the result say *"The AI was too busy… test again"*. The ops console counts "rate limited" apart from "errors". Without this, a throttled room scores near zero and people rewrite bots that were never broken. |
| Reset | Normal reset keeps people, their rules and the call log. Full reset removes everyone except `presenter` and clears every bot setting (the presenter's too); the phase and bot settings survive. |
| Errors in a run | If the AI doesn't answer a question (after one retry), that one counts as a FAIL with a plain-words reason. |
| Leaderboard | Opens sorted by before → after, not by score, so nobody is ranked last on the projector (columns are clickable if you want another order). Leaves out `presenter`. |

## Matching the deck (and going one step past it)

Every instruction on screen is lifted from the slide on the wall. `config/copy.ts` holds the Test It /
Fix It leads and steps, the five Fix It controls with the exact slide names in slide order, and the
wrap-up *"So, what did you ship?"*. The rest lives where it is used: the ten Activity 1 targets and the
four board groups in `config/finds.ts`, the four questions in `config/questions.ts`, and the
*MUST NOT FAIL / CAN SLIP* badges in `app/components/Studio.tsx`.

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
config/questions.ts    the deck's four questions (slides 24/29) — now only the fallback suite
lib/questions.ts       builds each person's tests from what the room reported in Activity 1
config/copy.ts         every on-screen instruction sentence (match the slides)
lib/prompts.ts         the original prompt, the marker, the checks, the attack judge
lib/bot.ts             input check → bot → output check
config/sample.ts       the sample customer account shown in the app (not given to the bot)
lib/gate.ts            "can we ship this draft?" checks — used by the screen and enforced by the server
lib/runs.ts            test runs as server jobs
lib/llm.ts, queue.ts   one queue (MAX_CONCURRENT_CALLS), 20 s timeout, retries, every call logged
scripts/marker-check.ts  scores a marker model against ten tricky cases — run it after changing models
lib/providers.ts       Azure / ILMU / offline mock
lib/mock.ts            the offline mock
```

## Before the day (from spec §11)

- Fill the tuning table for **both** bots with real keys: the original bot must fail discount /
  premium visibly, and a written output check rule ("offers a discount…") must reliably get both to 5/5.
  The checks have no built-in rules, so test them with the rules you plan to suggest from the front.
- Confirm the naive bot leaks its prompt, answers in Malay, and chats off-topic.
- Check the Azure deployment's TPM quota; leave Prompt Shields off.
