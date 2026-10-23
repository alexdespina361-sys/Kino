import { chromium, expect, test as base, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { parseServerMessage, type Command, type NormalizedMedia, type PlayerState, type ServerMessage } from "../src/shared";

/**
 * The tests' `test`: Playwright's, and every device a test opened is closed when the test is over. A device made with
 * `browser.newContext()` (see `openDevice`) is no fixture of Playwright's, so nothing closes it before the worker's browser does, at the end
 * of the whole run: every test left its browsers behind, and a full run ended with hundreds of browser processes and tens of gigabytes.
 */
export const test = base.extend<{ closeDevices: void }>({
  closeDevices: [
    async ({ browser }, use) => {
      await use();
      await Promise.all(browser.contexts().map((context) => context.close().catch(() => undefined)));
    },
    { auto: true },
  ],
});

/** A phone: a narrow touch screen, which is how the page tells a remote from a TV. */
/** (The screen is the phone's own: the project's desktop browser would otherwise say 1920 by 1080 whatever the window is.) */
export const PHONE = { viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, hasTouch: true } as const;

/**
 * One stream at two sizes, for a screen that is to be offered a choice of quality: the context serves /fixtures/hls/multi.m3u8, the smaller
 * size listed second (as a real one's might be), over the fixture's own pieces.
 */
export const twoSizes = (context: BrowserContext) =>
  context.route("**/fixtures/hls/multi.m3u8", (route) =>
    route.fulfill({
      contentType: "application/vnd.apple.mpegurl",
      body: [
        "#EXTM3U",
        "#EXT-X-VERSION:7",
        '#EXT-X-STREAM-INF:BANDWIDTH=453168,RESOLUTION=1280x720,CODECS="vp09.00.11.08"',
        "stream.m3u8",
        '#EXT-X-STREAM-INF:BANDWIDTH=153168,RESOLUTION=320x180,CODECS="vp09.00.11.08"',
        "stream.m3u8",
        "",
      ].join("\n"),
    }),
  );

/** A device that has never opened the page: nothing kept, so a screen goes full screen at its first press (the config's pages start as if it had been left). */
export const FIRST_VISIT = { cookies: [], origins: [] };

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
export function guestStorage(data: { progress?: unknown[]; watched?: unknown[]; list?: unknown[]; listNames?: unknown[]; ratings?: unknown[]; settings?: unknown[] }): Record<string, string> {
  return { "kino.data.guest": JSON.stringify({ v: 1, data: { progress: [], watched: [], list: [], listNames: [], ratings: [], settings: [], ...data }, rev: 0, dirty: [] }) };
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

/** What `sleepingServer` leaves on the page for the test to switch. */
type ServerSwitch = { up: boolean; sockets: WebSocket[] };

/**
 * A page whose server does not answer: the connections it tries stay "connecting", which is what a free host's do while it wakes up,
 * until the test lets them through (`serverUp`; `up` says whether it starts that way). The page's clock is fake, so the ten seconds
 * it waits before saying more are skipped with `page.clock.fastForward`.
 */
export const sleepingServer =
  (up = false) =>
  async (context: BrowserContext): Promise<void> => {
    await context.clock.install();
    await context.addInitScript((startUp) => {
      const Real = window.WebSocket;
      const server: ServerSwitch = { up: startUp, sockets: [] };
      (window as unknown as { __server: ServerSwitch }).__server = server;
      window.WebSocket = new Proxy(Real, {
        construct(target, args: ConstructorParameters<typeof WebSocket>) {
          if (server.up) {
            const socket = new target(...args);
            server.sockets.push(socket);
            return socket;
          }
          // Never answered: it stays CONNECTING until the page gives up on it, and then closes as a connection that never came up does.
          const hung = {
            readyState: Real.CONNECTING as number,
            onopen: null,
            onmessage: null,
            onerror: null,
            onclose: null as ((event: { code: number }) => void) | null,
            send() {},
            close() {
              if (hung.readyState === Real.CLOSED) return;
              hung.readyState = Real.CLOSED;
              queueMicrotask(() => hung.onclose?.({ code: 1006 }));
            },
          };
          return hung as unknown as WebSocket;
        },
      });
    }, up);
  };

/** The connection the page has is cut, and the ones it tries after that are not answered. */
export const serverDown = (page: Page) =>
  page.evaluate(() => {
    const server = (window as unknown as { __server: ServerSwitch }).__server;
    server.up = false;
    server.sockets.forEach((socket) => socket.close());
  });

/** The next connection the page tries is a real one. */
export const serverUp = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { __server: ServerSwitch }).__server.up = true;
  });

/** What the library says to the rows that come after the first ones and to more titles of a row, when a test has it do so. */
export interface LibraryFeed {
  /** The rows after the first ones: `{ rows, next }`, asked from `cursor` (for the page of one section: movie, series, cartoon or anime; or for Home, `null`). */
  rows?: (cursor: number, section: string | null) => unknown;
  /** More titles of a row, from page 2: `{ items, last }`. */
  more?: (row: string, page: number) => unknown;
}

/**
 * Answer the library's requests with `library` (and the search with `search`: a list of titles, or `{ items, exact }` to say how many have every word): the server
 * the tests run against has no library of its own. The rows that come after the first ones, and the pages of a row, are `feed`'s; without it there are none.
 */
export const withLibrary =
  (library: unknown, search?: (query: string) => unknown, feed?: LibraryFeed) =>
  async (context: BrowserContext): Promise<void> => {
    await context.route("**/api/library", (route) => route.fulfill({ json: library }));
    await context.route(/\/api\/library\/search/, (route) => {
      const found = search?.(new URL(route.request().url()).searchParams.get("q") ?? "") ?? [];
      return route.fulfill({ json: Array.isArray(found) ? { items: found } : found });
    });
    if (feed?.rows) {
      await context.route(/\/api\/library\/rows/, (route) => {
        const query = new URL(route.request().url()).searchParams;
        return route.fulfill({ json: feed.rows!(Number(query.get("cursor") ?? 0), query.get("section") ?? query.get("kind")) });
      });
    }
    if (feed?.more) {
      await context.route(/\/api\/library\/more/, (route) => {
        const query = new URL(route.request().url()).searchParams;
        return route.fulfill({ json: feed.more!(query.get("row") ?? "", Number(query.get("page"))) });
      });
    }
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

/**
 * What is on a TV's profile page: three places that are cards (what the profile rated, its friends, History), and two buttons in its top, which
 * are not places (Settings, and for a guest the way to sign in).
 */
export type ProfilePlace = "ratings" | "friends" | "history" | "signin" | "settings";

/** The button of the profile page's top that a place is, if it is one (the others are cards). */
export const profileButton = (tv: Page, place: ProfilePlace): Locator | null =>
  place === "settings" ? tv.getByTestId("tv-profile-settings") : place === "signin" ? tv.getByTestId("tv-profile-signin") : null;

/** The profile's page, opened by a click on the button in the corner (the page's first button or card has the remote). */
export async function openProfilePage(tv: Page): Promise<void> {
  await tv.getByTestId("tv-account-chip").click();
  await expect(tv.getByTestId("tv-browse")).toHaveAttribute("data-view", "profile");
}

/** A place on the profile's page, clicked as a mouse does it (the profile's page is opened first unless it is open). */
export async function openProfilePlace(tv: Page, place: ProfilePlace): Promise<void> {
  if ((await tv.getByTestId("tv-browse").getAttribute("data-view")) !== "profile") await openProfilePage(tv);
  await (profileButton(tv, place) ?? tv.locator(`[data-entry="profile:${place}"]`)).click();
}

/** The corner's button of a TV that is on the library's first screen, reached with a remote: Up (the banner's buttons are on the way), and OK opens the profile's page. */
export async function openProfileByRemote(tv: Page): Promise<void> {
  const chip = tv.getByTestId("tv-account-chip");
  for (let step = 0; step < 4 && !(await chip.evaluate((element) => element === document.activeElement)); step++) await tv.keyboard.press("ArrowUp");
  await expect(chip).toBeFocused();
  await tv.keyboard.press("Enter");
  await expect(tv.getByTestId("tv-browse")).toHaveAttribute("data-view", "profile");
}

/** The way to sign in of a TV that nobody is signed in on: the corner's button opens the profile's page, whose first button it is. */
export async function openTvSignIn(tv: Page): Promise<void> {
  await tv.getByTestId("tv-account-chip").click();
  await tv.getByTestId("tv-profile-signin").click();
}

/** The settings page of a TV (signed in or not): the corner's button, then the Settings button of the profile's page. */
export async function openTvSettings(tv: Page): Promise<void> {
  await openProfilePlace(tv, "settings");
  await expect(tv.getByTestId("tv-account")).toBeVisible();
}

/** The same with a remote: Up to the top and along it to Settings or the way to sign in, or Down and Right along the cards to a place, and OK. */
export async function pressProfilePlace(tv: Page, place: ProfilePlace): Promise<void> {
  const button = profileButton(tv, place);
  const target = button ?? tv.locator(`[data-entry="profile:${place}"]`);
  await expect(target).toBeVisible();
  const there = () => target.evaluate((element) => element === document.activeElement);
  for (let step = 0; step < 6 && !(await there()); step++) {
    const onCard = await tv.evaluate(() => document.activeElement?.getAttribute("data-zone") === "rows");
    // (to a button of the top: Up from the cards, then Right to Settings or Left to Sign in; to a card: Down from the top, then Right along the cards)
    await tv.keyboard.press(button ? (onCard ? "ArrowUp" : place === "settings" ? "ArrowRight" : "ArrowLeft") : onCard ? "ArrowRight" : "ArrowDown");
  }
  await expect(target).toBeFocused();
  await tv.keyboard.press("Enter");
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

/** One of the four places of the phone's bar: Home (what to watch, the box for a link), Search, My lists (the lists and the ratings) and You (the account). */
export const place = (phone: Page, name: "home" | "search" | "list" | "you") => phone.getByTestId(`tab-${name}`).click();

export const tvRoot = (tv: Page) => tv.getByTestId("tv");
export const tvTime =async (tv: Page) => Number(await tvRoot(tv).getAttribute("data-time"));

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
