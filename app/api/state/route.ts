import type { NextRequest } from "next/server";
import { json } from "@/lib/http";
import { currentParticipant, touch } from "@/lib/participants";
import { getPhase } from "@/lib/settings";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const p = currentParticipant(req);
  if (p) touch(p);
  return json({ phase: getPhase(), me: p ? { name: p.name, presenter: p.name_key === "presenter" } : null });
}
