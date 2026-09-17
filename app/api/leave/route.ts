import { json } from "@/lib/http";
import { NAME_COOKIE } from "@/lib/participants";

export async function POST() {
  const res = json({ ok: true });
  res.cookies.set(NAME_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
