"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { blockedLabel, copy } from "@/config/copy";
import { FIND_TYPES } from "@/config/finds";
import type { Question, Tier } from "@/config/questions";
import { api, time } from "@/lib/client";
import { botChanges, describeChanges, type Snapshot } from "@/lib/diff";
import { barFor, shipGate } from "@/lib/gate";
import { AppScreen } from "./CustomerApp";

type Config = Snapshot["config"];
type HistoryRow = { id: number; status: string; started_at: number; total: number | null; max: number; bot_model: string; summary: string; changes: string[] | null; blocked: number; attacks_held: number; attacks_max: number };
type AttackDef = { key: string; target: string; message: string; failsIf: string };
type Workspace = {
  phase: string;
  runsPerTest: number;
  questions: Question[];
  limits: { maxRules: number; maxChars: number };
  config: Config;
  rules: Record<string, string[]>;
  tiers: Record<string, Tier>;
  naivePrompt: string;
  facts: string;
  knowledgeSections: { key: string; label: string; text: string }[];
  attacks: AttackDef[];
  history: HistoryRow[];
  lastRun: Snapshot | null;
  activeRunId: number | null;
  latestRunId: number | null;
  publishedRunId: number | null;
  botIgnoresTemperature: boolean;
};
type Result = { id: number; question_key: string; iteration: number; answer: string; original_answer: string | null; blocked_by: string | null; pass: boolean; failed_rules: number[]; reason: string };
type Run = {
  id: number; status: string; runs_per_test: number; bot_model: string; total: number; max: number; done: number; config: Config;
  summary: string; rules: Record<string, string[]>; tiers: Record<string, Tier>; results: Result[]; queuePosition: number; started_at: number;
  attacks_held: number; attacks_max: number; total_tasks: number;
};
const targetLabel = (t: string) => FIND_TYPES.find((f) => f.key === t)?.short ?? t;
type Header = (instruction: string) => React.ReactNode;

const MODEL_LABEL: Record<string, string> = { azure: "Azure", ilmu: "ILMU", mock: "mock" };
const tierLabel = (t: Tier) => (t === "must" ? "MUST NOT FAIL" : "CAN SLIP");
const versionOf = (ws: Workspace, runId: number | null) => {
  const i = ws.history.findIndex((h) => h.id === runId);
  return i < 0 ? null : i + 1;
};

/** Activity 2 (and the demo, and wrap-up): the owner's assistant studio. */
export function Studio({ phase, presenter, header }: { phase: "demo" | "activity2" | "wrapup"; presenter: boolean; header: Header }) {
  const [ws, setWs] = useState<Workspace | null>(null);
  const [latest, setLatest] = useState<Run | null>(null);
  const [shown, setShown] = useState<Run | null>(null);
  const [loadError, setLoadError] = useState("");

  const loadLatest = useCallback(async (id: number) => {
    try {
      setLatest(await api<Run>(`/api/runs/${id}`));
      setShown(null);
    } catch {}
  }, []);

  const loadWorkspace = useCallback(async (full: boolean) => {
    try {
      const w = await api<Workspace>("/api/workspace");
      setWs((prev) =>
        full || !prev
          ? w
          : { ...prev, history: w.history, lastRun: w.lastRun, activeRunId: w.activeRunId, latestRunId: w.latestRunId, runsPerTest: w.runsPerTest, publishedRunId: w.publishedRunId }
      );
      return w;
    } catch (e) {
      setLoadError((e as Error).message);
      return null;
    }
  }, []);

  useEffect(() => {
    loadWorkspace(true).then((w) => {
      const id = w?.activeRunId ?? w?.latestRunId;
      if (id) loadLatest(id);
    });
  }, [loadWorkspace, loadLatest]);

  const running = latest?.status === "running";
  useEffect(() => {
    if (!running || !latest) return;
    const t = setInterval(async () => {
      const r = await api<Run>(`/api/runs/${latest.id}`).catch(() => null);
      if (!r) return;
      setLatest(r);
      if (r.status !== "running") loadWorkspace(false);
    }, 1500);
    return () => clearInterval(t);
  }, [running, latest?.id, loadWorkspace]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ws) return <>{header(copy.testIt.lead)}<div className="center-card muted">{loadError || "Loading…"}</div></>;
  if (phase === "demo" && !presenter) return <WatchView ws={ws} header={header} />;

  const pickRun = async (id: number) => {
    if (id === latest?.id) return setShown(null);
    setShown(await api<Run>(`/api/runs/${id}`).catch(() => null));
  };

  if (phase === "wrapup") {
    return (
      <>
        {header(copy.wrapup)}
        <div className="wrapup">
          <Reflection ws={ws} run={latest} />
          <section className="panel"><ResultsPanel ws={ws} run={shown ?? latest} latestId={latest?.id ?? null} onPickRun={pickRun} readOnly /></section>
        </div>
      </>
    );
  }

  return (
    <StudioBench
      ws={ws} setWs={setWs} header={header} latest={latest} shown={shown} running={running} onPickRun={pickRun}
      onStarted={(id) => { loadLatest(id); loadWorkspace(false); }}
    />
  );
}

function StudioBench({
  ws, setWs, header, latest, shown, running, onPickRun, onStarted,
}: {
  ws: Workspace; setWs: React.Dispatch<React.SetStateAction<Workspace | null>>; header: Header;
  latest: Run | null; shown: Run | null; running: boolean; onPickRun: (id: number) => void; onStarted: (id: number) => void;
}) {
  const [pane, setPane] = useState<"app" | "fix" | "test">("test");
  const [middle, setMiddle] = useState<"tests" | "results" | "compare">(ws.history.length ? "results" : "tests");
  const [drafts, setDrafts] = useState<Record<string, string[]>>(() => ws.rules);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const keys = ws.questions.map((q) => q.key);

  const saveRules = async (key: string, list?: string[]) => {
    const rules = (list ?? draftsRef.current[key] ?? []).map((r) => r.trim()).filter(Boolean);
    try {
      const r = await api<{ rules: Workspace["rules"]; tiers: Workspace["tiers"] }>("/api/rules", { method: "PUT", body: { questionKey: key, rules } });
      setWs((w) => (w ? { ...w, rules: r.rules, tiers: r.tiers } : w));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const draft: Snapshot = { config: ws.config, rules: ws.rules, tiers: ws.tiers };
  const gate = shipGate(latest, latest && { config: latest.config, rules: latest.rules, tiers: latest.tiers }, draft, keys);
  const latestV = versionOf(ws, latest?.id ?? null);
  const liveV = versionOf(ws, ws.publishedRunId);
  const isLive = !!latest && latest.id === ws.publishedRunId;
  const untested = !latest || describeChanges({ config: latest.config, rules: latest.rules, tiers: latest.tiers }, draft, keys).length > 0;

  const missing = ws.questions.map((q, i) => ((drafts[q.key] ?? []).some((r) => r.trim()) ? null : i + 1)).filter(Boolean) as number[];
  const runBlocked = running
    ? "Testing…"
    : missing.length
      ? `Add at least one rule to question ${missing.length > 1 ? `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}` : missing[0]} first.`
      : "";

  const runTests = async () => {
    setBusy(true);
    setError("");
    try {
      await Promise.all(keys.map((k) => saveRules(k)));
      const r = await api<{ runId: number }>("/api/runs", { body: {} });
      onStarted(r.runId);
      setMiddle("results");
      setPane("test");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (!latest || !confirm(`Publish v${latestV} to customers?`)) return;
    try {
      const r = await api<{ publishedRunId: number }>("/api/publish", { body: { runId: latest.id } });
      setWs((w) => (w ? { ...w, publishedRunId: r.publishedRunId } : w));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      {header(ws.history.length ? copy.fixIt.lead : copy.testIt.lead)}
      <nav className="studio-tabs" aria-label="Studio">
        <button className={pane === "app" ? "on" : ""} onClick={() => setPane("app")}>Customer app</button>
        <button className={pane === "fix" ? "on" : ""} onClick={() => setPane("fix")}>Fix it</button>
        <button className={pane === "test" ? "on" : ""} onClick={() => setPane("test")}>Test it</button>
      </nav>

      <div className="studio">
        {/* Left: what the customer sees — the real app, answering with this draft. */}
        <section className={`preview ${pane !== "app" ? "hide-narrow" : ""}`}>
          <div className="preview-label">
            <strong>Customer app · your draft</strong>
            <span>Only you see the draft. Customers still get {liveV ? `v${liveV}` : "the original bot"}.</span>
          </div>
          <div className="device">
            <div className="app"><AppScreen initialTab="help" showMechanism /></div>
          </div>
        </section>

        {/* Right: the owner's admin portal. */}
        <section className={`portal ${pane === "app" ? "hide-narrow" : ""}`}>
          <div className="studio-bar">
            <div className="studio-name">Warung Kita · Admin</div>
            <div className="env-pills">
              <span className="env live"><i />Live · {liveV ? `v${liveV}` : "original bot"}</span>
              <span className="env draft"><i />Draft · {running ? "testing…" : untested ? "changes not tested" : `tested as v${latestV}`}</span>
            </div>
            <div className="publish">
              {isLive ? (
                <span className="published">v{latestV} is live</span>
              ) : (
                <button className="btn" disabled={!gate.ready || running} onClick={publish}>Publish to customers</button>
              )}
              <span className={`publish-reason ${gate.ready || isLive ? "ok" : running ? "neutral" : ""}`}>{isLive ? "Customers now get this version." : gate.summary}</span>
            </div>
          </div>

          <div className="portal-grid">
            <section className={`panel ${pane !== "fix" ? "hide-narrow" : ""}`}>
              <FixItPanel ws={ws} setWs={setWs} />
            </section>

            <section className={`studio-middle ${pane !== "test" ? "hide-narrow" : ""}`}>
              <GateCard ws={ws} gate={gate} latest={latest} latestV={latestV} running={running} runBlocked={runBlocked} busy={busy} onRun={runTests} error={error} />
              <div className="panel">
                <div className="seg">
                  <button className={middle === "tests" ? "on" : ""} onClick={() => setMiddle("tests")}>1 · Write the tests</button>
                  <button className={middle === "results" ? "on" : ""} onClick={() => setMiddle("results")}>2 · Results</button>
                  <button className={middle === "compare" ? "on" : ""} onClick={() => setMiddle("compare")}>3 · Compare</button>
                </div>
                {middle === "tests" && <TestsEditor ws={ws} setWs={setWs} drafts={drafts} setDrafts={setDrafts} saveRules={saveRules} onError={setError} />}
                {middle === "results" && <ResultsPanel ws={ws} run={shown ?? latest} latestId={latest?.id ?? null} onPickRun={onPickRun} />}
                {middle === "compare" && <CompareView ws={ws} />}
              </div>
            </section>
          </div>
        </section>
      </div>
    </>
  );
}

/* ——— Demo: participants watch, and think ——— */

function WatchView({ ws, header }: { ws: Workspace; header: Header }) {
  return (
    <>
      {header(copy.demoWatch)}
      <div className="center-card" style={{ maxWidth: 560 }}>
        <div className="card">
          <p className="think" style={{ marginTop: 0 }}>{copy.demoThink}</p>
          <ol className="plain-list">
            {ws.questions.map((q) => <li key={q.key}>&ldquo;{q.text}&rdquo;</li>)}
          </ol>
          <p className="small muted" style={{ marginBottom: 0 }}>Keep this page open — it will change by itself when it&apos;s your turn.</p>
        </div>
      </div>
    </>
  );
}

/* ——— Can we ship it? ——— */

function GateCard({
  ws, gate, latest, latestV, running, runBlocked, busy, onRun, error,
}: {
  ws: Workspace; gate: ReturnType<typeof shipGate>; latest: Run | null; latestV: number | null; running: boolean;
  runBlocked: string; busy: boolean; onRun: () => void; error: string;
}) {
  const nextV = ws.history.length + 1;
  return (
    <div className="panel gate">
      <div className="gate-head">
        <h2>Can we ship this draft?</h2>
        {latest && latest.status !== "running" && <span className="gate-score">v{latestV} · {latest.total} / {latest.max}</span>}
      </div>
      {gate.checks.length ? (
        <ul className="gate-checks">
          {gate.checks.map((c) => (
            <li key={c.label}>
              <span className={`mark ${c.ok ? "yes" : "no"}`} aria-label={c.ok ? "yes" : "no"}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {c.ok ? <path d="M5 12l5 5 9-10" /> : <path d="M6 6l12 12M18 6L6 18" />}
                </svg>
              </span>
              <span>{c.label}{c.detail && <span className="gate-detail">{c.detail}</span>}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small muted" style={{ margin: "4px 0 10px" }}>{gate.summary}</p>
      )}
      <ChangesLine ws={ws} latest={latest} />
      <button className="btn run-btn" disabled={!!runBlocked || busy} onClick={onRun}>{running ? "Testing…" : `Test this draft as v${nextV}`}</button>
      {runBlocked && !running && <p className="small muted" style={{ margin: "6px 0 0", textAlign: "center" }}>{runBlocked}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/** "Do it one at a time — or else you won't know which one did it." Right above the test button. */
function ChangesLine({ ws, latest }: { ws: Workspace; latest: Run | null }) {
  if (!latest || latest.status === "running") return null;
  const changes = describeChanges({ config: latest.config, rules: latest.rules, tiers: latest.tiers }, { config: ws.config, rules: ws.rules, tiers: ws.tiers }, ws.questions.map((q) => q.key));
  if (!changes.length) return <p className="changes">Nothing has changed since the last test. Test it again anyway — does the score stay the same?</p>;
  const bot = botChanges(changes);
  return (
    <div className={`changes ${bot.length > 1 ? "warn" : ""}`}>
      <div><strong>Changed since the last test:</strong> {changes.join(" · ")}</div>
      {bot.length > 1 && <div style={{ marginTop: 4 }}>{copy.fixIt.oneAtATime} If the score moves, which of these was it?</div>}
    </div>
  );
}

/* ——— Test it ——— */

function TestsEditor({
  ws, setWs, drafts, setDrafts, saveRules, onError,
}: {
  ws: Workspace; setWs: React.Dispatch<React.SetStateAction<Workspace | null>>;
  drafts: Record<string, string[]>; setDrafts: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
  saveRules: (key: string, list?: string[]) => Promise<void>; onError: (m: string) => void;
}) {
  const focusNext = useRef<string | null>(null);
  const setTier = async (key: string, tier: Tier) => {
    setWs((w) => (w ? { ...w, tiers: { ...w.tiers, [key]: tier } } : w));
    await api("/api/rules", { method: "PUT", body: { questionKey: key, tier } }).catch((e) => onError((e as Error).message));
  };
  const noMust = !Object.values(ws.tiers).includes("must");

  return (
    <>
      <p className="lead">{copy.testIt.lead}</p>
      <p className="steps-label">For each question…</p>
      <ol className="steps">{copy.testIt.steps.map((s) => <li key={s}>{s}</li>)}</ol>
      {ws.questions.map((q, i) => {
        const list = drafts[q.key] ?? [];
        return (
          <div key={q.key} className="question">
            <div className="q-text"><span className="q-num">{i + 1}</span><span>&ldquo;{q.text}&rdquo;</span></div>
            <label className="check">
              <input type="checkbox" checked={ws.tiers[q.key] === "must"} onChange={(e) => setTier(q.key, e.target.checked ? "must" : "ok")} />
              must not fail
            </label>
            <div className="passif">It&apos;s a pass if…</div>
            {list.map((rule, ri) => (
              <div key={ri} className="rule">
                <span className="muted">·</span>
                <input
                  className="input"
                  value={rule}
                  maxLength={ws.limits.maxChars}
                  placeholder="it …"
                  aria-label={`Rule ${ri + 1} for question ${i + 1}`}
                  ref={(el) => { if (el && focusNext.current === `${q.key}:${ri}`) { el.focus(); focusNext.current = null; } }}
                  onChange={(e) => setDrafts((d) => ({ ...d, [q.key]: list.map((r, j) => (j === ri ? e.target.value : r)) }))}
                  onBlur={() => saveRules(q.key)}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                />
                <button className="x" aria-label="Remove rule" onClick={() => {
                  const next = list.filter((_, j) => j !== ri);
                  setDrafts((d) => ({ ...d, [q.key]: next }));
                  saveRules(q.key, next);
                }}>×</button>
              </div>
            ))}
            {list.length < ws.limits.maxRules && (
              <div className="rule">
                <span className="muted">·</span>
                <button className="linkbtn" onClick={() => {
                  focusNext.current = `${q.key}:${list.length}`;
                  setDrafts((d) => ({ ...d, [q.key]: [...list, ""] }));
                }}>+ add a rule</button>
              </div>
            )}
          </div>
        );
      })}
      <p className="hint">{copy.testIt.hint}</p>
      {noMust && <p className="think">{copy.testIt.noMust}</p>}
    </>
  );
}

/* ——— Results ——— */

function coaching(run: Run, questions: Question[], isFirst: boolean): string {
  const n = run.runs_per_test;
  const must = questions.filter((q) => run.tiers[q.key] === "must");
  const passes = (k: string) => run.results.filter((r) => r.question_key === k && r.pass).length;
  const missedMust = must.filter((q) => passes(q.key) < n).map((q) => questions.indexOf(q) + 1);
  const blocked = run.results.filter((r) => r.blocked_by && r.blocked_by !== "azure_filter").length;
  if (!must.length) return "Nothing was marked must not fail, so one total hides which failures matter. Which ones would hurt the restaurant?";
  if (blocked >= run.max * 0.4 && run.total < run.max) return `Your checks blocked ${blocked} of ${run.max} answers, and some tests failed. It's safe — but is it still useful? Open a blocked FAIL and read what the customer got.`;
  if (missedMust.length) return `Question ${missedMust.join(" and ")} must not fail — and didn't clear the bar. Open one of its FAILs: is the bot wrong, or is your rule wrong?`;
  const through = run.attacks_max - run.attacks_held;
  if (run.attacks_max && through > 0) return `${through} of ${run.attacks_max} attack tries got through. Open one: what would have stopped it — a clearer prompt, the right policy, or a check rule?`;
  if (run.total === run.max && isFirst) return "Everything passed on the first try. Before you celebrate: are your rules strict enough? Open a PASS — do you agree with it?";
  if (run.total === run.max) return "Every run passed. Would it still pass if a real customer asked a different way? Try it in the customer preview.";
  return "Your must-not-fail questions cleared the bar, and some others slipped. Are you happy with that trade?";
}

function ResultsPanel({ ws, run, latestId, onPickRun, readOnly }: { ws: Workspace; run: Run | null; latestId: number | null; onPickRun: (id: number) => void; readOnly?: boolean }) {
  const [open, setOpen] = useState<Result | null>(null);
  const Q = ws.questions.length;
  const v = run ? versionOf(ws, run.id) : null;

  return (
    <>
      {readOnly && <h2 className="panel-title">Your results</h2>}
      {!run ? (
        <p style={{ margin: "4px 0 12px", fontWeight: 600 }}>{readOnly ? "You didn't run any tests." : "Test the draft, then read what came back."}</p>
      ) : (
        <>
          {run.id !== latestId && (
            <p className="changes">Showing v{v}. <button className="linkbtn" onClick={() => latestId && onPickRun(latestId)}>Back to the latest</button></p>
          )}
          {run.status === "running" ? (
            <>
              <p style={{ margin: "6px 0 0", fontWeight: 700 }}>
                {run.done < run.max
                  ? `Questions · run ${Math.floor(run.done / Q) + 1} of ${run.runs_per_test} · question ${(run.done % Q) + 1} of ${Q}`
                  : run.done < run.total_tasks ? `Attack tests · ${run.done - run.max + 1} of ${run.total_tasks - run.max}` : "Finishing…"}
              </p>
              {run.queuePosition > 0 && (
                <p className="small" style={{ margin: "2px 0 0", color: "var(--warn)" }}>
                  Waiting for the AI — {run.queuePosition} {run.queuePosition === 1 ? "person" : "people"} ahead of you. It&apos;s not stuck.
                </p>
              )}
              <div className="progress"><div style={{ width: `${(run.done / run.total_tasks) * 100}%` }} /></div>
            </>
          ) : (
            <>
              <div className="row wrap" style={{ margin: "6px 0 6px", alignItems: "baseline" }}>
                <span className="total">v{v} · {run.total} / {run.max}</span>
                {run.attacks_max > 0 && (
                  <span className={`badge ${run.attacks_held === run.attacks_max ? "live" : "must"}`}>attacks stopped {run.attacks_held}/{run.attacks_max}</span>
                )}
                <span className="muted small">{time(run.started_at)} · {run.summary}</span>
                <span className="badge model">{MODEL_LABEL[run.bot_model] ?? run.bot_model}</span>
                {run.status === "interrupted" && <span className="badge must">cut short</span>}
              </div>
              <p className="small muted" style={{ margin: "0 0 4px" }}>
                Checks blocked <strong>{run.results.filter((r) => r.blocked_by && r.blocked_by !== "azure_filter").length}</strong> of {run.results.length} answers.
              </p>
              <p className="think">{coaching(run, ws.questions, ws.history[0]?.id === run.id)}</p>
            </>
          )}

          <div className="results-scroll">
            <table className="results">
              <thead>
                <tr><th>Q</th><th>rules</th><th /><th>runs</th><th>score · the bar</th></tr>
              </thead>
              <tbody>
                {ws.questions.map((q, qi) => {
                  const n = run.runs_per_test;
                  const tier = run.tiers[q.key] ?? "ok";
                  const rs = run.results.filter((r) => r.question_key === q.key);
                  const passes = rs.filter((r) => r.pass).length;
                  const bar = barFor(tier, n);
                  return (
                    <tr key={q.key}>
                      <td><strong>{qi + 1}</strong></td>
                      <td>{run.rules[q.key]?.length ?? 0}</td>
                      <td><span className={`badge ${tier === "must" ? "must" : ""}`}>{tierLabel(tier)}</span></td>
                      <td>
                        <div className="cells">
                          {Array.from({ length: n }, (_, i) => {
                            const r = rs.find((x) => x.iteration === i + 1);
                            return r ? (
                              <button key={i} className={`cell ${r.pass ? "pass" : "fail"}`} onClick={() => setOpen(r)} title="See the answer and why">{r.pass ? "PASS" : "FAIL"}</button>
                            ) : (
                              <span key={i} className="cell pending">…</span>
                            );
                          })}
                        </div>
                      </td>
                      <td>
                        <span style={{ fontWeight: 700 }}>{passes}/{n}</span>
                        <span className="tiny muted"> · {bar}/{n} </span>
                        {rs.length === n && (passes >= bar ? <span className="bar-ok">✓</span> : <span className="bar-no">✗</span>)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {(run.attacks_max > 0 || run.status === "running") && (
            <>
              <h3 className="results-sub">Attack tests</h3>
              <p className="tiny muted" style={{ margin: "0 0 6px" }}>One attack per thing people broke in Activity 1, each tried {ws.attacks.length ? Math.round((run.attacks_max || ws.attacks.length * 3) / ws.attacks.length) : 3} times. PASS means the bot didn&apos;t fall for it.</p>
              <div className="results-scroll">
                <table className="results">
                  <thead><tr><th>attack</th><th>tries</th><th>stopped</th></tr></thead>
                  <tbody>
                    {ws.attacks.map((a) => {
                      const rs = run.results.filter((r) => r.question_key === a.key);
                      const tries = Math.max(3, rs.length);
                      const held = rs.filter((r) => r.pass).length;
                      return (
                        <tr key={a.key}>
                          <td><strong>{targetLabel(a.target)}</strong><span className="tiny muted" style={{ display: "block" }}>&ldquo;{a.message.length > 60 ? `${a.message.slice(0, 60)}…` : a.message}&rdquo;</span></td>
                          <td>
                            <div className="cells">
                              {Array.from({ length: tries }, (_, i) => {
                                const r = rs.find((x) => x.iteration === i + 1);
                                return r ? (
                                  <button key={i} className={`cell ${r.pass ? "pass" : "fail"}`} onClick={() => setOpen(r)} title="See the reply and why">{r.pass ? "PASS" : "FAIL"}</button>
                                ) : (
                                  <span key={i} className="cell pending">…</span>
                                );
                              })}
                            </div>
                          </td>
                          <td>{rs.length ? <><strong>{held}/{rs.length}</strong> {rs.length === tries && (held === tries ? <span className="bar-ok">✓</span> : <span className="bar-no">✗</span>)}</> : <span className="muted">—</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <p className="tiny muted" style={{ margin: "8px 0 0" }}>
            Click any PASS or FAIL to see the answer and why it was marked that way.
            {run.runs_per_test !== 10 && <> Today each question runs {run.runs_per_test} times instead of 10 — same idea, less waiting.</>}
          </p>
        </>
      )}

      <div className="history">
        <h3>VERSIONS</h3>
        <p className="tiny muted" style={{ margin: 0 }}>Write your score on the card.</p>
        {ws.history.length === 0 ? (
          <p className="small muted">No versions tested yet.</p>
        ) : (
          <ul>
            {ws.history.map((h, i) => (
              <li key={h.id}>
                <span className="score">v{i + 1}</span>
                <span className="score">{h.status === "running" ? "…" : `${h.total ?? 0}/${h.max}`}</span>
                <span className="grow small">
                  {h.summary}{h.blocked > 0 && <span className="muted"> · {h.blocked} blocked</span>}
                  {h.attacks_max > 0 && h.status !== "running" && <span className="muted"> · attacks {h.attacks_held}/{h.attacks_max}</span>}
                  {h.changes && <span className="tiny muted" style={{ display: "block" }}>{h.changes.length ? `changed: ${h.changes.join(" · ")}` : "nothing changed — same setup, tested again"}</span>}
                </span>
                {h.id === ws.publishedRunId && <span className="badge live">live</span>}
                <span className="badge model">{MODEL_LABEL[h.bot_model] ?? h.bot_model}</span>
                {run?.id !== h.id && <button className="linkbtn" onClick={() => onPickRun(h.id)}>show</button>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {open && run && (
        <Drawer
          result={open} run={run} onClose={() => setOpen(null)}
          question={ws.attacks.find((a) => a.key === open.question_key)?.message ?? ws.questions.find((q) => q.key === open.question_key)?.text ?? ""}
          attack={ws.attacks.find((a) => a.key === open.question_key)}
        />
      )}
    </>
  );
}

/** Put any two tested versions side by side: what changed, and which questions moved. */
function CompareView({ ws }: { ws: Workspace }) {
  const done = ws.history.filter((h) => h.status !== "running");
  const [aId, setAId] = useState<number | null>(done.length >= 2 ? done[done.length - 2].id : done[0]?.id ?? null);
  const [bId, setBId] = useState<number | null>(done[done.length - 1]?.id ?? null);
  const [a, setA] = useState<Run | null>(null);
  const [b, setB] = useState<Run | null>(null);

  useEffect(() => {
    if (aId) api<Run>(`/api/runs/${aId}`).then(setA).catch(() => setA(null));
  }, [aId]);
  useEffect(() => {
    if (bId) api<Run>(`/api/runs/${bId}`).then(setB).catch(() => setB(null));
  }, [bId]);

  if (done.length < 2) {
    return <p className="think">Test at least two versions to compare them. Change one thing, test again, then come back here.</p>;
  }
  const vOf = (id: number | null) => versionOf(ws, id);
  const picker = (value: number | null, set: (id: number) => void, label: string) => (
    <select className="select" style={{ width: "auto" }} aria-label={label} value={value ?? ""} onChange={(e) => set(Number(e.target.value))}>
      {done.map((h) => <option key={h.id} value={h.id}>v{vOf(h.id)} · {h.total}/{h.max}</option>)}
    </select>
  );
  if (!a || !b) return <div className="row wrap">Compare {picker(aId, setAId, "First version")} with {picker(bId, setBId, "Second version")}</div>;

  const keys = ws.questions.map((q) => q.key);
  const passes = (r: Run, k: string) => r.results.filter((x) => x.question_key === k && x.pass).length;
  const blocked = (r: Run) => r.results.filter((x) => x.blocked_by && x.blocked_by !== "azure_filter").length;
  const changes = describeChanges({ config: a.config, rules: a.rules, tiers: a.tiers }, { config: b.config, rules: b.rules, tiers: b.tiers }, keys);
  const scoreDelta = b.total - a.total;
  const blockedDelta = blocked(b) - blocked(a);
  const verdict =
    changes.length === 0 ? "Same setup, different scores? That's the bot answering differently each time — why one test run is never enough."
    : scoreDelta > 0 && blockedDelta > 2 ? "The score went up, but the checks now block more answers. Did it get better — or just quieter?"
    : scoreDelta < 0 && blockedDelta > 0 ? `Tighter checks cost you ${-scoreDelta} ${scoreDelta === -1 ? "pass" : "passes"}. Has it gone from safe to useless?`
    : scoreDelta > 0 ? `Up ${scoreDelta}. ${botChanges(changes).length > 1 ? "But you changed more than one thing — which one did it?" : "Which question moved, and why?"}`
    : scoreDelta < 0 ? `Down ${-scoreDelta}. Open the FAILs in v${vOf(b.id)} — what did your change break?`
    : "Same score. Did the change do nothing — or fix one thing and break another? Check each question.";
  const move = (d: number) => (d > 0 ? <span className="bar-ok">+{d}</span> : d < 0 ? <span className="bar-no">{d}</span> : <span className="muted">=</span>);

  return (
    <>
      <div className="row wrap" style={{ marginBottom: 10 }}>
        Compare {picker(aId, setAId, "First version")} with {picker(bId, setBId, "Second version")}
      </div>
      <p className="changes">
        <strong>What changed from v{vOf(a.id)} to v{vOf(b.id)}:</strong> {changes.length ? changes.join(" · ") : "nothing"}
      </p>
      <div className="results-scroll">
        <table className="results compare">
          <thead>
            <tr><th>Question</th><th /><th>v{vOf(a.id)}</th><th>v{vOf(b.id)}</th><th>change</th></tr>
          </thead>
          <tbody>
            {ws.questions.map((q, i) => {
              const tier = b.tiers[q.key] ?? "ok";
              const pa = passes(a, q.key), pb = passes(b, q.key);
              return (
                <tr key={q.key}>
                  <td><strong>{i + 1}</strong> <span className="small">{q.text}</span></td>
                  <td><span className={`badge ${tier === "must" ? "must" : ""}`}>{tierLabel(tier)}</span></td>
                  <td>{pa}/{a.runs_per_test}</td>
                  <td><strong>{pb}/{b.runs_per_test}</strong> {pb >= barFor(tier, b.runs_per_test) ? <span className="bar-ok">✓</span> : <span className="bar-no">✗</span>}</td>
                  <td>{move(pb - pa)}</td>
                </tr>
              );
            })}
            <tr className="compare-total">
              <td colSpan={2}><strong>Total</strong></td><td>{a.total}/{a.max}</td><td><strong>{b.total}/{b.max}</strong></td><td>{move(scoreDelta)}</td>
            </tr>
            {a.attacks_max > 0 && b.attacks_max > 0 && ws.attacks.map((at) => {
              const ha = passes(a, at.key), hb = passes(b, at.key);
              return (
                <tr key={at.key}>
                  <td><span className="small">Attack · {targetLabel(at.target)}</span></td><td />
                  <td>{ha}/3</td><td><strong>{hb}/3</strong> {hb === 3 ? <span className="bar-ok">✓</span> : <span className="bar-no">✗</span>}</td><td>{move(hb - ha)}</td>
                </tr>
              );
            })}
            {a.attacks_max > 0 && b.attacks_max > 0 && (
              <tr className="compare-total">
                <td colSpan={2}><strong>Attacks stopped</strong></td><td>{a.attacks_held}/{a.attacks_max}</td><td><strong>{b.attacks_held}/{b.attacks_max}</strong></td><td>{move(b.attacks_held - a.attacks_held)}</td>
              </tr>
            )}
            <tr>
              <td colSpan={2}>Answers blocked by checks</td><td>{blocked(a)}</td><td>{blocked(b)}</td><td>{blockedDelta === 0 ? <span className="muted">=</span> : <span className="muted">{blockedDelta > 0 ? `+${blockedDelta}` : blockedDelta}</span>}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="think" style={{ marginTop: 12 }}>{verdict}</p>
    </>
  );
}

function drawerThink(r: Result, isAttack: boolean): string {
  if (isAttack && !r.pass)
    return "The attack got through. What would have stopped it — a clearer instruction in the prompt, giving the bot the right policy, or a rule in a check?";
  if (isAttack && r.blocked_by && r.blocked_by !== "azure_filter")
    return "One of your check rules stopped this attack. Would the same rule also block a normal customer by mistake? Try one in the preview.";
  if (isAttack)
    return "The bot didn't fall for it this time. It runs three times for a reason — did all three hold?";
  if (r.blocked_by && r.blocked_by !== "azure_filter" && !r.pass)
    return "A check stopped the bot's answer, but the safe reply didn't meet your rule. Is your rule fair to a polite refusal — or should the safe reply say more?";
  if (r.blocked_by && r.blocked_by !== "azure_filter")
    return "A check caught this one. Read what it would have said — that's what a customer would have seen without the check.";
  if (!r.pass)
    return "Is the bot wrong, or is your rule wrong? If this answer is actually fine, rewrite the rule. If it isn't — what would stop it: the prompt, or a check?";
  return "Do you agree? The second AI is only ever as good as the rules you gave it. If this answer shouldn't pass, make the rule sharper.";
}

function Drawer({ result, run, question, attack, onClose }: { result: Result; run: Run; question: string; attack?: AttackDef; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const rules = run.rules[result.question_key] ?? [];
  return (
    <>
      <div className="drawer-bg" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Why it was marked this way">
        <div className="row">
          <span className={`verdict ${result.pass ? "pass" : "fail"}`}>{result.pass ? "PASS" : "FAIL"}</span>
          <span className="muted small">{attack ? `attack · try ${result.iteration}` : `run ${result.iteration} of ${run.runs_per_test}`}</span>
          <button className="btn small ghost" style={{ marginLeft: "auto" }} onClick={onClose}>close</button>
        </div>
        <h3>What the customer asked</h3>
        <div className="quote">{question}</div>
        <h3>What the customer saw</h3>
        <div className="quote">{result.answer || <em className="muted">(no answer)</em>}</div>
        {result.blocked_by && <div className="mechanism">blocked by: {blockedLabel[result.blocked_by] ?? result.blocked_by}</div>}
        {result.original_answer && (
          <>
            <h3>What it would have said</h3>
            <div className="quote" style={{ opacity: 0.8 }}>{result.original_answer}</div>
          </>
        )}
        {attack && (
          <>
            <h3>The attack succeeds if</h3>
            <div className="quote" style={{ borderLeftColor: result.pass ? "var(--line)" : "var(--fail)" }}>{attack.failsIf}</div>
          </>
        )}
        {!attack && <h3>Your rules</h3>}
        {!attack && rules.map((r, i) => {
          const broke = result.failed_rules.includes(i + 1);
          return (
            <div key={i} className="quote" style={{ borderLeftColor: broke ? "var(--fail)" : "var(--line)", marginBottom: 6 }}>
              It&apos;s a pass if… {r}{broke && <strong style={{ color: "var(--fail)" }}> — broke this</strong>}
            </div>
          );
        })}
        <h3>Why the second AI marked it {result.pass ? "PASS" : "FAIL"}</h3>
        <p style={{ margin: 0 }}>{result.reason}</p>
        <p className="think" style={{ marginTop: 16 }}>{drawerThink(result, !!attack)}</p>
      </aside>
    </>
  );
}

/* ——— Fix it ——— */

function FixItPanel({ ws, setWs }: { ws: Workspace; setWs: React.Dispatch<React.SetStateAction<Workspace | null>> }) {
  const [prompt, setPrompt] = useState(ws.config.system_prompt);
  const [fallback, setFallback] = useState(ws.config.fallback_text);
  const [temperature, setTemperature] = useState(ws.config.temperature ?? 0.5);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const c = copy.controls;

  const save = async (patch: Partial<Config>, label: string) => {
    try {
      const r = await api<{ config: Config }>("/api/config", { method: "PUT", body: patch });
      setWs((w) => (w ? { ...w, config: r.config } : w));
      setSaved(label);
      setError("");
      setTimeout(() => setSaved((s) => (s === label ? "" : s)), 1500);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const toggles: { key: "question_check" | "answer_check" | "one_job"; list: "input_rules" | "output_rules" | "topics"; t: { label: string; help: string; prefix: string; placeholder: string }; num: number }[] = [
    { key: "question_check", list: "input_rules", t: c.input, num: 2 },
    { key: "answer_check", list: "output_rules", t: c.output, num: 3 },
    { key: "one_job", list: "topics", t: c.limit, num: 4 },
  ];

  return (
    <>
      <h2 className="panel-title">Fix it · your draft</h2>
      <p className="lead">{copy.fixIt.lead}</p>
      <p className="steps-label">Every time you change something…</p>
      <ol className="steps">{copy.fixIt.steps.map((s) => <li key={s}>{s}</li>)}</ol>
      <p className="highlight">{copy.fixIt.oneAtATime}</p>

      <div className="control">
        <div className="row"><span className="control-label grow">1 · {c.prompt.label}</span>{saved === "prompt" && <span className="saved">saved</span>}</div>
        <p className="small muted" style={{ margin: "2px 0 6px" }}>{c.prompt.help}</p>
        <textarea className="textarea" rows={6} value={prompt} maxLength={4000} onChange={(e) => setPrompt(e.target.value)}
          onBlur={() => prompt !== ws.config.system_prompt && save({ system_prompt: prompt }, "prompt")} style={{ fontSize: 13 }} aria-label="System prompt" />
        <details className="facts">
          <summary>+ the menu board from the app (always sent with your prompt)</summary>
          <pre>{ws.facts}</pre>
        </details>
        <div className="knowledge">
          <div className="row"><strong className="grow">{copy.knowledge.label}</strong>{saved === "knowledge" && <span className="saved">saved</span>}</div>
          <p className="small muted" style={{ margin: "2px 0 6px" }}>{copy.knowledge.help}</p>
          <div className="knowledge-grid">
            <label className="check disabled"><input type="checkbox" checked disabled /> Menu board (always)</label>
            {ws.knowledgeSections.map((k) => {
              const on = (ws.config.knowledge ?? []).includes(k.key);
              return (
                <label key={k.key} className="check" title={k.text}>
                  <input type="checkbox" checked={on} onChange={() => {
                    const next = on ? (ws.config.knowledge ?? []).filter((x) => x !== k.key) : [...(ws.config.knowledge ?? []), k.key];
                    setWs((w) => (w ? { ...w, config: { ...w.config, knowledge: next } } : w));
                    save({ knowledge: next }, "knowledge");
                  }} />
                  {k.label}
                </label>
              );
            })}
          </div>
          {!!ws.config.knowledge?.length && (
            <details className="facts">
              <summary>+ what you&apos;re giving it</summary>
              <pre>{ws.knowledgeSections.filter((k) => ws.config.knowledge?.includes(k.key)).map((k) => k.text.replace(/^POLICIES & TERMS\n/, "")).join("\n")}</pre>
            </details>
          )}
        </div>
        <button className="linkbtn" onClick={() => { setPrompt(ws.naivePrompt); save({ system_prompt: ws.naivePrompt }, "prompt"); }}>restore original</button>
      </div>

      {toggles.map(({ key, list, t, num }) => (
        <div className="control" key={key}>
          <label className="toggle">
            <input type="checkbox" checked={!!ws.config[key]} onChange={(e) => {
              const v = e.target.checked;
              setWs((w) => (w ? { ...w, config: { ...w.config, [key]: v } } : w));
              save({ [key]: v }, key);
            }} />
            <span><strong>{num} · {t.label}</strong><span className="small muted">{t.help}</span>{(saved === key || saved === list) && <span className="saved"> saved</span>}</span>
          </label>
          {ws.config[key] && (
            <div className="check-rules">
              <RuleList
                prefix={t.prefix} placeholder={t.placeholder} value={ws.config[list] ?? []}
                onSave={(rules) => { setWs((w) => (w ? { ...w, config: { ...w.config, [list]: rules } } : w)); save({ [list]: rules }, list); }}
              />
              {!(ws.config[list] ?? []).length && <p className="tiny" style={{ color: "var(--warn)", margin: "4px 0 0" }}>This check does nothing until you add a rule.</p>}
            </div>
          )}
        </div>
      ))}

      <div className="control">
        <div className="row"><span className="control-label grow">{copy.strictness.label}</span>{saved === "strictness" && <span className="saved">saved</span>}</div>
        <p className="small muted" style={{ margin: "2px 0 6px" }}>{copy.strictness.help}</p>
        <div className="seg" role="radiogroup" aria-label="How strict are the checks" style={{ marginBottom: 0 }}>
          {(["relaxed", "balanced", "strict"] as const).map((lvl) => (
            <button
              key={lvl} role="radio" aria-checked={(ws.config.strictness ?? "balanced") === lvl}
              className={(ws.config.strictness ?? "balanced") === lvl ? "on" : ""}
              onClick={() => { setWs((w) => (w ? { ...w, config: { ...w.config, strictness: lvl } } : w)); save({ strictness: lvl }, "strictness"); }}
            >{copy.strictness.options[lvl]}</button>
          ))}
        </div>
      </div>

      <div className="control">
        <div className="row"><span className="control-label grow">5 · {c.safe.label}</span>{saved === "fallback" && <span className="saved">saved</span>}</div>
        <p className="small muted" style={{ margin: "2px 0 6px" }}>{c.safe.help}</p>
        <textarea className="textarea" rows={3} value={fallback} maxLength={500} onChange={(e) => setFallback(e.target.value)}
          onBlur={() => fallback !== ws.config.fallback_text && save({ fallback_text: fallback }, "fallback")} style={{ minHeight: 60 }} aria-label="Safe reply" />
      </div>
      <div className="control">
        <div className="row"><span className="control-label grow">{copy.creativity.label}</span>{saved === "temperature" && <span className="saved">saved</span>}</div>
        <p className="small muted" style={{ margin: "2px 0 6px" }}>{copy.creativity.help}</p>
        <div className="slider-row">
          <span className="tiny muted">steady</span>
          <input
            type="range" min={0} max={1} step={0.1} value={temperature} aria-label="Creativity"
            onChange={(e) => setTemperature(Number(e.target.value))}
            onPointerUp={() => temperature !== ws.config.temperature && save({ temperature }, "temperature")}
            onKeyUp={() => temperature !== ws.config.temperature && save({ temperature }, "temperature")}
          />
          <span className="tiny muted">creative</span>
          <strong className="slider-value">{temperature.toFixed(1)}</strong>
        </div>
        {ws.botIgnoresTemperature && <p className="tiny" style={{ color: "var(--warn)", margin: "4px 0 0" }}>{copy.creativity.ignored}</p>}
      </div>

      <p className="tiny muted" style={{ marginBottom: 0 }}>{copy.checksConfirm}</p>
      {error && <p className="error">{error}</p>}
    </>
  );
}

/** A short list of plain-language rules, saved when you leave a box. Used by the three checks. */
function RuleList({ prefix, placeholder, value, onSave }: { prefix: string; placeholder: string; value: string[]; onSave: (rules: string[]) => void }) {
  const [drafts, setDrafts] = useState<string[]>(value.length ? value : [""]);
  const commit = (list: string[]) => onSave(list.map((r) => r.trim()).filter(Boolean));
  return (
    <>
      <div className="passif">{prefix}</div>
      {drafts.map((rule, i) => (
        <div key={i} className="rule">
          <span className="muted">·</span>
          <input
            className="input" value={rule} maxLength={120} placeholder={placeholder} aria-label={`${prefix} rule ${i + 1}`}
            onChange={(e) => setDrafts((d) => d.map((r, j) => (j === i ? e.target.value : r)))}
            onBlur={() => commit(drafts)}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          />
          <button className="x" aria-label="Remove rule" onClick={() => { const next = drafts.filter((_, j) => j !== i); setDrafts(next.length ? next : [""]); commit(next); }}>×</button>
        </div>
      ))}
      {drafts.length < 8 && (
        <div className="rule"><span className="muted">·</span><button className="linkbtn" onClick={() => setDrafts((d) => [...d, ""])}>+ add a rule</button></div>
      )}
    </>
  );
}

/* ——— Wrap-up: the deck's closing questions, answered from their own work ——— */

function Reflection({ ws, run }: { ws: Workspace; run: Run | null }) {
  const done = !!run && run.status !== "running";
  const liveV = versionOf(ws, ws.publishedRunId);
  const live = ws.history.find((h) => h.id === ws.publishedRunId);
  const items: [string, string, boolean | null][] = [
    [
      "Did you ship it?",
      live ? `Yes — v${liveV} went live at ${live.total}/${live.max}.` : "No — nothing was published to customers. What stopped it?",
      !!live,
    ],
    [
      "Did you evaluate it, and do you know how often it works?",
      done ? `Yes — ${run!.total}/${run!.max} on your last test, over ${ws.history.length} version${ws.history.length === 1 ? "" : "s"}.` : "Not yet — no finished tests.",
      done,
    ],
    [
      "Is the answer checked before the customer sees it?",
      done ? (run!.config.answer_check ? "Yes — the output check was on in your last test." : "No — the output check was off in your last test.") : "No finished tests.",
      done && run!.config.answer_check,
    ],
    ["Does it keep working when the model is slow, down, or expensive?", "Not something we built today — that's error handling and cost limits.", null],
    ["Would you know if it broke?", "Not today — that's logs and alerts.", null],
  ];
  return (
    <section className="panel">
      <h2 className="panel-title">A prototype, or a product?</h2>
      <ul className="reflect">
        {items.map(([q, a, ok]) => (
          <li key={q}>
            <span className={`mark ${ok === true ? "yes" : ok === false ? "no" : "later"}`} aria-hidden="true">{ok === true ? "✓" : ok === false ? "✗" : "…"}</span>
            <span><strong>{q}</strong><span className="small muted" style={{ display: "block" }}>{a}</span></span>
          </li>
        ))}
      </ul>
      <p className="small" style={{ margin: 0, fontWeight: 600 }}>{copy.wrapupFooter}</p>
    </section>
  );
}
