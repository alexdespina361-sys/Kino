import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const port = process.env.PORT ?? 8787;
const http = `http://127.0.0.1:${port}`;

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    target: ["chrome94", "edge107", "firefox104", "safari16"],
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: "vendor", test: /[\\/]node_modules[\\/](react|react-dom|scheduler|zod)[\\/]/ }],
        },
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
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
