import type { NextRequest } from "next/server";
import { isAdmin } from "@/lib/auth";
import { body, fail, json } from "@/lib/http";
import { createParticipant, findByName, NAME_COOKIE, PRESENTER, nameKey, touch } from "@/lib/participants";

export async function POST(req: NextRequest) {
  const { name = "", confirm = false } = await body<{ name: string; confirm: boolean }>(req);
  const clean = String(name).trim().replace(/\s+/g, " ").slice(0, 40);
  if (!clean) return fail("Type your name first.");
  if (nameKey(clean) === PRESENTER && !isAdmin(req)) return fail("That name is kept for the presenter — pick another.");

  let p = findByName(clean);
  if (p && !confirm && nameKey(clean) !== PRESENTER) {
    // Same name again: either the same person on another device, or a different person. Ask.
    return json({ status: "exists", name: p.name });
  }
  if (!p) p = createParticipant(clean);
  touch(p);

  const res = json({ status: "ok", name: p.name });
  res.cookies.set(NAME_COOKIE, encodeURIComponent(p.name), { path: "/", maxAge: 60 * 60 * 24 * 30, sameSite: "lax", httpOnly: false });
  return res;
}
