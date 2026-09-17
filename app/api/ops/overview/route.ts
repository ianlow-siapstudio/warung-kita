import type { NextRequest } from "next/server";
import { json, withAdmin } from "@/lib/http";
import { overview } from "@/lib/stats";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return withAdmin(req, () => json(overview()));
}
