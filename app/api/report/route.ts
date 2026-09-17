import type { NextRequest } from "next/server";
import { FIND_TYPES, isFindType } from "@/config/finds";
import { db, now } from "@/lib/db";
import { body, fail, json, withParticipant } from "@/lib/http";
import { findsLeaderboard } from "@/lib/stats";

export const dynamic = "force-dynamic";

/** My finds (history) plus the room's leaderboard. */
export function GET(req: NextRequest) {
  return withParticipant(req, (p) => {
    const mine = db().prepare(
      `SELECT m.id, m.content AS reply, m.category, m.report_note AS note, m.reported_at,
         (SELECT u.content FROM messages u WHERE u.conversation_id=m.conversation_id AND u.role='user' AND u.id<m.id ORDER BY u.id DESC LIMIT 1) AS question
       FROM messages m JOIN conversations c ON c.id=m.conversation_id
       WHERE c.participant_id=? AND c.phase='activity1' AND m.role='assistant' AND m.category IS NOT NULL AND m.category<>'fine'
       ORDER BY m.reported_at DESC`
    ).all(p.id);
    const board = findsLeaderboard();
    return json({ types: FIND_TYPES, mine, leaderboard: board.slice(0, 10), me: board.find((r) => r.id === p.id) ?? null, people: board.length });
  });
}

/** Report (or un-report) one of the bot's replies in your own Activity 1 chat. */
export async function POST(req: NextRequest) {
  const b = await body<{ messageId: number; category: string | null; note: string }>(req);
  return withParticipant(req, (p) => {
    const msg = db().prepare(
      `SELECT m.id FROM messages m JOIN conversations c ON c.id=m.conversation_id
       WHERE m.id=? AND m.role='assistant' AND c.participant_id=? AND c.phase='activity1'`
    ).get(Number(b.messageId), p.id);
    if (!msg) return fail("You can only report the bot's replies in your own chat.", 404);
    if (b.category === null || b.category === "") {
      db().prepare("UPDATE messages SET category=NULL, report_note=NULL, reported_at=NULL WHERE id=?").run(Number(b.messageId));
      return json({ ok: true });
    }
    if (!isFindType(b.category)) return fail("Pick what the bot did.");
    const note = String(b.note ?? "").trim().slice(0, 200) || null;
    db().prepare("UPDATE messages SET category=?, report_note=?, reported_at=? WHERE id=?").run(b.category, note, now(), Number(b.messageId));
    return json({ ok: true });
  });
}
