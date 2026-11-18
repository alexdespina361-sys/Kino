import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * The owner's page (docs/stats.md, "The owner's page"): the three files of owner-stats/, served from an address of their own as GitHub Pages would
 * serve them, asking a site that was started with a key and with that address named. What a browser lets through (the page's own rules, and the rule
 * about another site's pages) cannot be seen in a unit test, so it is tried here.
 */

const PHONE = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/156.0 Mobile Safari/537.36";
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

const listen = (server: http.Server) => new Promise<number>((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));

/** The folder of the page at an address of its own. */
async function pageServer(): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = http.createServer((request, response) => {
    const name = (request.url ?? "/").split("?")[0] === "/" ? "index.html" : path.basename((request.url ?? "").split("?")[0]!);
    readFile(path.join("owner-stats", name)).then(
      (body) => response.writeHead(200, { "content-type": TYPES[path.extname(name)] ?? "application/octet-stream" }).end(body),
      () => response.writeHead(404).end(),
    );
  });
  const port = await listen(server);
  return { origin: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

class Site {
  log = "";
  private child: ChildProcess | undefined;
  private port = 0;
  get origin(): string {
    return `http://127.0.0.1:${this.port}`;
  }
  async start(env: Record<string, string>): Promise<void> {
    const probe = http.createServer();
    this.port = await listen(probe);
    await new Promise((resolve) => probe.close(resolve));
    this.child = spawn(process.execPath, ["--import", "tsx", "src/server/index.ts"], {
      env: { ...process.env, PORT: String(this.port), HOST: "127.0.0.1", LIBRARY: "off", DATA_DIR: "memory", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child.stdout!.on("data", (chunk) => (this.log += String(chunk)));
    this.child.stderr!.on("data", (chunk) => (this.log += String(chunk)));
    const until = Date.now() + 60_000;
    for (;;) {
      // (a program asks: it is not one of the people who are here)
      const up = await fetch(`${this.origin}/api/health`, { headers: { "user-agent": "node" } }).then(
        (answer) => answer.ok,
        () => false,
      );
      if (up) return;
      if (Date.now() > until || this.child.exitCode !== null) throw new Error(`The site did not start:\n${this.log}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  async stop(): Promise<void> {
    if (!this.child || this.child.exitCode !== null) return;
    const exited = once(this.child, "exit");
    this.child.kill();
    await exited;
  }
}

test.describe("the owner's page", () => {
  test("shows the site's counts to whoever has the key, from the page that is named and from no other; keeps the key on the device until told to forget it", async ({ browser }) => {
    test.setTimeout(120_000);
    const key = randomBytes(24).toString("base64url"); // (made here, for this server only)
    const named = await pageServer();
    const other = await pageServer();
    const site = new Site();
    await site.start({ OWNER_STATS_TOKEN: key, OWNER_STATS_ORIGIN: named.origin });
    try {
      // Somebody opens the site (not signed in): one person here, one answer.
      await fetch(`${site.origin}/api/health`, { headers: { "user-agent": PHONE } });

      const context = await browser.newContext();
      const page = await context.newPage();
      const wrong: string[] = [];
      page.on("console", (message) => message.type() === "error" && wrong.push(message.text()));
      page.on("pageerror", (error) => wrong.push(String(error)));
      await page.goto(named.origin);
      await expect(page.locator("#board")).toBeHidden();

      // A key the site does not know.
      await page.locator("#site").fill(site.origin);
      await page.locator("#key").fill("x".repeat(30));
      await page.getByRole("button", { name: "Show the numbers" }).click();
      await expect(page.locator("#wrong")).toHaveText("The site does not know this key.");
      await expect(page.locator("#board")).toBeHidden();
      wrong.length = 0; // (the browser writes the 401 down as an error of the page: it is the answer that was expected)

      // The key.
      await page.locator("#key").fill(key);
      await page.getByRole("button", { name: "Show the numbers" }).click();
      await expect(page.locator("#board")).toBeVisible();
      await expect(page.locator("#door")).toBeHidden();
      await expect(page.locator("#now-people")).toHaveText("1");
      await expect(page.locator("#now-who")).toContainText("0 signed in · 1 guests");
      await expect(page.locator("#now-screens")).toHaveText("0 screens and 0 phones connected");
      await expect(page.locator("#acc-total")).toHaveText("0");
      await expect(page.locator("#min-today")).toHaveText("0 min");
      await expect(page.locator("#fb-open")).toHaveText("0");
      await expect(page.locator("#reports")).toHaveText("No reports.");
      await expect(page.locator("#bars .bar")).toHaveCount(24);
      await expect(page.locator("#days tr")).toHaveCount(30);
      await expect(page.locator("#alerts")).toBeHidden();
      await expect(page.locator("#state")).toContainText("asked again every 30 seconds");
      await expect(page.locator("#key")).toHaveValue(""); // (not left in the box)
      expect(wrong).toEqual([]); // (nothing the page's own rules refused, nothing that failed)

      // It is kept in this browser: the page opened again shows the numbers without asking.
      await page.reload();
      await expect(page.locator("#board")).toBeVisible();
      await expect(page.locator("#now-people")).toHaveText("1"); // (the page's own questions are nobody's visit)

      // A page with the same files at another address, with the key: the browser does not give it the answer.
      const stranger = await context.newPage();
      await stranger.goto(other.origin);
      await stranger.locator("#site").fill(site.origin);
      await stranger.locator("#key").fill(key);
      await stranger.getByRole("button", { name: "Show the numbers" }).click();
      await expect(stranger.locator("#wrong")).toContainText("could not be reached from this page");
      await expect(stranger.locator("#board")).toBeHidden();
      await stranger.close();

      // Forgetting it.
      await page.getByRole("button", { name: "Forget the key on this device" }).click();
      await expect(page.locator("#door")).toBeVisible();
      await expect(page.locator("#board")).toBeHidden();
      expect(await page.evaluate(() => localStorage.length)).toBe(0);
      await page.reload();
      await expect(page.locator("#door")).toBeVisible();

      // The server said the page is on, and to whom; it never wrote the key.
      expect(site.log).toContain("The owner's page can read its counts");
      expect(site.log).not.toContain(key);
      await context.close();
    } finally {
      await site.stop();
      await named.close();
      await other.close();
    }
  });

  test("a site that has no key has no such page to read", async ({ browser }) => {
    const named = await pageServer();
    const site = new Site();
    await site.start({ OWNER_STATS_ORIGIN: named.origin });
    try {
      expect((await fetch(`${site.origin}/api/owner/stats`, { headers: { authorization: `Bearer ${"k".repeat(30)}` } })).status).toBe(404);
      expect(site.log).toContain("The owner's page is off.");
      const page = await browser.newPage();
      await page.goto(named.origin);
      await page.locator("#site").fill(site.origin);
      await page.locator("#key").fill("k".repeat(30));
      await page.getByRole("button", { name: "Show the numbers" }).click();
      // (No key on the server: the browser is told of no page that may read, so all the page can say is that it could not be reached.)
      await expect(page.locator("#wrong")).not.toHaveText("");
      await expect(page.locator("#wrong")).not.toHaveText("Asking…");
      await expect(page.locator("#board")).toBeHidden();
      await page.close();
    } finally {
      await site.stop();
      await named.close();
    }
  });
});
