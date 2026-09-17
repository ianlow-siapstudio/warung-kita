import type { NextRequest } from "next/server";
import { chatPhase, newConversation } from "@/lib/chat";
import { json, withParticipant } from "@/lib/http";
import { getPhase } from "@/lib/settings";

export function POST(req: NextRequest) {
  return withParticipant(req, (p) => json({ conversationId: newConversation(p.id, chatPhase(getPhase())), messages: [] }));
}
