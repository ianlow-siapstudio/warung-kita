import { ADMIN_COOKIE } from "@/lib/auth";
import { json } from "@/lib/http";

export function POST() {
  const res = json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
