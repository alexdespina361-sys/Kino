import { chromium, expect, test as base, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { AVATAR_IDS, avatarName, parseServerMessage, PROFILE_NAME_MAX, type Command, type NormalizedMedia, type PlayerState, type PlayHint, type ServerMessage } from "../src/shared";
import { COMPACT_MAX_WIDTH, COMPACT_MIN_HEIGHT } from "../src/client/tv/compact";

export const test = base.extend<{ closeDevices: void }>({
  closeDevices: [
    async ({ browser }, use) => {
      await use();
      await Promise.all(browser.contexts().map((context) => context.close().catch(() => undefined)));
    },
    { auto: true },
  ],
});

const ORIGIN = `http://127.0.0.1:${Number(process.env.E2E_PORT) || 8788}`;
export const SEEDED = [
  { name: "kino.fullscreen.left", value: "1" },
  { name: "kino.linkbox", value: "1" },
  { name: "kino.fit", value: "couch" },
] as const;
export const seeded = (more: { name: string; value: string }[] = [], without: string[] = []) => ({
  cookies: [],
  origins: [{ origin: ORIGIN, localStorage: [...SEEDED.filter((entry) => !without.includes(entry.name)), ...more] }],
});
const PHONE_SIZE = { viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, hasTouch: true } as const;
export const PHONE = { ...PHONE_SIZE, storageState: seeded([{ name: "kino.role", value: "remote" }]) } as const;
export const NEW_PHONE = { ...PHONE_SIZE, storageState: seeded() } as const;

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

export const threeSizes = (context: BrowserContext, broken480 = false) =>
  context.route("**/fixtures/hls/three.m3u8", (route) =>
    route.fulfill({
      contentType: "application/vnd.apple.mpegurl",
      body: [
        "#EXTM3U",
        "#EXT-X-VERSION:7",
        '#EXT-X-STREAM-INF:BANDWIDTH=453168,RESOLUTION=1280x720,CODECS="vp09.00.11.08"',
        "stream.m3u8",
        '#EXT-X-STREAM-INF:BANDWIDTH=253168,RESOLUTION=854x480,CODECS="vp09.00.11.08"',
        broken480 ? "not-there-480.m3u8" : "stream.m3u8",
        '#EXT-X-STREAM-INF:BANDWIDTH=153168,RESOLUTION=320x180,CODECS="vp09.00.11.08"',
        "stream.m3u8",
        "",
      ].join("\n"),
    }),
  );

export const FIRST_VISIT = { cookies: [], origins: [] };
export const REMOTE_FIRST_VISIT = seeded([{ name: "kino.role", value: "remote" }], SEEDED.map((entry) => entry.name));

export const strictBrowser = () => chromium.launch({ args: ["--autoplay-policy=user-gesture-required"] });
export const PRESS_EXPIRES_MS = 5500;
export const PAGE_LEFT_ALONE_MS = 2000;

export function guestStorage(data: { progress?: unknown[]; watched?: unknown[]; list?: unknown[]; listNames?: unknown[]; ratings?: unknown[]; settings?: unknown[] }): Record<string, string> {
  return { "kino.data.guest": JSON.stringify({ v: 1, data: { progress: [], watched: [], list: [], listNames: [], ratings: [], settings: [], ...data }, rev: 0, dirty: [] }) };
}

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

type ServerSwitch = { up: boolean; sockets: WebSocket[] };

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

export const serverDown = (page: Page) =>
  page.evaluate(() => {
    const server = (window as unknown as { __server: ServerSwitch }).__server;
    server.up = false;
    server.sockets.forEach((socket) => socket.close());
  });

export const serverUp = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { __server: ServerSwitch }).__server.up = true;
  });

export interface LibraryFeed {
  rows?: (cursor: number, section: string | null) => unknown;
  more?: (row: string, page: number) => unknown;
}

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

export async function openLibrary(
  browser: Browser,
  setup?: (context: BrowserContext) => Promise<unknown>,
  viewport = { width: 1280, height: 720 },
  seed: Record<string, string> = {},
): Promise<Page> {
  const page = await openDevice(browser, { viewport }, seed, setup);
  await page.goto("/tv");
  await expect(page.getByTestId("tv-browse")).toBeVisible();
  return page;
}

export const heldUpright = (page: Page): boolean => {
  const size = page.viewportSize();
  return size !== null && size.width <= COMPACT_MAX_WIDTH && size.height >= COMPACT_MIN_HEIGHT;
};


export const onItsSide = async (page: Page): Promise<boolean> => (await page.getByTestId("tv-rail").getAttribute("data-flat")) === "true";

const onProfilePage = async (tv: Page): Promise<boolean> => (await tv.getByTestId("tv-browse").getAttribute("data-view")) === "profile";

export async function pressMenuLine(tv: Page, id: "rail-party" | "rail-connect", how: "click" | "tap" = "click"): Promise<void> {
  if ((heldUpright(tv) || (await onItsSide(tv))) && !(await onProfilePage(tv))) await openProfilePage(tv, how);
  await tv.getByTestId(id)[how]();
}

export async function openTv(browser: Browser, viewport = { width: 1280, height: 720 }, seed: Record<string, string> = {}): Promise<Page> {
  const page = await openLibrary(browser, undefined, viewport, seed);
  await pressMenuLine(page, "rail-connect");
  return page;
}

export async function clickAsAHand(page: Page, target: Locator): Promise<void> {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.up();
}

export type ProfilePlace = "ratings" | "friends" | "history" | "news" | "signin" | "settings";

export const profileButton = (tv: Page, place: ProfilePlace): Locator | null =>
  place === "settings" ? tv.getByTestId("tv-profile-settings") : place === "signin" ? tv.getByTestId("tv-profile-signin") : null;

export async function openProfilePage(tv: Page, how: "click" | "tap" = "click"): Promise<void> {
  await tv.getByTestId("tv-account-chip")[how]();
  await expect(tv.getByTestId("tv-browse")).toHaveAttribute("data-view", "profile");
}

export async function showProfilePage(tv: Page): Promise<void> {
  if (!(await onProfilePage(tv))) await openProfilePage(tv);
}

export async function openProfilePlace(tv: Page, place: ProfilePlace): Promise<void> {
  if (!(await onProfilePage(tv))) await openProfilePage(tv);
  await (profileButton(tv, place) ?? tv.locator(`[data-entry="profile:${place}"]`)).click();
}

export async function openProfileByRemote(tv: Page): Promise<void> {
  const chip = tv.getByTestId("tv-account-chip");
  for (let step = 0; step < 4 && !(await chip.evaluate((element) => element === document.activeElement)); step++) await tv.keyboard.press("ArrowUp");
  await expect(chip).toBeFocused();
  await tv.keyboard.press("Enter");
  await expect(tv.getByTestId("tv-browse")).toHaveAttribute("data-view", "profile");
}

export async function openTvSignIn(tv: Page): Promise<void> {
  await tv.getByTestId("tv-account-chip").click();
  await tv.getByTestId("tv-profile-signin").click();
}

export async function openTvSettings(tv: Page): Promise<void> {
  await openProfilePlace(tv, "settings");
  await expect(tv.getByTestId("tv-account")).toBeVisible();
}

export async function pressProfilePlace(tv: Page, place: ProfilePlace): Promise<void> {
  const button = profileButton(tv, place);
  const target = button ?? tv.locator(`[data-entry="profile:${place}"]`);
  await expect(target).toBeVisible();
  const there = () => target.evaluate((element) => element === document.activeElement);
  for (let step = 0; step < 8 && !(await there()); step++) {
    const onCard = await tv.evaluate(() => document.activeElement?.getAttribute("data-zone") === "rows");
    const towards = () =>
      target.evaluate((element) => {
        const from = document.activeElement!.getBoundingClientRect();
        const to = element.getBoundingClientRect();
        if (to.top >= from.bottom - 1) return "ArrowDown";
        if (to.bottom <= from.top + 1) return "ArrowUp";
        return to.left < from.left ? "ArrowLeft" : "ArrowRight";
      });
    await tv.keyboard.press(button ? (onCard ? "ArrowUp" : place === "settings" ? "ArrowRight" : "ArrowLeft") : onCard ? await towards() : "ArrowDown");
  }
  await expect(target).toBeFocused();
  await tv.keyboard.press("Enter");
}

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
  await phone.getByTestId("code-input").fill(await readPairingCode(tv));
  await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");
  return phone;
}

export const place = (phone: Page, name: "home" | "search" | "list" | "you") => phone.getByTestId(`tab-${name}`).click();

export const tvRoot = (tv: Page) => tv.getByTestId("tv");
export const tvTime = async (tv: Page) => Number(await tvRoot(tv).getAttribute("data-time"));

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
  playUrl(url: string, startAt?: number, hint?: PlayHint) {
    this.ws.send(JSON.stringify({ type: "PLAY_URL", url, ...(startAt === undefined ? {} : { startAt }), ...(hint ? { hint } : {}) }));
  }
  close() {
    this.ws.close();
  }
}

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

export const PICTURE_NAME = new RegExp(`^(${AVATAR_IDS.map(avatarName).join("|")})$`);
export const PICTURE_NAMED = new RegExp(`\\b(${AVATAR_IDS.map(avatarName).join("|")})\\b`);

export function loginName(login: string): string {
  const own = login.includes("@") ? (login.split("@")[0]?.split(/[._+-]/)[0] ?? "") : login;
  const word = own.replace(/[._+-]+/g, " ").replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
  return word ? (word.charAt(0).toUpperCase() + word.slice(1)).slice(0, PROFILE_NAME_MAX).trim() : "Me";
}

export async function nameFirstProfile(page: Page, name: string): Promise<void> {
  let id: string | undefined;
  await expect
    .poll(async () => {
      const state = (await (await page.request.get("/api/me")).json()) as { me: { profiles: Array<{ id: string }> } | null };
      id = state.me?.profiles[0]?.id;
      return id !== undefined;
    }, { timeout: 15_000 })
    .toBe(true);
  const renamed = await page.request.patch(`/api/profiles/${id}`, { data: { name } });
  expect(renamed.ok(), `rename to ${name}: ${renamed.status()}`).toBe(true);
  await page.reload();
}
