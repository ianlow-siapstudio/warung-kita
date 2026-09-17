import type { NextRequest } from "next/server";
import QRCode from "qrcode";
import { withAdmin } from "@/lib/http";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return withAdmin(req, async () => {
    const url = process.env.PUBLIC_URL || "https://demo.siapstudio.my/warung-kita";
    const svg = await QRCode.toString(url, { type: "svg", margin: 1, width: 512 });
    return new Response(svg, { headers: { "content-type": "image/svg+xml" } });
  });
}
