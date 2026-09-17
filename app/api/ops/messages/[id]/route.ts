import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { body, fail, json, withAdmin } from "@/lib/http";
import { isFindType } from "@/config/finds";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = await body<{ pinned: boolean; category: string }>(req);
  return withAdmin(req, () => {
    if (typeof b.pinned === "boolean") db().prepare("UPDATE messages SET pinned=? WHERE id=?").run(b.pinned ? 1 : 0, Number(id));
    if (b.category !== undefined) {
      // "" clears it — the presenter's call that a report isn't a real find.
      if (b.category !== "" && !isFindType(b.category)) return fail("Unknown category.");
      db().prepare("UPDATE messages SET category=? WHERE id=?").run(b.category || null, Number(id));
    }
    return json({ ok: true });
  });
}
