"use client";

/** The app is served at the domain root (warung-kita.siapstudio.my). Set a prefix here if it ever moves under a path. */
export const BASE = "";
const NAME_KEY = "wk_name";

export const storedName = () => {
  try { return localStorage.getItem(NAME_KEY) || ""; } catch { return ""; }
};
export const storeName = (name: string) => {
  try { if (name) localStorage.setItem(NAME_KEY, name); else localStorage.removeItem(NAME_KEY); } catch {}
};

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

/** fetch() with the localStorage name as a fallback identity. JSON in, JSON out. */
export async function api<T = unknown>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const name = storedName();
  if (name) headers["x-wk-name"] = encodeURIComponent(name);
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
      headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Can't reach the server — check the wifi and try again.", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error || "Something went wrong — try again.", res.status);
  return data as T;
}

export const time = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
