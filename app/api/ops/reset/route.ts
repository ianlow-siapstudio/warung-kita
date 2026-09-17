import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { body, fail, json, withAdmin } from "@/lib/http";
import { activeRunId } from "@/lib/runs";

export async function POST(req: NextRequest) {
  const { confirm = "", full = false } = await body<{ confirm: string; full: boolean }>(req);
  return withAdmin(req, () => {
    if (confirm !== (full ? "FULL RESET" : "RESET")) return fail(`Type ${full ? "FULL RESET" : "RESET"} to confirm.`);
    const d = db();
    const running = d.prepare("SELECT participant_id FROM runs WHERE status='running'").all() as { participant_id: number }[];
    if (running.some((r) => activeRunId(r.participant_id))) return fail("Some runs are still going — wait for them to finish.");
    d.transaction(() => {
      d.exec("DELETE FROM results; DELETE FROM runs; DELETE FROM messages; DELETE FROM conversations;");
      d.exec("UPDATE participants SET published_run_id=NULL");
      d.exec("DELETE FROM settings WHERE key LIKE 'tile_adjust_%'");
      if (full) {
        d.exec("DELETE FROM participants WHERE name_key<>'presenter'; DELETE FROM calls;");
        d.exec("DELETE FROM config; DELETE FROM rules WHERE participant_id NOT IN (SELECT id FROM participants WHERE name_key='presenter');");
        d.exec("DELETE FROM tiers WHERE participant_id NOT IN (SELECT id FROM participants WHERE name_key='presenter');");
      }
    })();
    return json({ ok: true });
  });
}
