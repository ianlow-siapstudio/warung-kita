import crypto from "node:crypto";
import type { NextRequest } from "next/server";

export const ADMIN_COOKIE = "wk_admin";

export function adminToken(): string | null {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return null;
  return crypto.createHmac("sha256", pw).update("warung-kita-ops").digest("hex");
}

export function checkPassword(pw: string): boolean {
  const real = process.env.ADMIN_PASSWORD;
  if (!real) return false;
  const a = Buffer.from(pw), b = Buffer.from(real);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function isAdminToken(value: string | undefined): boolean {
  const t = adminToken();
  return !!t && value === t;
}

export const isAdmin = (req: NextRequest) => isAdminToken(req.cookies.get(ADMIN_COOKIE)?.value);
