import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: "/warung-kita",
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  poweredByHeader: false,
};

export default nextConfig;
