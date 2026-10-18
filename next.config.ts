import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No "X-Powered-By: Next.js" advertising what to attack.
  poweredByHeader: false,
};

export default nextConfig;
