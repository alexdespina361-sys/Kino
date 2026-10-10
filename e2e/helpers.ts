import { chromium, expect, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { parseServerMessage, type Command, type NormalizedMedia, type PlayerState, type ServerMessage } from "../src/shared";

/** A phone: a narrow touch screen, which is how the page tells a remote from a TV. */
export const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true } as const;

/**
 * A browser that starts a video only for a press made in the last few seconds, which is what a phone's does (and what some of them
 * do for every video): one that a command from another device starts, with nobody having just pressed anything here, stays stopped.
 * It is not the browser the tests run in, so the caller closes it.
 */
export const strictBrowser = () => chromium.launch({ args: ["--autoplay-policy=user-gesture-required"] });
/**
 * Longer than the few seconds a press stays good for (see strictBrowser). Playwright counts what it asks of a page as presses, so a page
 * that is to stay unpressed is left alone: for this long to let it start the video, and for PRESS_EXPIRES_MS to let a press run out.
 */
export const PRESS_EXPIRES_MS = 5500;
export const PAGE_LEFT_ALONE_MS = 2000;

/**
 * What a screen has kept about its guest (nobody signed in): the same place the page itself writes, for a test that needs the
 * screen to have watched or chosen something before it opens.
 */
export function guestStorage(data: { progress?: unknown[]; watched?: unknown[]; list?: unknown[]; settings?: unknown[] }): Record<string, string> {
  return { "kino.data.guest": JSON.stringify({ v: 1, data: { progress: [], watched: [], list: [], settings: [], ...data }, rev: 0, dirty: [] }) };
}

/**
 * A new device (its own storage) whose localStorage already holds `seed`, unless the page has written there since.
 * `setup` runs on the new context before any page opens, for what the page asks for as it loads (the library).
 */
export async function openDevice(
  browser: Browser,
  options: Parameters<Browser["newContext"]>[0],
  seed: Record<string, string> = {},
  setup?: (context: BrowserContext) => Promise<unknown>,
): Promise<Page> {
  const context = await browser.newContext(options);
  if (Object.keys(seed).length > 0) {
    await context.addInitScript((entries) => {
      for (const [key, value] of Object.entries(entries)) if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
    }, seed);
  }
  await setup?.(context);
  return context.newPage();
}

/** Answer the library's requests with `library` (and the search with `search`): the server the tests run against has no library of its own. */
export const withLibrary =
  (library: unknown, search?: (query: string) => unknown) =>
  async (context: BrowserContext): Promise<void> => {
    await context.route("**/api/library", (route) => route.fulfill({ json: library }));
    await context.route(/\/api\/library\/search/, (route) => route.fulfill({ json: { items: search?.(new URL(route.request().url()).searchParams.get("q") ?? "") ?? [] } }));
  };

/** Open /tv in its own browser context (its own storage, like a separate device): it opens on the library, with nothing to press first. */
export async function openLibrary(
  browser: Browser,
  setup?: (context: BrowserContext) => Promise<unknown>,
  viewport = { width: 1280, height: 720 },
  seed: Record<string, string> = {},
): Promise<Page> {
  const page = await openDevice(browser, { viewport }, seed, setup);
  await page.goto("/tv");
  await expect(page.getByTestId("tv-browse")).toBeVisible(); // (the screen is a chunk of its own, so it is not there the moment the page has loaded)
  return page;
}

/** The same, and on to "Connect a phone" in the library's menu, where the code to type on the phone is. */
export async function openTv(browser: Browser, viewport = { width: 1280, height: 720 }, seed: Record<string, string> = {}): Promise<Page> {
  const page = await openLibrary(browser, undefined, viewport, seed);
  await page.getByTestId("rail-connect").click();
  return page;
}

/**
 * A click as a hand makes it: the button is held down for a moment before it is let go. Playwright's own click lets go within a few
 * milliseconds, so anything that a press sets moving (the rows, the banner) has not moved yet when the button comes up; a hand's has.
 */
export async function clickAsAHand(page: Page, target: Locator): Promise<void> {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.up();
}

/** The first title of a library, played with OK: its own page opens, and OK on Play starts it. */
export async function playFirst(tv: Page): Promise<void> {
  await expect(tv.getByTestId("tv-browse-tile").first()).toBeFocused();
  await tv.keyboard.press("Enter");
  await expect(tv.getByTestId("tv-detail-play")).toBeFocused();
  await tv.keyboard.press("Enter");
}

export async function readPairingCode(tv: Page): Promise<string> {
  const text = await tv.getByTestId("pairing-code").textContent();
  return text!.replace(/\s/g, "");
}

export async function openPairedPhone(browser: Browser, tv: Page): Promise<Page> {
  const phone = await (await browser.newContext(PHONE)).newPage();
  await phone.goto("/");
  await phone.getByTestId("code-input").fill(await readPairingCode(tv)); // connects by itself on the sixth digit
  await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");
  return phone;
}

export const tvRoot = (tv: Page) => tv.getByTestId("tv");
export const tvTime = async (tv: Page) => Number(await tvRoot(tv).getAttribute("data-time"));

/** A phone speaking the raw protocol, to verify the exact command sequence without the UI in between. */
export class RawPhone {
  readonly states: PlayerState[] = [];
  private constructor(private readonly ws: WebSocket) {
    ws.onmessage = (event) => {
      const message: ServerMessage | null = parseServerMessage(event.data);
      if (message?.type === "STATE") this.states.push(message.state);
    };
  }
  static async connect(baseURL: string, code: string): Promise<RawPhone> {
    const ws = new WebSocket(baseURL.replace("http", "ws") + "/ws");
    await new Promise((resolve) => (ws.onopen = resolve));
    const phone = new RawPhone(ws);
    ws.send(JSON.stringify({ type: "CTL_HELLO" }));
    ws.send(JSON.stringify({ type: "PAIR", code }));
    return phone;
  }
  cmd(command: Command) {
    this.ws.send(JSON.stringify({ type: "CMD", command }));
  }
  /** What the phone's "play" button sends: the server resolves the link, then tells the TV to load it. */
  playUrl(url: string, startAt?: number) {
    this.ws.send(JSON.stringify({ type: "PLAY_URL", url, ...(startAt === undefined ? {} : { startAt }) }));
  }
  close() {
    this.ws.close();
  }
}

/**
 * Hand a video to the TV the way a resolver would, from the phone page itself (a second socket on the phone's own
 * identity), then reload the page so it shows what the server now holds. For tests that need a series with an episode list.
 */
export async function loadOnTv(phone: Page, media: NormalizedMedia): Promise<void> {
  await phone.evaluate(async (media) => {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    await new Promise((resolve) => (ws.onopen = resolve));
    ws.send(JSON.stringify({ type: "CTL_HELLO", controllerId: localStorage.getItem("controller.id") }));
    ws.send(JSON.stringify({ type: "CMD", command: { type: "LOAD", media } }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    ws.close();
  }, media);
  await phone.reload();
}
