import { cookies } from "next/headers";
import { ADMIN_COOKIE, isAdminToken } from "@/lib/auth";
import { Board } from "../../components/Board";
import { OpsLogin } from "../../components/OpsLogin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Warung Kita · board" };

export default async function BoardPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const jar = await cookies();
  if (!isAdminToken(jar.get(ADMIN_COOKIE)?.value)) return <OpsLogin />;
  const { view } = await searchParams;
  return <Board view={view === "scores" ? "scores" : view === "finds" ? "finds" : "harvest"} />;
}
