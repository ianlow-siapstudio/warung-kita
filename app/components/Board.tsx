"use client";

import { useCallback, useEffect, useState } from "react";
import { FIND_GROUPS, FIND_TYPES, typesInGroup } from "@/config/finds";
import { api } from "@/lib/client";

type Tile = { key: string; label: string; count: number };
type Pin = { id: number; name: string; question: string | null; reply: string };
type Score = {
  id: number; name: string; runs: number; latest: number | null; best: number | null; first: number | null; max: number | null;
  controls: string; models: string[]; mustMet: boolean | null; shipped: string | null;
};
type Find = { id: number; name: string; targets: number; total: number; rank: number; hits: Record<string, number> };
type Data = { harvest: { tiles: Tile[]; pinned: Pin[] }; scores: Score[]; finds: Find[] };
type SortKey = "name" | "latest" | "best" | "runs" | "gain";

const MODEL_LABEL: Record<string, string> = { azure: "Azure", ilmu: "ILMU", mock: "mock" };

export function Board({ view }: { view: "harvest" | "scores" | "finds" }) {
  const [data, setData] = useState<Data | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "gain", dir: -1 });

  const refresh = useCallback(async () => {
    try { setData(await api<Data>("/api/ops/board")); } catch {}
  }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  if (!data) return <div className="board" />;

  if (view === "finds") {
    return (
      <div className="board">
        <h1>Who broke it best</h1>
        <table className="scores">
          <thead>
            <tr><th>#</th><th>name</th>{FIND_GROUPS.map((g) => <th key={g.key}>{g.label}</th>)}<th>targets</th><th>reports</th></tr>
          </thead>
          <tbody>
            {data.finds.map((f) => (
              <tr key={f.id}>
                <td>{f.rank}</td>
                <td><strong>{f.name}</strong></td>
                {FIND_GROUPS.map((g) => {
                  const types = typesInGroup(g.key);
                  const got = types.filter((t) => f.hits[t.key]).length;
                  return <td key={g.key}>{got ? <span className="up">{got}/{types.length}</span> : <span style={{ opacity: 0.35 }}>—</span>}</td>;
                })}
                <td><strong>{f.targets}/{FIND_TYPES.length}</strong></td>
                <td>{f.total}</td>
              </tr>
            ))}
            {!data.finds.length && <tr><td colSpan={FIND_GROUPS.length + 4} style={{ opacity: 0.6 }}>No reports yet.</td></tr>}
          </tbody>
        </table>
      </div>
    );
  }

  if (view === "harvest") {
    const pins = data.harvest.pinned;
    return (
      <div className="board">
        <div className="tiles">
          {data.harvest.tiles.map((t) => (
            <div key={t.key} className="tile">
              <div className="label">{t.label}</div>
              <div className="count">{t.count}</div>
              <div className="adj">
                <button aria-label={`minus one ${t.label}`} onClick={async () => { await api("/api/ops/tiles", { body: { key: t.key, delta: -1 } }); refresh(); }}>−1</button>
                <button aria-label={`plus one ${t.label}`} onClick={async () => { await api("/api/ops/tiles", { body: { key: t.key, delta: 1 } }); refresh(); }}>+1</button>
              </div>
            </div>
          ))}
        </div>
        {pins.length > 0 && (
          <div className="pins">
            {/* Doubled list so the scroll loops seamlessly. */}
            <div className="pins-track" style={{ ["--dur" as string]: `${Math.max(20, pins.length * 8)}s` }}>
              {[...pins, ...pins].map((p, i) => (
                <div key={`${p.id}-${i}`} className="pin">
                  <div className="q">{p.name}: “{p.question}”</div>
                  <div className="a">{p.reply}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  const val = (s: Score): number | string => {
    switch (sort.key) {
      case "name": return s.name.toLowerCase();
      case "latest": return s.latest ?? -1;
      case "best": return s.best ?? -1;
      case "runs": return s.runs;
      case "gain": return s.latest != null && s.first != null ? s.latest - s.first : -999;
    }
  };
  const rows = [...data.scores].sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sort.dir);
  const th = (key: SortKey, label: string) => (
    <th onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "name" ? 1 : -1 }))}>
      {label}{sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
    </th>
  );

  return (
    <div className="board">
      <h1>Before → after</h1>
      <table className="scores">
        <thead>
          <tr>
            {th("name", "name")}
            {th("gain", "before → after")}
            {th("latest", "latest")}
            {th("best", "best")}
            <th>what&apos;s on</th>
            {th("runs", "runs")}
            <th>shipped</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id}>
              <td><strong>{s.name}</strong></td>
              <td>
                {s.first == null ? "—" : (
                  <>{s.first} → <span className={s.latest! > s.first ? "up" : ""}>{s.latest}</span></>
                )}
              </td>
              <td>{s.latest == null ? "—" : `${s.latest}/${s.max}`}{s.mustMet && " ✓"}</td>
              <td>{s.best == null ? "—" : s.best}</td>
              <td style={{ fontSize: ".75em" }}>{s.controls} {s.models.map((m) => <span key={m} className="badge model" style={{ marginLeft: 4 }}>{MODEL_LABEL[m] ?? m}</span>)}</td>
              <td>{s.runs}</td>
              <td>{s.shipped ?? "—"}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={7} style={{ opacity: .6 }}>No one has run their tests yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
