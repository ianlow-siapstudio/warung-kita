import type { NextRequest } from "next/server";
import { body, fail, json, withAdmin } from "@/lib/http";
import { isFindType } from "@/config/finds";
import { getSetting, setSetting } from "@/lib/settings";

export async function POST(req: NextRequest) {
  const { key, delta = 1 } = await body<{ key: string; delta: number }>(req);
  return withAdmin(req, () => {
    if (!isFindType(key)) return fail("Unknown target.");
    const k = `tile_adjust_${key}`;
    setSetting(k, String((Number(getSetting(k)) || 0) + (Number(delta) === -1 ? -1 : 1)));
    return json({ ok: true });
  });
}
