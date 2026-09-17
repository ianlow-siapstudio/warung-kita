import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { body, fail, json, withAdmin } from "@/lib/http";
import { recordCachedDemo } from "@/lib/runs";

export async function POST(req: NextRequest) {
  const b = await body<{ action: "record" | "delete"; runId: number; id: number }>(req);
  return withAdmin(req, () => {
    if (b.action === "record") {
      try {
        recordCachedDemo(Number(b.runId));
      } catch (err) {
        return fail((err as Error).message);
      }
      return json({ ok: true });
    }
    if (b.action === "delete") {
      db().prepare("DELETE FROM cached_demo WHERE id=?").run(Number(b.id));
      return json({ ok: true });
    }
    return fail("Unknown action.");
  });
}
