"use client";

import { useCallback, useEffect, useState } from "react";
import { copy } from "@/config/copy";
import { api, storeName, storedName } from "@/lib/client";
import { CustomerApp } from "./CustomerApp";
import { Studio } from "./Studio";

type Phase = "closed" | "activity1" | "demo" | "activity2" | "wrapup";
type State = { phase: Phase; me: { name: string; presenter: boolean } | null };

export function ParticipantApp() {
  const [state, setState] = useState<State | null>(null);
  const [offline, setOffline] = useState(false);

  const refresh = useCallback(async () => {
    try {
      let s = await api<State>("/api/state");
      // Cookie gone but this device remembers the name — quietly sign back in.
      if (!s.me && storedName()) {
        await api("/api/join", { body: { name: storedName(), confirm: true } }).catch(() => storeName(""));
        s = await api<State>("/api/state");
      }
      setState(s);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  if (!state) return <div className="center-card muted">{offline ? "Can't reach the server — retrying…" : "Loading…"}</div>;
  if (!state.me) return <NameGate onDone={refresh} />;

  const signOut = async () => {
    await api("/api/leave", { body: {} }).catch(() => {});
    storeName("");
    refresh();
  };

  const LABEL: Record<Phase, string> = {
    closed: "Workshop", activity1: "Workshop · Activity 1", demo: "Workshop · Demo", activity2: "Workshop · Activity 2", wrapup: "Workshop · Wrap-up",
  };
  // The exercise lives in a dark strip, kept visibly apart from the pretend product underneath.
  const header = (instruction: string) => (
    <>
      <div className="workshop-bar">
        <span className="strip-label">{LABEL[state.phase]}</span>
        <span className="strip-lead grow">{instruction}</span>
        <span className="who">{state.me!.name} · <button className="linkbtn" onClick={signOut}>not you?</button></span>
      </div>
      {offline && <div className="notice" style={{ borderRadius: 0 }}>Can&apos;t reach the server — retrying…</div>}
    </>
  );

  switch (state.phase) {
    case "closed":
      return (
        <>
          {header(copy.closed)}
          <div className="center-card"><div className="card"><h1>{copy.closed}</h1><p className="muted">Keep this page open — it will change by itself.</p></div></div>
        </>
      );
    case "activity1":
      return <CustomerApp key="a1" name={state.me.name} onSignOut={signOut} />;
    case "demo":
    case "activity2":
      return <Studio key="studio" phase={state.phase} presenter={state.me.presenter} header={header} />;
    case "wrapup":
      return <Studio key="wrap" phase="wrapup" presenter={state.me.presenter} header={header} />;
  }
}

function NameGate({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [exists, setExists] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const join = async (confirm: boolean) => {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ status: string; name: string }>("/api/join", { body: { name, confirm } });
      if (r.status === "exists") setExists(r.name);
      else {
        storeName(r.name);
        onDone();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center-card">
      <div className="card">
        <h1>Warung Kita</h1>
        {exists ? (
          <>
            <p><strong>Someone&apos;s already using &ldquo;{exists}&rdquo;.</strong></p>
            <p className="muted">If that&apos;s you on another device, carry on and your work comes with you. If not, add your surname.</p>
            <div className="row wrap" style={{ marginTop: 14 }}>
              <button className="btn" disabled={busy} onClick={() => join(true)}>That&apos;s me</button>
              <button className="btn ghost" disabled={busy} onClick={() => { setExists(null); setName(`${name.trim()} `); }}>Add my surname</button>
            </div>
          </>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) join(false); }}>
            <label htmlFor="name" style={{ display: "block", fontWeight: 700, marginTop: 12 }}>Your name</label>
            <p className="muted small" style={{ margin: "2px 0 8px" }}>so your work is saved. First name is fine.</p>
            <input id="name" className="input" autoFocus autoComplete="given-name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} style={{ fontSize: 16 }} />
            <button className="btn" style={{ marginTop: 12, width: "100%" }} disabled={busy || !name.trim()}>Start</button>
          </form>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
