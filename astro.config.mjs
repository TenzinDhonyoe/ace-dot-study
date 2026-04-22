import { defineConfig } from "astro/config";
import vercel from "@astrojs/vercel";

// Vercel adapter with Fluid Compute + Node runtime. The generation endpoint
// needs up to ~180s wall time (p99 for a 3-PDF Claude generation); Edge
// runtime caps at 25s, Node Serverless on Pro with Fluid Compute reaches
// 300s. Don't switch to Edge without revisiting this number.
export default defineConfig({
  output: "server",
  adapter: vercel({
    maxDuration: 300,
    webAnalytics: { enabled: false },
  }),
  server: {
    host: true,
  },
});
