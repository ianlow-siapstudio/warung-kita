import type { NextRequest } from "next/server";
import { body, fail, json, withAdmin } from "@/lib/http";
import { FIND_GROUPS } from "@/config/finds";
import { getSetting, setSetting } from "@/lib/settings";

export async function POST(req: NextRequest) {
  const { key, delta = 1 } = await body<{ key: string; delta: number }>(req);
  return withAdmin(req, () => {
    if (!FIND_GROUPS.some((g) => g.key === key)) return fail("Unknown tile.");
    const k = `tile_adjust_${key}`;
    setSetting(k, String((Number(getSetting(k)) || 0) + (Number(delta) === -1 ? -1 : 1)));
    return json({ ok: true });
  });
}
