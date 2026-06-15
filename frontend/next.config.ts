import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // We open the app via the loopback IP (127.0.0.1) because Spotify's OAuth
  // redirect requires it. By default Next's dev server only trusts "localhost"
  // and blocks its own dev resources (HMR, chunks) from other hosts — which
  // breaks client-side hydration. Allow both spellings in development.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
