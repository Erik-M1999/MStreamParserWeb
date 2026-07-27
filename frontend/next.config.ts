import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Single-app deploy: emit a fully static SPA (HTML/CSS/JS
  // in `out/`) that Express serves alongside the API — no Node runtime for the
  // frontend on the server. All per-user data is fetched client-side against
  // /api, so there are no request-time server features to lose.
  output: "export",

  // We open the app via the loopback IP (127.0.0.1) because Spotify's OAuth
  // redirect requires it. By default Next's dev server only trusts "localhost"
  // and blocks its own dev resources (HMR, chunks) from other hosts — which
  // breaks client-side hydration. Allow both spellings in development.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
