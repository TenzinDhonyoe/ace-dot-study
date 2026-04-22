import { defineConfig } from "astro/config";
import vercel from "@astrojs/vercel";

// Vercel adapter with Fluid Compute + Node runtime.
//
// Function budget: 800s. Vercel Pro with Fluid Compute supports up to
// 800s on Node. Long-tail generations (10+ PDFs, dense problem sets)
// routinely exceed the default 300s. Hobby tier is capped much lower —
// if deploy fails with a maxDuration error, you're on Hobby and need
// to upgrade (or drop this back to whatever your tier allows).
//
// Don't switch to Edge runtime without revisiting — Edge caps at 25s
// and makes any of this moot.
export default defineConfig({
  output: "server",
  adapter: vercel({
    maxDuration: 800,
    webAnalytics: { enabled: false },
  }),
  server: {
    host: true,
  },
});
