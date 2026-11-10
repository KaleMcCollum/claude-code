import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page sits behind sign-in and shows live data, so pages are rendered
  // fresh on each request (the newer "cache components" mode is left off).
  poweredByHeader: false,
  devIndicators: false,
  // The embedded development database ships its own files; don't bundle it.
  serverExternalPackages: ["@electric-sql/pglite"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Sign-in links carry a one-time secret; never pass the address on.
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
