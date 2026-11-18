import { defineConfig, devices } from "@playwright/test";
import { FEEDBACK_TOKEN } from "./e2e/feedbackToken";

const PORT = Number(process.env.E2E_PORT) || 8788;
const SETUP_PORT = PORT + 50;
const ENV = { HOST: "127.0.0.1", ALLOW_PRIVATE_NETWORK: "1", LIBRARY: "off", ANIME_SKIP: "off", DATA_DIR: "memory", SIGNUPS_PER_HOUR: "1000", SLOW_CHECKS_PER_15_MIN: "100000", PAIRINGS_PER_HOUR: "100000", FEEDBACK_ADMIN_TOKEN: FEEDBACK_TOKEN, FEEDBACK_SENDS_PER_10_MIN: "1000", PERSONAL_STICKERS: "on", MOVING_STICKERS: "on" };

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    storageState: {
      cookies: [],
      origins: [
        {
          origin: `http://127.0.0.1:${PORT}`,
          localStorage: [
            { name: "kino.fullscreen.left", value: "1" },
            { name: "kino.linkbox", value: "1" },
            { name: "kino.fit", value: "couch" },
          ],
        },
      ],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
   {
    command: process.env.E2E_NO_BUILD ? "pnpm start" : "pnpm build && pnpm start",
    url: `http://127.0.0.1:${PORT}/api/health`,
    env: { ...ENV, PORT: String(PORT), PROFILE_SETUP: "off" },
    reuseExistingServer: false,
    timeout: 120_000,
   },
   {
    command: "pnpm start",
    url: `http://127.0.0.1:${SETUP_PORT}/api/health`,
    env: { ...ENV, PORT: String(SETUP_PORT) },
    reuseExistingServer: false,
    timeout: 120_000,
   },
  ],
});
