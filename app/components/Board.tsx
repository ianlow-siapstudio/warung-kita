"use client";

import { useCallback, useEffect, useState } from "react";
import { FIND_GROUPS, FIND_TYPES, typesInGroup } from "@/config/finds";
import { api } from "@/lib/client";

type Tile = { key: string; label: string; count: number; types: { key: string; label: string; short: string; count: number }[] };
type Pin = { id: number; name: string; question: string | null; reply: string };
type Score = {
  id: number; name: string; runs: number; latest: number | null; best: number | null; first: number | null; max: number | null;
  controls: string; models: string[]; mustMet: boolean | null; shipped: string | null;
};
type Find = { id: number; name: string; targets: number; total: number; rank: number; hits: Record<string, number> };
type Data = { harvest: { tiles: Tile[]; pinned: Pin[] }; scores: Score[]; finds: Find[] };
type SortKey = "name" | "latest" | "best" | "runs" | "gain";

const MODEL_LABEL: Record<string, string> = { azure: "Azure", ilmu: "ILMU", mock: "mock" };

/**
 * A projector is one screen and nobody scrolls it. Up to 16 people the full table fits; past that
 * the list runs in two columns and drops the detail columns, so every name stays readable from the
 * back of the room. `--rows` lets the CSS size the text to whatever is left of the screen.
 */
const COLUMN_AT = 16;
function inColumns<T>(rows: T[]): { chunks: T[][]; two: boolean; longest: number } {
  if (rows.length <= COLUMN_AT) return { chunks: [rows], two: false, longest: rows.length };
  const half = Math.ceil(rows.length / 2);
  return { chunks: [rows.slice(0, half), rows.slice(half)], two: true, longest: half };
}
const boardVars = (longest: number) => ({ "--rows": Math.max(longest, 6) }) as React.CSSProperties;

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
    const { chunks, two, longest } = inColumns(data.finds);
    return (
      <div className="board" style={boardVars(longest)}>
        <h1>Who broke it best</h1>
        <div className={`board-cols ${two ? "two" : ""}`}>
          {chunks.map((chunk, i) => (
            <table key={i} className="scores">
              <thead>
                <tr>
                  <th>#</th><th>name</th>
                  {!two && FIND_GROUPS.map((g) => <th key={g.key}>{g.label}</th>)}
                  <th>targets</th><th>reports</th>
                </tr>
              </thead>
              <tbody>
                {chunk.map((f) => (
                  <tr key={f.id}>
                    <td>{f.rank}</td>
                    <td><strong>{f.name}</strong></td>
                    {!two && FIND_GROUPS.map((g) => {
                      const types = typesInGroup(g.key);
                      const got = types.filter((t) => f.hits[t.key]).length;
                      return <td key={g.key}>{got ? <span className="up">{got}/{types.length}</span> : <span style={{ opacity: 0.35 }}>—</span>}</td>;
                    })}
                    <td><strong>{f.targets}/{FIND_TYPES.length}</strong></td>
                    <td>{f.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
        {!data.finds.length && <p style={{ opacity: 0.6 }}>No reports yet.</p>}
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
              <div className="tile-head">
                <div className="label">{t.label}</div>
                <div className="count">{t.count}</div>
              </div>
              <ul className="tile-types">
                {t.types.map((ty) => (
                  <li key={ty.key} className={ty.count ? "got" : ""}>
                    <span className="grow">{ty.label}</span>
                    <span className="n">{ty.count}</span>
                    <span className="adj">
                      <button aria-label={`minus one ${ty.label}`} onClick={async () => { await api("/api/ops/tiles", { body: { key: ty.key, delta: -1 } }); refresh(); }}>−</button>
                      <button aria-label={`plus one ${ty.label}`} onClick={async () => { await api("/api/ops/tiles", { body: { key: ty.key, delta: 1 } }); refresh(); }}>+</button>
                    </span>
                  </li>
                ))}
              </ul>
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

  const { chunks, two, longest } = inColumns(rows);
  return (
    <div className="board" style={boardVars(longest)}>
      <h1>Before → after</h1>
      <div className={`board-cols ${two ? "two" : ""}`}>
        {chunks.map((chunk, i) => (
          <table key={i} className="scores">
            <thead>
              <tr>
                {th("name", "name")}
                {th("gain", "before → after")}
                {th("latest", "latest")}
                {!two && th("best", "best")}
                {!two && <th>what&apos;s on</th>}
                {!two && th("runs", "runs")}
                <th>shipped</th>
              </tr>
            </thead>
            <tbody>
              {chunk.map((s) => (
                <tr key={s.id}>
                  <td><strong>{s.name}</strong></td>
                  <td>
                    {s.first == null ? "—" : (
                      <>{s.first} → <span className={s.latest! > s.first ? "up" : ""}>{s.latest}</span></>
                    )}
                  </td>
                  <td>{s.latest == null ? "—" : `${s.latest}/${s.max}`}{s.mustMet && " ✓"}</td>
                  {!two && <td>{s.best == null ? "—" : s.best}</td>}
                  {!two && <td style={{ fontSize: ".75em" }}>{s.controls} {s.models.map((m) => <span key={m} className="badge model" style={{ marginLeft: 4 }}>{MODEL_LABEL[m] ?? m}</span>)}</td>}
                  {!two && <td>{s.runs}</td>}
                  <td>{s.shipped ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
      {!rows.length && <p style={{ opacity: .6 }}>No one has run their tests yet.</p>}
    </div>
  );
}
