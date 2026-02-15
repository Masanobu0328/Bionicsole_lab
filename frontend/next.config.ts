import type { NextConfig } from "next";

const backendTarget = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8001/api/v1";
const normalizedBackendTarget = backendTarget.endsWith("/")
  ? backendTarget.slice(0, -1)
  : backendTarget;

const nextConfig: NextConfig = {
  async rewrites() {
    if (normalizedBackendTarget.startsWith("http")) {
      return [
        {
          source: "/api/v1/:path*",
          destination: `${normalizedBackendTarget}/:path*`,
        },
      ];
    }
    return [];
  },
};

export default nextConfig;
