"use client";

import { useCallback, useEffect, useState } from "react";
import { FIND_GROUPS, findGroupOf, typesInGroup } from "@/config/finds";
import { api, BASE, time } from "@/lib/client";

type Strip = { calls: number; errors: number; errorRate: number; p95: number; filtered: number };
type Overview = {
  phase: string;
  runsPerTest: number;
  cachedDemo: boolean;
  botModel: string;
  botChoices: { name: string; label: string; model: string; configured: boolean; strip: Strip }[];
  marker: string;
  banner: string | null;
  stats: {
    online: number; participants: number; messages: number; runs: number; calls: number; cost: number; p95: number;
    errors: number; filterBlocks: number; markerErrors: number; queue: { active: number; waiting: number };
  };
  participants: { id: number; name: string; name_key: string; last_seen: number | null; runs: number; messages: number }[];
  cached: { id: number; provider: string; label: string; created_at: number }[];
  presenterRuns: { id: number; total: number; max: number; bot_model: string; started_at: number; cached: number }[];
};
type FeedItem = { id: number; name: string; question: string | null; reply: string; category: string | null; report_note: string | null; pinned: number; blocked_by: string | null; created_at: number };

const PHASES: [string, string][] = [
  ["closed", "closed"],
  ["activity1", "activity 1 · break it"],
  ["demo", "demo"],
  ["activity2", "activity 2 · test it / fix it"],
  ["wrapup", "wrap-up"],
];

export function OpsConsole() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [msg, setMsg] = useState("");
  const [pings, setPings] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      const [o, f] = await Promise.all([api<Overview>("/api/ops/overview"), api<{ items: FeedItem[] }>("/api/ops/feed")]);
      setOv(o);
      setFeed(f.items);
    } catch (e) {
      if ((e as { status?: number }).status === 401) location.reload();
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 3000); };
  const set = async (body: Record<string, unknown>) => {
    try { await api("/api/ops/settings", { body }); await refresh(); } catch (e) { flash((e as Error).message); }
  };

  if (!ov) return <div className="center-card muted">Loading…</div>;

  const ping = async (name: string) => {
    setPings((p) => ({ ...p, [name]: "pinging…" }));
    const r = await api<{ ok: boolean; ms?: number; error?: string }>("/api/ops/ping", { body: { provider: name } }).catch((e) => ({ ok: false, error: (e as Error).message, ms: 0 }));
    setPings((p) => ({ ...p, [name]: r.ok ? `ok · ${r.ms} ms` : `fail · ${r.error}` }));
  };

  const switchBot = (name: string) => {
    if (ov.phase === "activity2" && !confirm("Switching the bot during Activity 2 means people's before/after are on different models. Switch anyway?")) return;
    set({ botModel: name });
  };

  return (
    <>
      {ov.banner && <div className="banner-red">⚠ {ov.banner} Consider switching the bot model.</div>}
      <div className="ops">
        <div className="ops-bar">
          <div className="row wrap">
            <strong style={{ fontSize: 18 }}>Warung Kita · ops</strong>
            <a className="btn small ghost" href={`${BASE}/ops/board?view=harvest`} target="_blank" rel="noreferrer">harvest board ↗</a>
            <a className="btn small ghost" href={`${BASE}/ops/board?view=finds`} target="_blank" rel="noreferrer">finds leaderboard ↗</a>
            <a className="btn small ghost" href={`${BASE}/ops/board?view=scores`} target="_blank" rel="noreferrer">scores leaderboard ↗</a>
            <a className="btn small ghost" href={`${BASE}`} target="_blank" rel="noreferrer">participant app ↗</a>
            <span className="grow" />
            {msg && <span className="notice small">{msg}</span>}
            <button className="linkbtn" onClick={async () => { await api("/api/ops/logout", { body: {} }); location.reload(); }}>sign out</button>
          </div>
          <div className="phase-radio" role="radiogroup" aria-label="Phase">
            {PHASES.map(([k, label]) => (
              <label key={k} className={ov.phase === k ? "on" : ""}>
                <input type="radio" name="phase" checked={ov.phase === k} onChange={() => set({ phase: k })} />
                {label}
              </label>
            ))}
          </div>
          <div className="stat-strip">
            <div><b>{ov.stats.online}</b><span>online</span></div>
            <div><b>{ov.stats.participants}</b><span>people</span></div>
            <div><b>{ov.stats.messages}</b><span>messages</span></div>
            <div><b>{ov.stats.runs}</b><span>runs</span></div>
            <div><b>{ov.stats.calls}</b><span>AI calls</span></div>
            <div><b>${ov.stats.cost.toFixed(3)}</b><span>est. cost</span></div>
            <div><b>{ov.stats.p95} ms</b><span>p95 (10 min)</span></div>
            <div><b style={{ color: ov.stats.errors ? "var(--fail)" : undefined }}>{ov.stats.errors}</b><span>errors</span></div>
            <div><b>{ov.stats.filterBlocks}</b><span>Azure filter blocks</span></div>
            <div><b style={{ color: ov.stats.markerErrors ? "var(--fail)" : undefined }}>{ov.stats.markerErrors}</b><span>marker errors</span></div>
            <div><b>{ov.stats.queue.active}/{ov.stats.queue.waiting}</b><span>queue active/waiting</span></div>
          </div>
        </div>

        <div className="ops-grid">
          <section className="panel">
            <h2>Bot model</h2>
            <p className="small muted" style={{ marginTop: 0 }}>Takes effect on the next call. Switch between phases, not during Activity 2.</p>
            {ov.botChoices.map((p) => (
              <div key={p.name} className={`provider ${ov.botModel === p.name ? "selected" : ""}`}>
                <label className="row" style={{ cursor: p.configured ? "pointer" : "default" }}>
                  <input type="radio" name="bot" checked={ov.botModel === p.name} disabled={!p.configured} onChange={() => switchBot(p.name)} />
                  <strong className="grow">{p.label}</strong>
                  {!p.configured && <span className="badge">not configured</span>}
                  <button className="btn small ghost" disabled={!p.configured} onClick={(e) => { e.preventDefault(); ping(p.name); }}>ping</button>
                </label>
                <div className="tiny muted" style={{ marginTop: 4 }}>
                  model/deployment: {p.model}{pings[p.name] && <> · <strong style={{ color: pings[p.name].startsWith("ok") ? "var(--pass)" : "var(--fail)" }}>{pings[p.name]}</strong></>}
                </div>
                <div className="tiny" style={{ marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
                  last 10 min: {p.strip.calls} calls · <span style={{ color: p.strip.errors ? "var(--fail)" : undefined }}>{p.strip.errors} errors</span> · p95 {p.strip.p95} ms · {p.strip.filtered} filter blocks
                </div>
              </div>
            ))}
            <p className="small" style={{ marginBottom: 0 }}><strong>Marker model:</strong> {ov.marker} <span className="muted">(fixed)</span></p>
          </section>

          <section className="panel">
            <h2>Runs &amp; demo</h2>
            <label className="row">
              <span className="grow">Runs per test</span>
              <select className="select" style={{ width: 90 }} value={ov.runsPerTest} onChange={(e) => set({ runsPerTest: Number(e.target.value) })}>
                <option value={3}>3</option><option value={5}>5</option><option value={10}>10</option>
              </select>
            </label>
            <p className="tiny muted">Bars: must-not-fail = {ov.runsPerTest}/{ov.runsPerTest}, others = {Math.ceil(ov.runsPerTest * 0.8)}/{ov.runsPerTest}.</p>

            <label className="toggle" style={{ marginTop: 12 }}>
              <input type="checkbox" checked={ov.cachedDemo} onChange={(e) => set({ cachedDemo: e.target.checked })} />
              <span><strong>Use cached demo results</strong><span className="small muted">The presenter&apos;s Run replays a recording for the selected bot instead of calling the AI. Matches on rules; otherwise plays recordings in order.</span></span>
            </label>

            <h2 style={{ marginTop: 16 }}>Recordings</h2>
            <table className="table">
              <tbody>
                {ov.cached.filter((c) => c.provider === ov.botModel).map((c) => (
                  <tr key={c.id}>
                    <td className="small">{c.label}</td>
                    <td style={{ textAlign: "right" }}><button className="linkbtn" onClick={async () => { if (confirm("Delete this recording?")) { await api("/api/ops/cached", { body: { action: "delete", id: c.id } }); refresh(); } }}>delete</button></td>
                  </tr>
                ))}
                {!ov.cached.some((c) => c.provider === ov.botModel) && <tr><td className="small muted">No recordings for this bot — the demo will run live.</td></tr>}
              </tbody>
            </table>
            <p className="small" style={{ marginBottom: 4 }}>Save one of the presenter&apos;s finished runs as a recording:</p>
            {ov.presenterRuns.length === 0 && <p className="tiny muted">No presenter runs yet. Sign in as <code>presenter</code> in this browser and run the tests.</p>}
            {ov.presenterRuns.map((r) => (
              <div key={r.id} className="row small" style={{ padding: "3px 0" }}>
                <span className="grow">{time(r.started_at)} · {r.total}/{r.max} · <span className="badge model">{r.bot_model}</span>{r.cached ? " · (replay)" : ""}</span>
                {!r.cached && <button className="btn small ghost" onClick={async () => { try { await api("/api/ops/cached", { body: { action: "record", runId: r.id } }); flash("Saved as recording."); refresh(); } catch (e) { flash((e as Error).message); } }}>save as recording</button>}
              </div>
            ))}
          </section>

          <section className="panel">
            <h2>Housekeeping</h2>
            <div className="row wrap">
              <a className="btn small ghost" href={`${BASE}/api/ops/export?type=messages`}>Export messages CSV</a>
              <a className="btn small ghost" href={`${BASE}/api/ops/export?type=results`}>Export results CSV</a>
              <a className="btn small ghost" href={`${BASE}/api/ops/qr`} target="_blank" rel="noreferrer">QR code ↗</a>
            </div>
            <ResetBox onDone={() => { flash("Reset done."); refresh(); }} />
            <h2 style={{ marginTop: 18 }}>People</h2>
            <People list={ov.participants} onChange={refresh} flash={flash} />
          </section>
        </div>

        <section className="panel" style={{ marginTop: 14 }}>
          <div className="row"><h2 className="grow" style={{ margin: 0 }}>Live feed · Activity 1</h2><span className="tiny muted">{feed.length} replies · newest first</span></div>
          <div className="feed" style={{ marginTop: 10 }}>
            {feed.length === 0 && <p className="muted small">Nothing yet.</p>}
            {feed.map((f) => (
              <div key={f.id} className={`feed-item ${f.pinned ? "pinned" : ""}`}>
                <div className="row wrap">
                  <strong>{f.name}</strong>
                  <span className="tiny muted">{time(f.created_at)}</span>
                  <span className="grow" />
                  <select className={`cat cat-${findGroupOf(f.category) ?? "fine"}`} style={{ border: "none" }} value={f.category ?? ""} title="What the participant reported — change it, or clear a report that isn't a real find" onChange={async (e) => { await api(`/api/ops/messages/${f.id}`, { body: { category: e.target.value } }); refresh(); }}>
                    <option value="">not reported</option>
                    {FIND_GROUPS.map((g) => (
                      <optgroup key={g.key} label={g.label}>
                        {typesInGroup(g.key).map((t) => <option key={t.key} value={t.key}>{t.short}</option>)}
                      </optgroup>
                    ))}
                  </select>
                  <button className="btn small ghost" onClick={async () => { await api(`/api/ops/messages/${f.id}`, { body: { pinned: !f.pinned } }); refresh(); }}>{f.pinned ? "unpin" : "pin"}</button>
                </div>
                <div className="q" style={{ marginTop: 4 }}>“{f.question}”</div>
                <div className="a">{f.reply}</div>
                {f.report_note && <div className="tiny" style={{ marginTop: 4 }}>Why: {f.report_note}</div>}
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function ResetBox({ onDone }: { onDone: () => void }) {
  const [full, setFull] = useState(false);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const word = full ? "FULL RESET" : "RESET";
  return (
    <div style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
      <strong>Reset</strong>
      <p className="tiny muted" style={{ margin: "2px 0 6px" }}>
        {full ? "Wipes everything except the presenter and recordings: people, rules, settings per person, chats, runs, call log." : "Wipes chats, runs and results. Keeps people and their rules."}
      </p>
      <label className="row small"><input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} /> full reset</label>
      <div className="row" style={{ marginTop: 6 }}>
        <input className="input" placeholder={`type ${word}`} value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn danger small" disabled={text !== word} onClick={async () => {
          try { await api("/api/ops/reset", { body: { confirm: text, full } }); setText(""); setErr(""); onDone(); } catch (e) { setErr((e as Error).message); }
        }}>Reset</button>
      </div>
      {err && <p className="error">{err}</p>}
    </div>
  );
}

function People({ list, onChange, flash }: { list: Overview["participants"]; onChange: () => void; flash: (m: string) => void }) {
  const [editing, setEditing] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [into, setInto] = useState<number | "">("");
  const act = async (body: Record<string, unknown>) => {
    try { await api("/api/ops/participants", { body }); setEditing(null); onChange(); } catch (e) { flash((e as Error).message); }
  };
  return (
    <div style={{ maxHeight: 320, overflowY: "auto" }}>
      <table className="table">
        <thead><tr><th>name</th><th>msgs</th><th>runs</th><th /></tr></thead>
        <tbody>
          {list.map((p) => (
            <tr key={p.id}>
              <td>
                <span style={{ color: p.last_seen && Date.now() - p.last_seen < 30_000 ? "var(--pass)" : "var(--line)" }}>●</span> {p.name}
                {editing === p.id && (
                  <div style={{ marginTop: 6, display: "grid", gap: 6 }}>
                    <div className="row"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /><button className="btn small" onClick={() => act({ action: "rename", id: p.id, name })}>rename</button></div>
                    <div className="row">
                      <select className="select" value={into} onChange={(e) => setInto(e.target.value ? Number(e.target.value) : "")}>
                        <option value="">merge into…</option>
                        {list.filter((o) => o.id !== p.id).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                      <button className="btn small" disabled={!into} onClick={() => confirm(`Move ${p.name}'s work into the other name and remove "${p.name}"?`) && act({ action: "merge", id: p.id, intoId: into })}>merge</button>
                    </div>
                  </div>
                )}
              </td>
              <td>{p.messages}</td>
              <td>{p.runs}</td>
              <td style={{ textAlign: "right" }}>
                {p.name_key !== "presenter" && <button className="linkbtn" onClick={() => { setEditing(editing === p.id ? null : p.id); setName(p.name); setInto(""); }}>{editing === p.id ? "close" : "edit"}</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
