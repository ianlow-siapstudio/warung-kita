import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { body, fail, json, withAdmin } from "@/lib/http";
import { findByName, nameKey, PRESENTER } from "@/lib/participants";
import { activeRunId } from "@/lib/runs";

export async function POST(req: NextRequest) {
  const b = await body<{ action: "rename" | "merge"; id: number; name: string; intoId: number }>(req);
  return withAdmin(req, () => {
    const d = db();
    const src = d.prepare("SELECT id, name_key FROM participants WHERE id=?").get(Number(b.id)) as { id: number; name_key: string } | undefined;
    if (!src) return fail("Participant not found.", 404);
    if (src.name_key === PRESENTER) return fail("The presenter can't be renamed or merged.");

    if (b.action === "rename") {
      const name = String(b.name ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
      if (!name) return fail("Type a name.");
      const clash = findByName(name);
      if (clash && clash.id !== src.id) return fail("Someone already has that name — merge instead.");
      d.prepare("UPDATE participants SET name=?, name_key=? WHERE id=?").run(name, nameKey(name), src.id);
      return json({ ok: true });
    }

    if (b.action === "merge") {
      const into = Number(b.intoId);
      if (into === src.id || !d.prepare("SELECT 1 FROM participants WHERE id=?").get(into)) return fail("Pick someone else to merge into.");
      if (activeRunId(src.id) || activeRunId(into)) return fail("Wait for their runs to finish first.");
      d.transaction(() => {
        d.prepare("UPDATE conversations SET participant_id=? WHERE participant_id=?").run(into, src.id);
        d.prepare("UPDATE runs SET participant_id=? WHERE participant_id=?").run(into, src.id);
        // Keep the target's rules/config if they have any; otherwise take the source's.
        const intoHasConfig = d.prepare("SELECT 1 FROM config WHERE participant_id=?").get(into);
        if (!intoHasConfig) d.prepare("UPDATE config SET participant_id=? WHERE participant_id=?").run(into, src.id);
        const intoHasRules = d.prepare("SELECT 1 FROM rules WHERE participant_id=? LIMIT 1").get(into);
        if (!intoHasRules) {
          d.prepare("UPDATE rules SET participant_id=? WHERE participant_id=?").run(into, src.id);
          d.prepare("DELETE FROM tiers WHERE participant_id=?").run(into);
          d.prepare("UPDATE tiers SET participant_id=? WHERE participant_id=?").run(into, src.id);
        }
        d.prepare("UPDATE participants SET published_run_id=COALESCE(published_run_id, (SELECT published_run_id FROM participants WHERE id=?)) WHERE id=?").run(src.id, into);
        d.prepare("DELETE FROM participants WHERE id=?").run(src.id);
      })();
      return json({ ok: true });
    }
    return fail("Unknown action.");
  });
}
