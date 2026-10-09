import { defineConfig, devices } from "@playwright/test";

const PORT = 8788; // not the dev port, so `pnpm dev` and e2e can run side by side

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // The real thing: production build, one Fastify process serving UI + /ws + local fixtures.
  webServer: {
    command: "pnpm build && pnpm start",
    url: `http://127.0.0.1:${PORT}/api/health`,
    // ALLOW_PRIVATE_NETWORK lets the resolver fetch our own localhost fixture pages. Test-only; off by default.
    env: { PORT: String(PORT), HOST: "127.0.0.1", ALLOW_PRIVATE_NETWORK: "1" },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
