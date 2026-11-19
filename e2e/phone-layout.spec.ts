import { expect, type Browser, type Locator, type Page } from "@playwright/test";
import type { NormalizedMedia } from "../src/shared";
import { openDevice, openLibrary, openTv, PHONE, pressMenuLine, RawPhone, readPairingCode, test, tvRoot, withLibrary } from "./helpers";

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
const CASES = [
  ...SIZES.map((size) => ({ size, locale: "en-US", name: size.name })),
  { size: SIZES[0]!, locale: "ro-RO", name: "320 by 568 in Romanian" },
  { size: SIZES[0]!, locale: "it-IT", name: "320 by 568 in Italian" },
];

const phoneAt = ({ width, height }: Size, locale = "en-US") => ({ ...PHONE, viewport: { width, height }, screen: { width, height }, locale, reducedMotion: "reduce" as const });

const film = (id: string, title: string) => ({ id, title, year: 2000, kind: "movie", url: `/fixtures/sample.mp4?n=${id}` });
const row = (id: string, title: string, count: number) => ({ id, title, source: "Test Source", kind: "movie", items: Array.from({ length: count }, (_, i) => film(`${id}-${i}`, `${title} film ${i + 1}`)) });
const library = { updatedAt: Date.now(), rows: Array.from({ length: 8 }, (_, i) => row(`r${i}`, `Shelf ${i + 1}`, 14)) };

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
      const rect = element.getBoundingClientRect();
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

async function expectFits(page: Page, where: string, whole = false) {
  const seen = await measure(page, whole);
  expect(seen.sideways, `${where}: the page slides sideways`).toBe(false);
  expect(seen.text.px, `${where}: the smallest text is ${seen.text.what}`).toBeGreaterThanOrEqual(14);
  expect(seen.barText.px, `${where}: the smallest word of the bar is ${seen.barText.what}`).toBeGreaterThanOrEqual(12);
  expect(seen.press.px, `${where}: the smallest thing to press is ${seen.press.what}`).toBeGreaterThanOrEqual(44);
}

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
  async function pairedPhone(browser: Browser, size: Size, locale = "en-US"): Promise<Page> {
    const [tv, phone] = await Promise.all([openTv(browser), openDevice(browser, phoneAt(size, locale), {}, withLibrary(library))]);
    await phone.goto("/");
    await phone.getByTestId("code-input").fill(await readPairingCode(tv));
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

      await phone.evaluate(() => window.scrollTo(0, 0));
      await phone.getByTestId("title-back").tap();
      await expect(page).toHaveCount(0);
      await expect.poll(() => phone.evaluate(() => window.scrollY), { message: "the library is scrolled where it was" }).toBeGreaterThanOrEqual(before - 2);
      expect(await phone.evaluate(() => window.scrollY)).toBeLessThanOrEqual(before + 2);
    });
  }

  const known = {
    genres: ["Animation", "Action", "Comedy", "Family"],
    directors: ["Mark Osborne", "John Stevenson"],
    creators: [],
    cast: ["Jack Black", "Dustin Hoffman", "Angelina Jolie", "Ian McShane", "Jackie Chan", "Seth Rogen", "Lucy Liu", "David Cross"],
    ages: { US: "PG-13", GB: "12A", RO: "AP-12", IT: "T" },
    parts: [film("p1", "Kung Fu Panda 2"), film("p2", "Kung Fu Panda 3")],
    similar: [film("s1", "Madagascar"), film("s2", "Shrek"), film("s3", "How to Train Your Dragon")],
  };
  for (const { size, locale, name } of CASES) {
    test(`at ${name}: a title's page with what the movie database knows of it fits a thumb and an eye, with Play in the first screen`, async ({ browser }) => {
      const phone = await pairedPhone(browser, size, locale);
      await phone.route("**/api/library/about*", (route) => route.fulfill({ json: { about: known } }));
      await phone.getByTestId("library-tile").nth(2).tap();
      const page = phone.getByTestId("title-sheet");
      await expect(page.getByTestId("about-people")).toBeVisible();
      await expect(page.getByTestId("title-about-similar")).toBeAttached();
      await settled(page);
      const play = (await phone.getByTestId("title-play").boundingBox())!;
      expect(play.y + play.height, "Play is in the first screen of the page").toBeLessThanOrEqual(size.height);
      await expectFits(phone, `${name}, a title's page with what the movie database knows`);
      for (const rows of ["title-about-parts", "title-about-similar"]) {
        await page.getByTestId(rows).scrollIntoViewIfNeeded();
        await settled(page.getByTestId(rows));
        await expectFits(phone, `${name}, a title's page at its row ${rows}`);
      }
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

  test("the keyboard goes through a place in the order it is seen: the TV, the account, what the page holds, then the four places, each showing where it is", async ({ browser }) => {
    const phone = await pairedPhone(browser, SIZES[2]!);
    const blur = () => phone.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const focused = () =>
      phone.evaluate(() => {
        const element = document.activeElement as HTMLElement;
        const drawn = () =>
          [element, ...element.querySelectorAll("*")]
            .map((node) => {
              const style = getComputedStyle(node);
              return `${style.outlineStyle}/${style.outlineWidth}/${style.boxShadow}`;
            })
            .join("|");
        const on = drawn();
        element.blur();
        const off = drawn();
        element.focus();
        const box = element.getBoundingClientRect();
        return { id: element.dataset.testid ?? element.tagName.toLowerCase(), ring: element.tagName !== "BUTTON" || on !== off, size: Math.min(box.width, box.height) };
      });
    const stops = async (key: "Tab" | "Shift+Tab", count: number) => {
      await blur();
      const seen = [];
      for (let press = 0; press < count; press++) {
        await phone.keyboard.press(key);
        seen.push(await focused());
      }
      return seen;
    };
    const backward = (await stops("Shift+Tab", 6)).filter((one) => one.id !== "body");
    expect(
      backward.map((one) => one.id).slice(0, 4),
      "the four places are the last the keyboard reaches, in the order they are drawn",
    ).toEqual(["tab-you", "tab-list", "tab-search", "tab-home"]);
    expect(backward[4]!.id.startsWith("tab-"), "and what is before them is the page's own").toBe(false);
    await phone.reload();
    await expect(phone.getByTestId("library-row").first()).toBeVisible();
    const forward = await stops("Tab", 2);
    expect(forward.map((one) => one.id), "the TV, then the account: what is at the top is reached first").toEqual(["menu", "account-button"]);
    for (const one of [...forward, ...backward]) {
      expect(one.size, `${one.id} has a size to be seen`).toBeGreaterThan(0);
      expect(one.ring, `${one.id} shows that the keyboard is on it`).toBe(true);
    }
  });

  for (const size of [SIZES[0]!, SIZES[2]!]) {
    test(`at ${size.name}: what Tab or Shift+Tab reaches is clear of the bar below and of the TV above`, async ({ browser }) => {
      const phone = await pairedPhone(browser, size);
      const behind: string[] = [];
      const walk = async (key: "Tab" | "Shift+Tab", count: number) => {
        for (let press = 0; press < count; press++) {
          await phone.keyboard.press(key);
          const found = await phone.evaluate(() => {
            const element = document.activeElement as HTMLElement | null;
            if (!element || element === document.body || element.closest('[data-testid="tabbar"], .top')) return null;
            const box = element.getBoundingClientRect();
            const bar = document.querySelector('[data-testid="tabbar"]')!.getBoundingClientRect();
            const top = document.querySelector(".phone-ui .top")!.getBoundingClientRect();
            const id = element.dataset.testid ?? element.tagName.toLowerCase();
            if (box.bottom > bar.top + 1) return `${id}: its foot is at ${Math.round(box.bottom)}, and the bar starts at ${Math.round(bar.top)}`;
            if (box.top < top.bottom - 1) return `${id}: its head is at ${Math.round(box.top)}, and the TV's bar goes down to ${Math.round(top.bottom)}`;
            return null;
          });
          if (found) behind.push(`${key} ${press + 1}: ${found}`);
        }
      };
      await walk("Tab", 80);
      await walk("Shift+Tab", 80);
      expect(behind, "what the keyboard reached and the bars cover").toEqual([]);
    });
  }
});
test.describe("a phone used as the screen, held upright", () => {
  async function screen(browser: Browser, size: Size, locale = "en-US", shelves = library): Promise<Page> {
    const tv = await openDevice(browser, phoneAt(size, locale), {}, withLibrary(shelves));
    await tv.goto("/tv");
    await expect(tv.getByTestId("tv-browse-tile").first()).toBeVisible();
    return tv;
  }

  test("with the keyboard open in the search (the page made lower than 480 px), the page stays the phone's: the bar at the foot, the menu not down the left (the owner, 17 Nov)", async ({ browser }) => {
    const size = SIZES[1]!;
    const tv = await screen(browser, size, "en-US");
    await tv.getByTestId("rail-search").tap();
    await expect(tv.locator(".tv-rail[data-bar]")).toHaveCount(1);
    await tv.setViewportSize({ width: size.width, height: 360 });
    await expect(tv.locator(".tv-rail[data-bar]"), "still the phone's bar").toHaveCount(1);
    const bar = (await tv.getByTestId("tv-rail").boundingBox())!;
    expect(bar.width, "along the foot, not down the left").toBeGreaterThanOrEqual(size.width - 1);
    await tv.setViewportSize({ width: size.width, height: size.height });
  });

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

  test("Home opens with one title's poster across the screen: Play starts a film, the list button keeps it, the picture opens its page; a show's button opens its page; a library without pictures has none", async ({ browser }) => {
    const size = SIZES[2]!;
    const pictured = (shelves: typeof library, kind = "movie") => ({ ...shelves, rows: shelves.rows.map((each, r) => ({ ...each, items: each.items.map((item) => ({ ...item, image: "/fixtures/missing.png", ...(r === 0 ? { kind } : {}) })) })) });
    const tv = await screen(browser, size, "en-US", pictured(library));
    const hero = tv.getByTestId("tv-feature");
    await expect(hero).toBeVisible();
    const box = (await hero.boundingBox())!;
    expect(box.width, "across the screen, with the page's own margins").toBeGreaterThan(size.width - 40);
    expect(box.y, "it starts under the sections").toBeLessThan(260);
    await expect(hero.getByRole("heading")).toHaveText("Shelf 1 film 1");
    await expect(tv.locator('[data-testid="tv-browse-tile"][title="Shelf 1 film 1"]'), "the row under it does not show the poster's title again").toHaveCount(0);
    await expect(tv.locator('[data-testid="tv-browse-tile"][title="Shelf 1 film 2"]').first()).toBeVisible();
    await expectFits(tv, "Home with its poster");

    const keep = tv.getByTestId("tv-feature-list");
    await expect(keep).toHaveAttribute("aria-pressed", "false");
    await keep.tap();
    await expect(keep).toHaveAttribute("aria-pressed", "true");
    await keep.tap();
    await expect(keep).toHaveAttribute("aria-pressed", "false");

    await tv.getByTestId("tv-feature-open").tap();
    await expect(tv.getByTestId("tv-detail-title")).toHaveText("Shelf 1 film 1");
    await settled(tv.getByTestId("tv-detail-close"));
    await tv.getByTestId("tv-detail-close").tap();
    await expect(tv.getByTestId("tv-detail")).toHaveCount(0);
    await expect(hero, "the page is where it was left: the poster is still the first thing on it").toBeInViewport();

    await tv.getByTestId("tv-feature-play").tap();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });

    const shows = await screen(browser, size, "en-US", pictured(library, "series"));
    await expect(shows.getByTestId("tv-feature-play")).toHaveText("Episodes");
    await shows.getByTestId("tv-feature-play").tap();
    await expect(shows.getByTestId("tv-detail-title")).toHaveText("Shelf 1 film 1");

    const bare = await screen(browser, size);
    await expect(bare.getByTestId("tv-feature")).toHaveCount(0);
  });

  test("the profile's page scrolls as a whole: its head goes up with the places under it, the page opens at its top, and the remote brings a button of the head back into view", async ({ browser }) => {
    const tv = await screen(browser, { name: "320 by 480", width: 320, height: 480 });
    const rows = tv.locator(".tv-rows");
    await rows.evaluate((element) => element.scrollTo({ top: 600 }));
    await tv.getByTestId("tv-account-chip").tap();
    await expect(tv.getByTestId("tv-browse")).toHaveAttribute("data-view", "profile");
    const head = tv.getByTestId("tv-hero");
    const settings = tv.getByTestId("tv-profile-settings");
    await expect(tv.getByTestId("tv-profile-signin"), "a guest's remote starts on Sign in").toBeFocused();
    expect(await head.evaluate((element) => element.closest(".tv-rows") !== null), "the head is in the page that scrolls").toBe(true);
    await expect(head, "the page opens at its top").toBeInViewport({ ratio: 1 });
    const page = (await rows.boundingBox())!;
    expect(page.y, "what scrolls starts right under the top's buttons").toBeLessThan(80);

    const before = (await head.boundingBox())!.y;
    const by = await rows.evaluate((element) => {
      element.scrollTo({ top: element.scrollHeight });
      return element.scrollTop;
    });
    expect(by, "there is more than a screen of it").toBeGreaterThan(0);
    await expect.poll(async () => Math.round((await head.boundingBox())!.y), { message: "the head went up with the page" }).toBe(Math.round(before - by));
    const gone = (await settings.boundingBox())!;
    expect(gone.y, "Settings went up out of what shows").toBeLessThan(page.y - gone.height / 2);

    await tv.keyboard.press("ArrowRight");
    await expect(settings).toBeFocused();
    await expect.poll(async () => { const box = (await settings.boundingBox())!; return box.y >= page.y && box.y + box.height <= page.y + page.height; }, { message: "Settings is in view again" }).toBe(true);
  });

  test("a page of titles scrolls as a whole: its name and its buttons go up with the titles, and the remote brings a button back into view", async ({ browser }) => {
    const tv = await screen(browser, { name: "320 by 480", width: 320, height: 480 });
    for (let i = 0; i < 5; i++) {
      await tv.locator(`.tv-tile[title="Shelf 2 film ${i + 1}"]`).last().tap();
      await tv.getByTestId("tv-detail-list").tap();
      await settled(tv.getByTestId("tv-detail-close"));
      await tv.getByTestId("tv-detail-close").tap();
      await expect(tv.getByTestId("tv-detail")).toHaveCount(0);
    }
    await tv.getByTestId("rail-list").tap();
    const grid = tv.locator(".tv-grid");
    await expect(grid.locator(".tv-tile")).toHaveCount(5);
    const title = tv.getByTestId("tv-view-title");
    expect(await title.evaluate((element) => element.closest(".tv-grid") !== null), "the page's name is in the grid that scrolls").toBe(true);
    const page = (await grid.boundingBox())!;
    expect(page.y, "what scrolls starts right under the top's buttons").toBeLessThan(80);
    const by = await grid.evaluate((element) => {
      element.scrollTo({ top: element.scrollHeight });
      return element.scrollTop;
    });
    expect(by, "there is more than a screen of it").toBeGreaterThan(0);
    const gone = (await tv.getByTestId("list-edit").boundingBox())!;
    expect(gone.y, "the list's buttons went up out of what shows").toBeLessThan(page.y - gone.height / 2);

    await grid.locator(".tv-tile").last().evaluate((element: HTMLElement) => element.focus({ preventScroll: true }));
    const onAButton = () => tv.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.zone === "chips");
    for (let step = 0; step < 4 && !(await onAButton()); step++) await tv.keyboard.press("ArrowUp");
    expect(await onAButton(), "Up from the titles reaches the list's buttons").toBe(true);
    await expect
      .poll(() => tv.evaluate(({ top, bottom }) => { const box = document.activeElement!.getBoundingClientRect(); return box.top >= top && box.bottom <= bottom; }, { top: page.y, bottom: page.y + page.height }), { message: "the button is in view" })
      .toBe(true);

    const onNow = () => tv.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.testid ?? document.activeElement?.tagName);
    const button = await onNow();
    expect(button).toMatch(/^list-/);
    for (const [size, inGrid] of [[{ width: 480, height: 320 }, false], [{ width: 320, height: 480 }, true]] as const) {
      await tv.setViewportSize(size);
      await expect.poll(() => title.evaluate((element) => element.closest(".tv-grid") !== null), { message: `the head ${inGrid ? "in" : "over"} the grid` }).toBe(inGrid);
      expect(await onNow(), `the remote is still on ${button}`).toBe(button);
    }
  });

  for (const size of [SIZES[0]!, SIZES[2]!]) {
    test(`at ${size.name}: a tap on a title's picture, or on the empty part beside its words, leaves its page open, and its Close button closes it`, async ({ browser }) => {
      const withPictures = { ...library, rows: library.rows.map((each) => ({ ...each, items: each.items.map((item) => ({ ...item, backdrop: "/fixtures/missing.png" })) })) };
      const tv = await screen(browser, size, "en-US", withPictures);
      await tv.getByTestId("tv-browse-tile").first().tap();
      const page = tv.getByTestId("tv-detail");
      await expect(page).toBeVisible();
      await expect(page).toHaveAttribute("data-art", "true");
      await expect(page).toHaveCSS("pointer-events", "auto");
      await settled(tv.getByTestId("tv-detail-close"));
      const wordsBegin = await tv.evaluate(() => document.querySelector(".tv-detail-text")!.getBoundingClientRect().top);
      expect(wordsBegin, "the picture has room above the words").toBeGreaterThan(100);
      const places = [
        { what: "the middle of the picture", x: size.width / 2, y: wordsBegin / 2 },
        { what: "the foot of the picture", x: size.width / 2, y: wordsBegin - 6 },
      ];
      for (const place of places) {
        const under = await tv.evaluate(({ x, y }) => {
          const top = document.elementFromPoint(x, y);
          return top?.matches(".tv-detail, .tv-detail-scroll, .tv-detail-hero") ? "the page" : `${top?.tagName.toLowerCase()}.${top?.className} at ${Math.round(x)},${Math.round(y)}`;
        }, place);
        expect(under, `${place.what} is on the page's own empty part`).toBe("the page");
        await tv.touchscreen.tap(place.x, place.y);
        await tv.waitForTimeout(150);
        await expect(page, place.what).toBeVisible();
      }
      await tv.getByTestId("tv-detail-close").tap();
      await expect(page).toHaveCount(0);
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
      await expect(tv.getByTestId("tv-signin-form-back")).toBeVisible();
      await settled(tv.getByTestId("tv-signin-form-back"));
      await expectFits(tv, `${name}, the way in`, true);
      await tv.getByTestId("tv-signin-form-back").tap();

      await tv.getByTestId("rail-party").tap();
      await expect(tv.getByTestId("tv-back-to-library")).toBeVisible();
      await settled(tv.getByTestId("tv-back-to-library"));
      await expectFits(tv, `${name}, the party`, true);
    });
  }

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
