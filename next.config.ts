import type { NextConfig } from "next";

/*
 * Static export: the board is a client-side 3D scene, so there is nothing to
 * render on the server. `/api/*` is owned by the Hono Worker in src/worker,
 * which also serves this export through the ASSETS binding in production.
 * In `next dev` the rewrite forwards API calls to `wrangler dev` on 8787.
 */
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  rewrites: async () => [
    { source: "/api/:path*", destination: "http://127.0.0.1:8787/api/:path*" },
  ],
};

export default nextConfig;
