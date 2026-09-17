import type { NextRequest } from "next/server";
import { ADMIN_COOKIE, adminToken, checkPassword } from "@/lib/auth";
import { body, fail, json } from "@/lib/http";

export async function POST(req: NextRequest) {
  const { password = "" } = await body<{ password: string }>(req);
  if (!process.env.ADMIN_PASSWORD) return fail("ADMIN_PASSWORD isn't set on the server.", 500);
  if (!checkPassword(String(password))) return fail("Wrong password.", 401);
  const res = json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, adminToken()!, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 7 });
  return res;
}
