import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const port = process.env.PORT ?? 8787;
const http = `http://127.0.0.1:${port}`;

// NOTE: keep exactly ONE `export default`. Vite's config bundler accepts a second one silently and the
// last wins, which dropped the proxy and plugins and made /ws hang. vite-config.test.ts guards this.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist/client", emptyOutDir: true },
  // Dev only: Vite serves the UI, Fastify serves /api, /ws and /fixtures. In production Fastify serves everything.
  server: {
    host: "0.0.0.0",
    port: 5173,
    // Quick-tunnel hostnames change on every run, and Vite rejects unknown Host headers by default.
    allowedHosts: [".trycloudflare.com"],
    proxy: {
      "/api": http,
      "/fixtures": http,
      "/ws": {
        target: `ws://127.0.0.1:${port}`,
        ws: true,
      },
    },
  },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
