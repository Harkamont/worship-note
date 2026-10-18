import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.CHANYANG_DESKTOP === "1" ? { output: "standalone" as const } : {}),
};

export default nextConfig;
