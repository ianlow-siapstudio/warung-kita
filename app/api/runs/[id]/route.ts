import type { NextRequest } from "next/server";
import { isAdmin } from "@/lib/auth";
import { fail, json, withParticipant } from "@/lib/http";
import { runView } from "@/lib/runs";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const admin = isAdmin(req);
  return withParticipant(req, (p) => {
    const v = runView(Number(id));
    if (!v || (v.participant_id !== p.id && !admin)) return fail("Run not found.", 404);
    return json(v);
  });
}
