import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withAdmin } from "@/lib/http";

export const dynamic = "force-dynamic";

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("type") === "results" ? "results" : "messages";
  return withAdmin(req, () => {
    const rows = (type === "messages"
      ? db().prepare(
          `SELECT m.id, p.name, c.phase, c.id AS conversation, m.role, m.content, m.blocked_by, m.original_content, m.category AS reported_as, m.report_note, m.pinned, m.bot_model,
             datetime(m.created_at/1000,'unixepoch') AS created_utc
           FROM messages m JOIN conversations c ON c.id=m.conversation_id JOIN participants p ON p.id=c.participant_id ORDER BY m.id`
        ).all()
      : db().prepare(
          `SELECT r.id AS run, p.name, r.phase, r.bot_model, r.runs_per_test, r.cached, r.total, r.max, res.question_key, res.iteration,
             res.pass, res.failed_rules, res.reason, res.blocked_by, res.answer, res.original_answer, r.config_snapshot, r.rules_snapshot,
             datetime(res.created_at/1000,'unixepoch') AS created_utc
           FROM results res JOIN runs r ON r.id=res.run_id JOIN participants p ON p.id=r.participant_id ORDER BY res.id`
        ).all()) as Record<string, unknown>[];
    const cols = rows.length ? Object.keys(rows[0]) : ["empty"];
    const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="warung-kita-${type}-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  });
}
