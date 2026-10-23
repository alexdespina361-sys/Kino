import { expect, type Browser, type Locator, type Page } from "@playwright/test";
import type { NormalizedMedia } from "../src/shared";
import { openDevice, openLibrary, openTv, PHONE, pressMenuLine, RawPhone, readPairingCode, test, tvRoot, withLibrary } from "./helpers";

/**
 * The phone's layout (docs/phone-layout): a phone is held upright and used with a thumb, so on the narrowest ones (320, 360 and 390 px wide) both of its screens, the
 * remote and the library it shows when it is the screen, have their places on a bar at the foot, no text under 14 px, nothing to press under 44 px, nothing that makes the
 * page slide sideways, a title that is a page of its own, and sheets that leave the page they were opened from in view.
 */

interface Size {
  name: string;
  width: number;
  height: number;
}
const SIZES: Size[] = [
  { name: "320 by 568", width: 320, height: 568 },
  { name: "360 by 800", width: 360, height: 800 },
  { name: "390 by 844", width: 390, height: 844 },
];
/** The tightest phone in each language (the words of Romanian and Italian are the longest), and the others in English. */
const CASES = [
  ...SIZES.map((size) => ({ size, locale: "en-US", name: size.name })),
  { size: SIZES[0]!, locale: "ro-RO", name: "320 by 568 in Romanian" },
  { size: SIZES[0]!, locale: "it-IT", name: "320 by 568 in Italian" },
];

/** A phone of this size (asking for less motion: what is measured is where things come to rest, so nothing is waited for while it slides in or rises). */
const phoneAt = ({ width, height }: Size, locale = "en-US") => ({ ...PHONE, viewport: { width, height }, screen: { width, height }, locale, reducedMotion: "reduce" as const });

const film = (id: string, title: string) => ({ id, title, year: 2000, kind: "movie", url: `/fixtures/sample.mp4?n=${id}` });
const row = (id: string, title: string, count: number) => ({ id, title, source: "Test Source", kind: "movie", items: Array.from({ length: count }, (_, i) => film(`${id}-${i}`, `${title} film ${i + 1}`)) });
const library = { updatedAt: Date.now(), rows: Array.from({ length: 8 }, (_, i) => row(`r${i}`, `Shelf ${i + 1}`, 14)) };

/**
 * What an eye and a thumb need, measured on the page as it is on screen: the smallest text (the four words of a bar are counted apart: they are the one place that
 * is 12 px), the smallest thing to press (what is out of view, or under a sheet or a page, is neither read nor pressed, so it does not count), and whether the page
 * slides sideways. A hit area that reaches past a button's drawing counts for it. A whole page (`whole`) is counted down to its foot, as a long one is read by scrolling it.
 */
async function measure(page: Page, whole = false) {
  return page.evaluate((whole) => {
    const W = innerWidth;
    const H = innerHeight;
    const PRESS = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="tab"], [role="radio"], [role="option"], [role="switch"]';
    const describe = (element: Element) => {
      const id = element.getAttribute("data-testid");
      const classes = typeof element.className === "string" ? element.className.split(/\s+/).filter(Boolean).slice(0, 2).join(".") : "";
      return `${element.tagName.toLowerCase()}${id ? `[${id}]` : ""}${classes ? `.${classes}` : ""}`;
    };
    let text = { px: Infinity, what: "" };
    let barText = { px: Infinity, what: "" };
    let press = { px: Infinity, what: "" };
    for (const element of document.body.querySelectorAll<HTMLElement>("*")) {
      const rect = element.getBoundingClientRect(); // (first: what is not displayed has no box, and most of a page is out of view)
      if (rect.width < 4 || rect.height < 4) continue;
      const inView = rect.right > 0 && rect.bottom > 0 && rect.left < W && rect.top < H;
      if (!inView && !whole) continue;
      if (element.closest("svg")) continue;
      const style = getComputedStyle(element);
      if (style.visibility === "hidden" || style.opacity === "0") continue;
      if (inView) {
        const x = Math.min(Math.max((Math.max(rect.left, 0) + Math.min(rect.right, W)) / 2, 0), W - 1);
        const y = Math.min(Math.max((Math.max(rect.top, 0) + Math.min(rect.bottom, H)) / 2, 0), H - 1);
        const top = document.elementFromPoint(x, y);
        if (top && top !== element && !element.contains(top) && !top.contains(element)) continue;
      }
      let own = "";
      for (const node of element.childNodes) if (node.nodeType === 3) own += node.textContent;
      const size = parseFloat(style.fontSize);
      if (own.trim()) {
        const found = { px: size, what: `${describe(element)} "${own.trim().slice(0, 24)}"` };
        if (element.closest(".tabbar, .tv-rail[data-bar]")) barText = size < barText.px ? found : barText;
        else text = size < text.px ? found : text;
      }
      if (!element.matches(PRESS)) continue;
      const reach = { l: 0, r: 0, t: 0, b: 0 };
      for (const which of ["::before", "::after"]) {
        const pseudo = getComputedStyle(element, which);
        if (pseudo.content === "none" || pseudo.position !== "absolute") continue;
        const past = (value: string) => Math.max(0, -(parseFloat(value) || 0));
        reach.l = Math.max(reach.l, past(pseudo.left));
        reach.r = Math.max(reach.r, past(pseudo.right));
        reach.t = Math.max(reach.t, past(pseudo.top));
        reach.b = Math.max(reach.b, past(pseudo.bottom));
      }
      const least = Math.min(rect.width + reach.l + reach.r, rect.height + reach.t + reach.b);
      if (least < press.px) press = { px: Math.round(least * 10) / 10, what: describe(element) };
    }
    return { sideways: document.documentElement.scrollWidth > W + 1, text, barText, press };
  }, whole);
}

/** One screen's numbers, each told with what it was measured on, so a failure says which thing is too small. */
async function expectFits(page: Page, where: string, whole = false) {
  const seen = await measure(page, whole);
  expect(seen.sideways, `${where}: the page slides sideways`).toBe(false);
  expect(seen.text.px, `${where}: the smallest text is ${seen.text.what}`).toBeGreaterThanOrEqual(14);
  expect(seen.barText.px, `${where}: the smallest word of the bar is ${seen.barText.what}`).toBeGreaterThanOrEqual(12);
  expect(seen.press.px, `${where}: the smallest thing to press is ${seen.press.what}`).toBeGreaterThanOrEqual(44);
}

/** Where something is once it has stopped moving (a page slides in, a sheet rises): a box read in the middle of that is somewhere on the way. */
async function settled(target: Locator) {
  let last = await target.boundingBox();
  for (let tries = 0; tries < 30; tries++) {
    await target.page().waitForTimeout(60);
    const now = await target.boundingBox();
    if (last && now && now.x === last.x && now.y === last.y && now.width === last.width && now.height === last.height) return now;
    last = now;
  }
  return last!;
}

/** A word on a bar is never cut off or pushed past the edge of the place that holds it. */
async function expectWordsFit(page: Page, selector: string, where: string) {
  const cut = await page.evaluate((each) => {
    const bad: string[] = [];
    for (const label of document.querySelectorAll<HTMLElement>(each)) {
      const holder = label.closest("button")!.getBoundingClientRect();
      const box = label.getBoundingClientRect();
      if (label.scrollWidth > label.clientWidth + 1 || box.left < holder.left - 0.5 || box.right > holder.right + 0.5) bad.push(`${label.textContent} (${Math.round(label.scrollWidth)} in ${Math.round(label.clientWidth)})`);
    }
    return bad;
  }, selector);
  expect(cut, `${where}: words that do not fit their place`).toEqual([]);
}

test.describe("the remote, held upright", () => {
  /** A phone paired with a TV, its library answered by the test. */
  async function pairedPhone(browser: Browser, size: Size, locale = "en-US"): Promise<Page> {
    const [tv, phone] = await Promise.all([openTv(browser), openDevice(browser, phoneAt(size, locale), {}, withLibrary(library))]);
    await phone.goto("/");
    await phone.getByTestId("code-input").fill(await readPairingCode(tv)); // connects by itself on the sixth digit
    await expect(phone.getByTestId("tv-online")).toHaveClass(/\bok\b/);
    await expect(phone.getByTestId("library-row").first()).toBeVisible();
    return phone;
  }

  for (const { size, locale, name } of CASES) {
    test(`at ${name}: four places on a bar at the foot, the TV at the top, and every place fits a thumb and an eye`, async ({ browser }) => {
      const phone = await pairedPhone(browser, size, locale);
      const bar = (await phone.getByTestId("tabbar").boundingBox())!;
      expect(bar.y + bar.height, "the bar is at the foot of the screen").toBeGreaterThanOrEqual(size.height - 2);
      expect(bar.width).toBeGreaterThanOrEqual(size.width - 1);
      const chip = (await phone.getByTestId("menu").boundingBox())!;
      expect(chip.y, "the TV is at the top").toBeLessThan(80);
      expect(chip.height).toBeGreaterThanOrEqual(44);

      for (const place of ["home", "search", "list", "you"] as const) {
        const tab = phone.getByTestId(`tab-${place}`);
        await tab.tap();
        await expect(tab).toHaveAttribute("aria-current", "page");
        const box = (await tab.boundingBox())!;
        expect(Math.min(box.width, box.height), `the ${place} place`).toBeGreaterThanOrEqual(44);
        expect((await tab.innerText()).trim(), `the ${place} place has a word`).not.toBe("");
        await expectFits(phone, `${name}, ${place}`);
      }
      await expectWordsFit(phone, ".tab-label", name);
    });
  }

  for (const size of SIZES) {
    test(`at ${size.name}: a title is a page of its own with its Play in the first screen, and its Back button returns to the library where it was`, async ({ browser }) => {
      const phone = await pairedPhone(browser, size);
      await phone.evaluate(() => window.scrollTo(0, 300));
      const poster = phone.getByTestId("library-tile").nth(2);
      await poster.scrollIntoViewIfNeeded();
      const before = await phone.evaluate(() => window.scrollY);
      expect(before).toBeGreaterThan(100);
      await poster.tap();

      const page = phone.getByTestId("title-sheet");
      await expect(page).toBeVisible();
      const box = await settled(page);
      expect(box.x).toBeLessThanOrEqual(1);
      expect(box.width).toBeGreaterThanOrEqual(size.width - 1);
      expect(box.height, "a page covers the screen, not a part of it").toBeGreaterThanOrEqual(size.height - 1);
      const play = (await phone.getByTestId("title-play").boundingBox())!;
      expect(play.y + play.height, "Play is in the first screen of the page").toBeLessThanOrEqual(size.height);
      expect(play.height).toBeGreaterThanOrEqual(44);
      const back = (await phone.getByTestId("title-back").boundingBox())!;
      expect(Math.min(back.width, back.height)).toBeGreaterThanOrEqual(44);
      await expectFits(phone, `${size.name}, a title's page`);

      // The library lies behind the page, and a finger on the page (or the browser bringing a button into view) can still move it: it is not what the reader scrolled.
      await phone.evaluate(() => window.scrollTo(0, 0));
      await phone.getByTestId("title-back").tap();
      await expect(page).toHaveCount(0);
      await expect.poll(() => phone.evaluate(() => window.scrollY), { message: "the library is scrolled where it was" }).toBeGreaterThanOrEqual(before - 2);
      expect(await phone.evaluate(() => window.scrollY)).toBeLessThanOrEqual(before + 2);
    });
  }

  for (const size of [SIZES[0]!, SIZES[2]!]) {
    test(`at ${size.name}: a sheet leaves the page it was opened from in view (at most 70% of a tall screen, 78% of a short one)`, async ({ browser }) => {
      const phone = await pairedPhone(browser, size);
      await phone.getByTestId("menu").tap();
      const sheet = phone.getByTestId("menu-sheet");
      await expect(sheet).toBeVisible();
      const box = await settled(sheet);
      expect(box.height, "a sheet leaves the page it was opened from in view").toBeLessThanOrEqual(size.height * (size.height <= 640 ? 0.78 : 0.7) + 1);
      expect(box.y + box.height, "it sits on the foot of the screen").toBeGreaterThanOrEqual(size.height - 2);
      const close = (await phone.getByTestId("sheet-close").boundingBox())!;
      expect(Math.min(close.width, close.height)).toBeGreaterThanOrEqual(44);
      await expectFits(phone, `${size.name}, the TV's sheet`);
      await phone.getByTestId("sheet-close").tap();
      await expect(sheet).toHaveCount(0);
    });
  }
});

test.describe("a phone used as the screen, held upright", () => {
  async function screen(browser: Browser, size: Size, locale = "en-US"): Promise<Page> {
    const tv = await openDevice(browser, phoneAt(size, locale), {}, withLibrary(library));
    await tv.goto("/tv");
    await expect(tv.getByTestId("tv-browse-tile").first()).toBeVisible();
    return tv;
  }

  for (const { size, locale, name } of CASES) {
    test(`at ${name}: the places are a bar at the foot, the sections a row of buttons over the titles, and everything fits a thumb and an eye`, async ({ browser }) => {
      const tv = await screen(browser, size, locale);
      const bar = (await tv.getByTestId("tv-rail").boundingBox())!;
      expect(bar.y + bar.height, "the bar is at the foot of the screen").toBeGreaterThanOrEqual(size.height - 2);
      expect(bar.width).toBeGreaterThanOrEqual(size.width - 1);
      const places = ["rail-home", "rail-search", "rail-categories", "rail-list"];
      for (const id of places) {
        const place = tv.getByTestId(id);
        const box = (await place.boundingBox())!;
        expect(Math.min(box.width, box.height), id).toBeGreaterThanOrEqual(44);
        expect((await place.innerText()).trim(), `${id} has a word`).not.toBe("");
      }
      await expectWordsFit(tv, ".tv-rail-item span", name);
      for (const kind of ["home", "movies", "series", "cartoons", "anime"]) {
        const chip = (await tv.getByTestId(`section-${kind}`).boundingBox())!;
        expect(chip.height, `the ${kind} button`).toBeGreaterThanOrEqual(44);
      }
      await expectFits(tv, `${name}, Home`);

      for (const id of places.slice(1)) {
        await tv.getByTestId(id).tap();
        await expect(tv.getByTestId(id)).toHaveAttribute("aria-current", "page");
        await expectFits(tv, `${name}, ${id}`);
      }
    });
  }

  for (const { size, locale, name } of CASES) {
    test(`at ${name}: the settings, the way in and the party's page, counted down to their feet, have nothing under a thumb or an eye`, async ({ browser }) => {
      const tv = await screen(browser, size, locale);
      await tv.getByTestId("tv-account-chip").tap();
      await tv.getByTestId("tv-profile-settings").tap();
      await expect(tv.getByTestId("tv-account-back")).toBeVisible();
      await settled(tv.getByTestId("tv-account-back"));
      await expectFits(tv, `${name}, settings`, true);
      await tv.getByTestId("tv-account-back").tap();

      await tv.getByTestId("tv-profile-signin").tap();
      await expect(tv.getByTestId("tv-signin-back")).toBeVisible();
      await settled(tv.getByTestId("tv-signin-back"));
      await expectFits(tv, `${name}, the way in`, true);
      await tv.getByTestId("tv-signin-back").tap();

      await tv.getByTestId("rail-party").tap();
      await expect(tv.getByTestId("tv-back-to-library")).toBeVisible();
      await settled(tv.getByTestId("tv-back-to-library"));
      await expectFits(tv, `${name}, the party`, true);
    });
  }

  /** Enough of a film for the player to show every kind of menu it has. */
  const longNight = (baseURL: string): NormalizedMedia => ({
    title: "The Long Night · S1 E2",
    stream: { url: "/fixtures/sample.mp4", type: "mp4" },
    subtitles: [
      { id: "en", label: "English", lang: "en", url: "/fixtures/sample.vtt" },
      { id: "nl", label: "Dutch", lang: "nl", url: "/fixtures/sample.vtt" },
    ],
    series: {
      season: 1,
      episode: 2,
      episodes: [
        { season: 1, episode: 1, title: "The Pilot", url: `${baseURL}/fixtures/pages/video.html` },
        { season: 1, episode: 2, title: "The Long Night", url: `${baseURL}/fixtures/pages/none.html` },
        { season: 1, episode: 3, title: "The Following Episode", url: `${baseURL}/fixtures/pages/hls.html` },
      ],
      next: { season: 1, episode: 3, title: "The Following Episode", url: `${baseURL}/fixtures/pages/hls.html` },
    },
  });

  for (const size of [SIZES[0]!, SIZES[2]!]) {
    // (A window of a phone's size, not a touch screen: a phone that is touched is somebody's remote or screen of their own, and shows no code to pair another one with.)
    test(`at ${size.name}: the player's menus are sheets that leave the picture in view, with options a thumb hits`, async ({ browser, baseURL }) => {
      const tv = await openLibrary(browser, withLibrary(library), { width: size.width, height: size.height });
      await pressMenuLine(tv, "rail-connect");
      const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
      phone.cmd({ type: "LOAD", media: longNight(baseURL!) });
      await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");

      for (const id of ["tv-audio-sub-btn", "tv-episodes-btn"]) {
        await tv.getByTestId(id).click();
        const sheet = tv.getByTestId("audio-subtitles-modal");
        await expect(sheet, id).toBeVisible();
        const box = await settled(sheet);
        expect(box.height, `${id}: the sheet leaves the picture in view`).toBeLessThanOrEqual(size.height * 0.7 + 1);
        expect(box.y + box.height, `${id}: it sits on the foot of the screen`).toBeGreaterThanOrEqual(size.height - 2);
        const heights = await sheet.locator("[data-opt]").evaluateAll((options) => options.map((option) => option.getBoundingClientRect().height));
        expect(heights.length, `${id}: it has options`).toBeGreaterThan(0);
        for (const height of heights) expect(height, `${id}: an option`).toBeGreaterThanOrEqual(44);
        const close = (await sheet.locator("[data-menu-close]").boundingBox())!;
        expect(Math.min(close.width, close.height), `${id}: its close button`).toBeGreaterThanOrEqual(44);
        await sheet.locator("[data-menu-close]").click();
        await expect(sheet).toHaveCount(0);
      }
      phone.close();
    });
  }
});
