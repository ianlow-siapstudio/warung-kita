import type { NextRequest } from "next/server";
import { copy } from "@/config/copy";
import { respond } from "@/lib/bot";
import { chatPhase, conversationMessages, latestConversation, newConversation } from "@/lib/chat";
import { db, now } from "@/lib/db";
import { body, fail, json, withParticipant } from "@/lib/http";
import { LlmError } from "@/lib/llm";
import { getConfig, naiveConfig } from "@/lib/participants";
import { getBotModel, getPhase } from "@/lib/settings";

export const dynamic = "force-dynamic";

const open = (phase: string) => ["activity1", "activity2"].includes(phase);

export function GET(req: NextRequest) {
  return withParticipant(req, (p) => {
    const phase = getPhase();
    const id = latestConversation(p.id, chatPhase(phase));
    return json({ conversationId: id, messages: id ? conversationMessages(id) : [] });
  });
}

export async function POST(req: NextRequest) {
  const b = await body<{ text: string; conversationId: number }>(req);
  return withParticipant(req, async (p) => {
    const phase = getPhase();
    if (!open(phase)) return fail("The chat is closed right now.", 403);
    const text = String(b.text ?? "").trim().slice(0, 1000);
    if (!text) return fail("Type a message first.");

    const cPhase = chatPhase(phase);
    let convId: number = Number(b.conversationId) || latestConversation(p.id, cPhase) || 0;
    const owned = convId > 0 && db().prepare("SELECT 1 FROM conversations WHERE id=? AND participant_id=? AND phase=?").get(convId, p.id, cPhase);
    if (!owned) convId = newConversation(p.id, cPhase);

    // Activity 1 forces the naive prompt with every check off — personal settings ignored.
    const config = phase === "activity1" ? naiveConfig() : getConfig(p.id);
    const botModel = getBotModel();
    const history = conversationMessages(convId).map((m) => ({ role: m.role, content: m.content }));
    history.push({ role: "user", content: text });

    let reply;
    try {
      reply = await respond(config, history, botModel, `p${p.id}`);
    } catch (err) {
      if (!(err instanceof LlmError)) console.error(err);
      return fail(copy.aiTimeout, 503);
    }

    const d = db();
    const t = now();
    d.prepare("INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?,?,?,?)").run(convId, "user", text, t);
    const botId = Number(
      d.prepare("INSERT INTO messages (conversation_id, role, content, blocked_by, original_content, bot_model, created_at) VALUES (?,?,?,?,?,?,?)")
        .run(convId, "assistant", reply.text, reply.blockedBy, reply.original, botModel, t + 1).lastInsertRowid
    );

    return json({ conversationId: convId, messages: conversationMessages(convId) });
  });
}
