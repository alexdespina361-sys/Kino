import { chromium, expect, type BrowserContext, type CDPSession, type Page, type Worker } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openTv, readPairingCode, test, withLibrary } from "./helpers";

declare const chrome: { tabs: { query(query: object): Promise<{ id?: number; url?: string }[]>; goBack(tabId: number): Promise<void> } };

test.use({ trace: "off", video: "off", screenshot: "off" });
test.describe.configure({ timeout: 120_000 });

const EXTENSION = fileURLToPath(new URL("./fixtures/back-extension", import.meta.url));
const films = Array.from({ length: 4 }, (_, i) => ({ id: `f${i}`, title: `Film number ${i + 1}`, year: 1990 + i, kind: "movie", url: `/fixtures/sample.mp4?n=${i}` }));
const withFilms = withLibrary({ updatedAt: Date.now(), rows: [{ id: "r1", title: "Classics", source: "Test Source", kind: "movie", items: films }] });

class Phone {
  constructor(
    readonly ctx: BrowserContext,
    readonly page: Page,
    readonly cdp: CDPSession,
    readonly sw: Worker,
    readonly site: string,
    private readonly dir: string,
  ) {}

  static async open(site: string): Promise<Phone> {
    const dir = mkdtempSync(path.join(tmpdir(), "kino-back-"));
    const ctx = await chromium.launchPersistentContext(dir, {
      channel: "chromium",
      headless: true,
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
      viewport: { width: 392, height: 739 },
      screen: { width: 393, height: 873 },
      deviceScaleFactor: 2.75,
      isMobile: true,
      hasTouch: true,
      userAgent: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36",
    });
    const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
    await withFilms(ctx);
    const page = await ctx.newPage();
    return new Phone(ctx, page, await ctx.newCDPSession(page), sw, site, dir);
  }

  async close(): Promise<void> {
    await this.ctx.close().catch(() => undefined);
    try {
      rmSync(this.dir, { recursive: true, force: true });
    } catch {
    }
  }

  async ev<T>(expression: string): Promise<T> {
    const { result, exceptionDetails } = await this.cdp.send("Runtime.evaluate", { expression, returnByValue: true, userGesture: false });
    if (exceptionDetails) throw new Error(exceptionDetails.text);
    return result.value as T;
  }

  has = (testId: string) => this.ev<boolean>(`document.querySelector('[data-testid="${testId}"]') !== null`);

  async waitFor(testId: string, present = true): Promise<void> {
    await expect.poll(() => this.has(testId), { message: testId, timeout: 10_000 }).toBe(present);
  }

  private async center(testId: string): Promise<{ x: number; y: number }> {
    const { root } = await this.cdp.send("DOM.getDocument", { depth: 0 });
    const { nodeId } = await this.cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: `[data-testid="${testId}"]` });
    await this.cdp.send("DOM.scrollIntoViewIfNeeded", { nodeId }).catch(() => undefined);
    const { model } = await this.cdp.send("DOM.getBoxModel", { nodeId });
    const q = model.border;
    return { x: (q[0]! + q[4]!) / 2, y: (q[1]! + q[5]!) / 2 };
  }

  async tap(testId: string): Promise<void> {
    await this.waitFor(testId);
    await this.page.waitForTimeout(700);
    const { x, y } = await this.center(testId);
    await this.page.touchscreen.tap(x, y);
    await this.page.waitForTimeout(500);
  }

  async back(): Promise<void> {
    await this.sw.evaluate(async (origin) => {
      const tab = (await chrome.tabs.query({})).find((t) => (t.url ?? "").startsWith(origin));
      if (tab?.id !== undefined) await chrome.tabs.goBack(tab.id).catch(() => undefined);
    }, new URL(this.site).origin);
    await this.page.waitForTimeout(700);
  }

  stays = () => new URL(this.page.url()).origin === new URL(this.site).origin && !this.page.url().endsWith("/api/health");

  async look() {
    return this.ev<{ view: string; detail: boolean; hint: boolean; state: string; tab: string }>(`({
      view: document.querySelector('[data-testid="tv-browse"]')?.getAttribute("data-view") ?? "",
      detail: document.querySelector('[data-testid="tv-detail"]') !== null,
      hint: document.querySelector('[data-testid="exit-hint"]') !== null,
      state: document.querySelector('[data-testid="tv"]')?.getAttribute("data-state") ?? "",
      tab: document.querySelector('.tab[aria-current="page"]')?.getAttribute("data-testid") ?? "",
    })`);
  }
}

async function library(baseURL: string): Promise<Phone> {
  const phone = await Phone.open(baseURL);
  await phone.page.goto(`${baseURL}/api/health`);
  await phone.page.goto(`${baseURL}/tv`);
  await phone.waitFor("tv-browse");
  await phone.waitFor("tv-welcome", false);
  await phone.page.waitForTimeout(1_000);
  return phone;
}

test.describe("Chrome's own Back on a phone", () => {
  test("the account's pages and a sheet go back one at a time, and the site is left only after the question", async ({ baseURL }) => {
    const phone = await library(baseURL!);
    try {
      await phone.tap("tv-account-chip");
      expect((await phone.look()).view).toBe("profile");
      await phone.tap("tv-profile-feedback");
      await phone.waitFor("feedback");

      await phone.back();
      await phone.waitFor("feedback", false);
      expect((await phone.look()).view).toBe("profile");
      await phone.back();
      expect((await phone.look()).view).toBe("home");
      expect((await phone.look()).hint).toBe(false);
      await phone.back();
      expect(phone.stays()).toBe(true);
      expect((await phone.look()).hint).toBe(true);

      await phone.waitFor("exit-hint", false);
      await phone.back();
      expect(phone.stays()).toBe(true);
      expect((await phone.look()).hint).toBe(true);
      await phone.back();
      await expect.poll(() => phone.stays()).toBe(false);
    } finally {
      await phone.close();
    }
  });

  test("the library's pages go back one at a time, one that only steps back to the one before it as well", async ({ baseURL }) => {
    const phone = await library(baseURL!);
    try {
      await phone.tap("rail-categories");
      expect((await phone.look()).view).toMatch(/^categories/);
      await phone.tap("tv-category-tile");
      expect((await phone.look()).view).toMatch(/^category:/);
      await phone.tap("tv-browse-tile");
      expect((await phone.look()).detail).toBe(true);

      await phone.back();
      expect(await phone.look()).toMatchObject({ detail: false, view: expect.stringMatching(/^category:/) });
      await phone.back();
      expect((await phone.look()).view).toMatch(/^categories/);
      await phone.back();
      expect((await phone.look()).view).toBe("home");
      await phone.back();
      expect(phone.stays()).toBe(true);
      expect((await phone.look()).hint).toBe(true);
      await phone.back();
      await expect.poll(() => phone.stays()).toBe(false);
    } finally {
      await phone.close();
    }
  });

  test("a film chosen on a title's page: Back leaves the film for the library, and the page's own step down the history is not taken for one", async ({ baseURL }) => {
    const phone = await library(baseURL!);
    try {
      await phone.tap("tv-browse-tile");
      expect((await phone.look()).detail).toBe(true);
      await phone.tap("tv-detail-play");
      await expect.poll(async () => (await phone.look()).state, { timeout: 15_000 }).toBe("playing");
      await phone.page.waitForTimeout(1_500);
      expect((await phone.look()).state).toBe("playing");

      await phone.back();
      await expect.poll(async () => (await phone.look()).state).toBe("idle");
      expect((await phone.look()).view).toBe("home");
      expect(phone.stays()).toBe(true);
      await phone.back();
      expect(phone.stays()).toBe(true);
      expect((await phone.look()).hint).toBe(true);
      await phone.back();
      await expect.poll(() => phone.stays()).toBe(false);
    } finally {
      await phone.close();
    }
  });

  test("the remote: Back goes from a tab to Home, and then asks before it leaves the site", async ({ baseURL, browser }) => {
    const tv = await openTv(browser);
    const code = await readPairingCode(tv);
    const phone = await Phone.open(baseURL!);
    try {
      await phone.page.goto(`${baseURL}/api/health`);
      await phone.page.goto(`${baseURL}/?code=${code}`);
      await phone.waitFor("tv-online");
      await phone.tap("tab-search");
      expect((await phone.look()).tab).toBe("tab-search");
      await phone.tap("tab-you");
      expect((await phone.look()).tab).toBe("tab-you");

      await phone.back();
      expect((await phone.look()).tab).toBe("tab-home");
      expect(phone.stays()).toBe(true);
      await phone.back();
      expect(phone.stays()).toBe(true);
      expect((await phone.look()).hint).toBe(true);
      await phone.back();
      await expect.poll(() => phone.stays()).toBe(false);
    } finally {
      await phone.close();
    }
  });
});
