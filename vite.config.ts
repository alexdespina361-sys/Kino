import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const port = process.env.PORT ?? 8787;
const http = `http://127.0.0.1:${port}`;

// NOTE: keep exactly ONE `export default`. Vite's config bundler accepts a second one silently and the
// last wins, which dropped the proxy and plugins and made /ws hang. vite-config.test.ts guards this.
export default defineConfig({
  plugins: [react()],
  // The oldest browser of a TV we know of is Chromium 94 (Hisense VIDAA 6, Samsung Tizen 7, from 2021): the build is made for it, so a newer way of
  // writing something is turned into one it reads (e2e/old-tv.spec.ts opens the site in it). The others are Vite's own defaults.
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    target: ["chrome94", "edge107", "firefox104", "safari16"],
    // Two pages: the app, and the upscaler test of Kino Labs (labs/upscale/, a page of its own: it uses no code of the app, only the bundler's loading helper).
    rolldownOptions: {
      input: {
        index: fileURLToPath(new URL("index.html", import.meta.url)),
        upscale: fileURLToPath(new URL("labs/upscale/index.html", import.meta.url)),
      },
      // React and zod, which every page needs and which change only when a dependency is updated, in a file of their own: its name (a hash of what is in
      // it) stays the same from one deploy to the next, so a TV that has it keeps it, already compiled, instead of downloading ~300 KB again with the app.
      output: {
        codeSplitting: {
          groups: [{ name: "vendor", test: /[\\/]node_modules[\\/](react|react-dom|scheduler|zod)[\\/]/ }],
        },
      },
    },
  },
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
