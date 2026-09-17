"use client";

import { useState } from "react";
import { api } from "@/lib/client";

export function OpsLogin() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  return (
    <div className="center-card">
      <form className="card" onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api("/api/ops/login", { body: { password } });
          location.reload();
        } catch (err) {
          setError((err as Error).message);
        }
      }}>
        <h1>Warung Kita · ops</h1>
        <input className="input" type="password" autoFocus placeholder="admin password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ marginTop: 12 }} />
        <button className="btn" style={{ marginTop: 12, width: "100%" }}>Sign in</button>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}
