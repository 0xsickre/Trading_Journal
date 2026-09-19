import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    /**
     * How long the browser keeps a page it has already rendered. Every page
     * here is dynamic (it reads the session cookie), and Next's default keeps a
     * dynamic page for 0 s, so going back to a page opened a moment ago
     * re-rendered it on the server from scratch. 30 s makes switching between
     * pages instant; `static` also covers a page prefetched in full on hover
     * (`unstable_dynamicOnHover` in the sidebar).
     *
     * An edit is never shown stale: a server action that revalidates clears
     * this cache.
     */
    staleTimes: {
      dynamic: 30,
      static: 60,
    },
  },
};

export default nextConfig;
