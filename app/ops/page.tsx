import { cookies } from "next/headers";
import { ADMIN_COOKIE, isAdminToken } from "@/lib/auth";
import { OpsConsole } from "../components/OpsConsole";
import { OpsLogin } from "../components/OpsLogin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Warung Kita · ops" };

export default async function OpsPage() {
  const jar = await cookies();
  if (!isAdminToken(jar.get(ADMIN_COOKIE)?.value)) return <OpsLogin />;
  return <OpsConsole />;
}
