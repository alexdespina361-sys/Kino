import { defineConfig, devices } from "@playwright/test";
import { FEEDBACK_TOKEN } from "./e2e/feedbackToken";

const PORT = Number(process.env.E2E_PORT) || 8788; // not the dev port, so `pnpm dev` and e2e can run side by side

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    // Every page starts as if its viewer had left full screen on an earlier visit (see src/client/shared/fullscreen.ts): a screen would
    // otherwise go full screen at the first key press of any test. The tests of full screen itself start from FIRST_VISIT (e2e/helpers.ts).
    // And as if the phone's menu had turned on the box for pasting a link (off on a new phone, see Controller.tsx), which most tests play from.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: `http://127.0.0.1:${PORT}`,
          localStorage: [
            { name: "kino.fullscreen.left", value: "1" },
            { name: "kino.linkbox", value: "1" },
          ],
        },
      ],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // The real thing: production build, one Fastify process serving UI + /ws + local fixtures.
  webServer: {
    command: "pnpm build && pnpm start",
    url: `http://127.0.0.1:${PORT}/api/health`,
    // ALLOW_PRIVATE_NETWORK lets the resolver fetch our own localhost fixture pages. Test-only; off by default.
    // DATA_DIR=memory: accounts made by the tests are not kept (and do not end up in a data folder).
    // SIGNUPS_PER_HOUR: every test is the same address, and the limit (10 an hour) is for a public server, not for a suite that makes an account in each of its account tests.
    // FEEDBACK_ADMIN_TOKEN and FEEDBACK_SENDS_PER_10_MIN: the same for the feedback (6 reports in ten minutes), and the feedback specs read what was sent with the token.
    env: { PORT: String(PORT), HOST: "127.0.0.1", ALLOW_PRIVATE_NETWORK: "1", LIBRARY: "off", DATA_DIR: "memory", SIGNUPS_PER_HOUR: "1000", FEEDBACK_ADMIN_TOKEN: FEEDBACK_TOKEN, FEEDBACK_SENDS_PER_10_MIN: "1000" },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
