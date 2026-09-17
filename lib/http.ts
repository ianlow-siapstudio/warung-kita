import { NextResponse, type NextRequest } from "next/server";
import { isAdmin } from "./auth";
import { currentParticipant, touch, type Participant } from "./participants";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export async function body<T>(req: NextRequest): Promise<Partial<T>> {
  try {
    return (await req.json()) as Partial<T>;
  } catch {
    return {};
  }
}

/** Runs the handler with the signed-in participant, or answers 401. */
export function withParticipant(req: NextRequest, fn: (p: Participant) => Response | Promise<Response>) {
  const p = currentParticipant(req);
  if (!p) return fail("Tell us your name first.", 401);
  touch(p);
  return fn(p);
}

export function withAdmin(req: NextRequest, fn: () => Response | Promise<Response>) {
  if (!isAdmin(req)) return fail("Not signed in.", 401);
  return fn();
}
