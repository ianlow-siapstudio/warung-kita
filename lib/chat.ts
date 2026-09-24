import { db, now } from "./db";
import type { Phase } from "./settings";

/** Activity 1 chats and Activity 2 draft chats are kept apart. */
export const chatPhase = (phase: Phase) => (phase === "activity1" ? "activity1" : "activity2");

export function latestConversation(pid: number, phase: string): number | null {
  const row = db().prepare("SELECT id FROM conversations WHERE participant_id=? AND phase=? ORDER BY id DESC LIMIT 1").get(pid, phase) as { id: number } | undefined;
  return row?.id ?? null;
}

export function newConversation(pid: number, phase: string): number {
  return Number(db().prepare("INSERT INTO conversations (participant_id, phase, created_at) VALUES (?,?,?)").run(pid, phase, now()).lastInsertRowid);
}

export function conversationMessages(conversationId: number) {
  return db().prepare("SELECT id, role, content, blocked_by, category, report_note, created_at FROM messages WHERE conversation_id=? ORDER BY id").all(conversationId) as {
    id: number; role: "user" | "assistant"; content: string; blocked_by: string | null; category: string | null; report_note: string | null; created_at: number;
  }[];
}
