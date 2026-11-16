import { expect, type Page } from "@playwright/test";
import type { NormalizedMedia } from "../src/shared";
import { guestStorage, openLibrary, openProfilePlace, openTv, pressMenuLine, RawPhone, readPairingCode, test, tvRoot, tvTime } from "./helpers";

/**
 * The Skip button of an opening, a "previously on" and credits, and the Next episode button that came in place of the Up Next card (the owner, 17 Nov).
 * fixtures/episode.mp4 is two and a half minutes of a test picture: times for anything under two minutes are not believed (shared/skip.ts).
 */

const seek = (tv: Page, to: number) => tv.evaluate((time) => void (document.querySelector("video")!.currentTime = time), to);
const AUTO_SKIP = () => guestStorage({ settings: [{ key: "autoSkip", at: Date.now(), value: true }] });

function episode(extra: Partial<NormalizedMedia> = {}): NormalizedMedia {
  return { title: "Parts · S1 E1", stream: { url: "/fixtures/episode.mp4", type: "mp4" }, ...extra } as NormalizedMedia;
}

function withNext(baseURL: string, extra: Partial<NormalizedMedia> = {}): NormalizedMedia {
  const part = (n: number) => ({ season: 1, episode: n, title: `Part ${n}`, url: `${baseURL}/fixtures/pages/${n === 1 ? "video" : "hls"}.html` });
  return episode({ series: { season: 1, episode: 1, episodes: [part(1), part(2)], next: part(2) }, ...extra });
}

/** Puts `media` on the TV, at `at` seconds, playing. */
async function start(tv: Page, baseURL: string, media: NormalizedMedia, at: number): Promise<RawPhone> {
  const phone = await RawPhone.connect(baseURL, await readPairingCode(tv));
  phone.cmd({ type: "LOAD", media });
  await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
  await seek(tv, at);
  phone.cmd({ type: "PLAY" });
  await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
  return phone;
}

test.describe("the Skip button", () => {
  test("comes as an opening starts, bright: OK skips it, and the phone is told while it is up", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await start(tv, baseURL!, episode({ skip: { intro: { start: 6, end: 40 } } }), 4);
    const button = tv.getByTestId("tv-skip");
    await expect(button).toBeVisible({ timeout: 8_000 });
    await expect(button).toHaveAttribute("data-kind", "intro");
    await expect(button).toHaveAttribute("data-fresh", "true");
    await expect(button).toHaveAttribute("data-counting", "false"); // (skipping by itself is off until the profile turns it on)
    await expect(button).toContainText("Skip intro");
    await expect.poll(() => phone.states.at(-1)?.skip?.kind).toBe("intro");

    await tv.keyboard.press("Enter");
    await expect(button).toHaveCount(0);
    await expect.poll(() => tvTime(tv)).toBeGreaterThanOrEqual(39); // (the button goes at the press; the picture gets there a moment later)
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing"); // OK skipped, and did not pause
    await expect.poll(() => phone.states.at(-1)?.skip).toBeUndefined();
    phone.close();
  });

  test("jumped into, it is quiet: OK is the picture's again, and the phone's Skip still skips", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await start(tv, baseURL!, episode({ skip: { intro: { start: 6, end: 40 } } }), 20);
    const button = tv.getByTestId("tv-skip");
    await expect(button).toBeVisible({ timeout: 8_000 });
    await expect(button).not.toHaveAttribute("data-fresh", /./);
    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "hidden", { timeout: 12_000 }); // with the controls gone, a quiet button is see-through, not gone
    await expect.poll(() => button.evaluate((element) => Number(getComputedStyle(element).opacity))).toBeLessThan(0.7);
    await expect(button).toBeVisible();

    await tv.keyboard.press("Enter");
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await expect(button).toBeVisible(); // (OK paused the picture: it did not skip)

    phone.cmd({ type: "SKIP_SEGMENT" });
    await expect(button).toHaveCount(0);
    await expect.poll(() => tvTime(tv)).toBeGreaterThanOrEqual(39); // (the button goes at the press; the picture gets there a moment later)
    phone.close();
  });

  test("a quiet one is reached with Up, from the picture or from the controls, and pressed with OK", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await start(tv, baseURL!, episode({ skip: { intro: { start: 6, end: 40 } } }), 20);
    const button = tv.getByTestId("tv-skip");
    await expect(button).toBeVisible({ timeout: 8_000 });
    await expect(button).not.toHaveAttribute("data-fresh", /./);

    await tv.keyboard.press("ArrowDown"); // onto the controls
    await expect.poll(() => tv.evaluate(() => Boolean(document.activeElement?.closest(".hud-controls")))).toBe(true);
    await tv.keyboard.press("ArrowUp"); // and up out of them, onto it
    await expect(tv.getByTestId("tv-skip-btn")).toBeFocused();
    await tv.keyboard.press("ArrowRight");
    await expect(tv.getByTestId("tv-skip-dismiss")).toBeFocused();
    await tv.keyboard.press("Escape"); // off it, and the film plays on
    await expect(tv.getByTestId("tv-skip-dismiss")).not.toBeFocused();
    await expect(button).toBeVisible();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");

    await tv.keyboard.press("ArrowUp"); // from the picture
    await expect(tv.getByTestId("tv-skip-btn")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(button).toHaveCount(0);
    await expect.poll(() => tvTime(tv)).toBeGreaterThanOrEqual(39);
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    phone.close();
  });

  test("with \"Skip intros and credits\" on, a \"previously on\" and the opening right after it are both skipped", async ({ browser, baseURL }) => {
    test.setTimeout(45_000);
    const tv = await openTv(browser, undefined, AUTO_SKIP());
    const phone = await start(tv, baseURL!, episode({ skip: { recap: { start: 6, end: 30 }, intro: { start: 30, end: 60 } } }), 4);
    const button = tv.getByTestId("tv-skip");
    await expect(button).toHaveAttribute("data-kind", "recap", { timeout: 8_000 });
    await expect(button).toHaveAttribute("data-kind", "intro", { timeout: 10_000 }); // landed at the opening's start: played into, so it fills too
    await expect(button).toHaveAttribute("data-counting", "true");
    await expect.poll(() => tvTime(tv), { timeout: 10_000 }).toBeGreaterThanOrEqual(59);
    phone.close();
  });

  test("the profile's switch is on the TV's settings, off at first, and turns the fill on", async ({ browser, baseURL }) => {
    const tv = await openLibrary(browser);
    await openProfilePlace(tv, "settings");
    const toggle = tv.getByTestId("tv-autoskip");
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await tv.getByTestId("tv-account-back").click(); // (the settings page has no menu: back to the profile's page, which has)
    await expect(tv.getByTestId("tv-rail")).toBeVisible();
    await pressMenuLine(tv, "rail-connect");
    const phone = await start(tv, baseURL!, episode({ skip: { intro: { start: 6, end: 40 } } }), 4);
    await expect(tv.getByTestId("tv-skip")).toHaveAttribute("data-counting", "true", { timeout: 8_000 });
    phone.close();
  });

  test("with \"Skip intros and credits\" on, it fills up and skips by itself; wound back to before it, it comes again, and Back turns it down", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const tv = await openTv(browser, undefined, AUTO_SKIP());
    const phone = await start(tv, baseURL!, episode({ skip: { intro: { start: 8, end: 40 } } }), 6);
    const button = tv.getByTestId("tv-skip");
    await expect(button).toHaveAttribute("data-counting", "true", { timeout: 8_000 });
    await expect(button.locator("b")).toHaveText(/^[1-5]s$/);
    await expect.poll(() => tvTime(tv), { timeout: 10_000 }).toBeGreaterThanOrEqual(39); // it skipped by itself
    await expect(button).toHaveCount(0);

    await seek(tv, 1); // well before it: the opening is new again
    await expect(button).toHaveAttribute("data-counting", "true", { timeout: 12_000 });
    await tv.keyboard.press("Escape");
    await expect(button).toHaveCount(0);
    await tv.waitForTimeout(6_500); // longer than the fill would have taken
    expect(await tvTime(tv)).toBeLessThan(25); // the opening plays
    await expect(button).toHaveCount(0); // and stays turned down
    phone.close();
  });

  test("comes with times from AniSkip for an anime the look-up recognised, asked for the length of the video, and the pointer presses it", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const asked: URL[] = [];
    await tv.route(
      (url) => url.pathname === "/api/anime/skip",
      (route) => {
        asked.push(new URL(route.request().url()));
        return route.fulfill({ json: { skip: { intro: { start: 8, end: 40 } } } });
      },
    );
    const phone = await start(tv, baseURL!, episode({ anime: { title: "Frieren", season: 1, episode: 3 } }), 6);
    const button = tv.getByTestId("tv-skip");
    await expect(button).toBeVisible({ timeout: 8_000 });
    expect(asked).toHaveLength(1);
    expect(Object.fromEntries(asked[0]!.searchParams)).toEqual({ title: "Frieren", season: "1", episode: "3", length: "150" });

    await tv.getByTestId("tv-skip-btn").click();
    await expect(button).toHaveCount(0);
    await expect.poll(() => tvTime(tv)).toBeGreaterThanOrEqual(39); // (the button goes at the press; the picture gets there a moment later)
    phone.close();
  });
});

test.describe("the Next episode button", () => {
  test("comes as credits that run to the end start, and waits there quietly until the last seconds, when it counts down", async ({ browser, baseURL }) => {
    test.setTimeout(45_000);
    const tv = await openTv(browser);
    const phone = await start(tv, baseURL!, withNext(baseURL!, { skip: { outro: { start: 120, end: 148 } } }), 118);
    const upNext = tv.getByTestId("netflix-upnext");
    await expect(upNext).toBeVisible({ timeout: 8_000 });
    expect(await tvTime(tv)).toBeLessThan(130); // with the credits, not in the last seconds
    await expect(tv.getByTestId("tv-skip")).toHaveCount(0); // (credits that run to the end are the Next episode button's)
    await expect(upNext).toHaveAttribute("data-counting", "false");
    await expect(upNext).toHaveAttribute("data-fresh", "true");
    await expect(upNext).not.toContainText(/\ds/);
    await expect(upNext).toContainText("Part 2");
    await expect.poll(() => phone.states.at(-1)?.upNext).toEqual({ seconds: null });

    await seek(tv, 136);
    await expect(upNext).toHaveAttribute("data-counting", "true");
    expect(Number((await upNext.locator("b").innerText()).replace("s", ""))).toBeLessThanOrEqual(14);
    phone.close();
  });

  test("with \"Skip intros and credits\" on, it fills up as the credits start and plays the next episode", async ({ browser, baseURL }) => {
    test.setTimeout(45_000);
    const tv = await openTv(browser, undefined, AUTO_SKIP());
    const phone = await start(tv, baseURL!, withNext(baseURL!, { skip: { outro: { start: 120, end: 148 } } }), 118);
    const upNext = tv.getByTestId("netflix-upnext");
    await expect(upNext).toHaveAttribute("data-counting", "true", { timeout: 8_000 });
    await expect(upNext.locator("b")).toHaveText(/^[1-5]s$/);
    expect(await tvTime(tv)).toBeLessThan(130);
    await expect(upNext).toHaveCount(0, { timeout: 10_000 });
    await expect.poll(() => tvTime(tv), { timeout: 15_000 }).toBeLessThan(20); // the next episode, from its start
    phone.close();
  });

  test("Back turns down the early one while it is new, and the film plays on", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await start(tv, baseURL!, withNext(baseURL!, { skip: { outro: { start: 120, end: 148 } } }), 118);
    const upNext = tv.getByTestId("netflix-upnext");
    await expect(upNext).toBeVisible({ timeout: 8_000 });
    await tv.keyboard.press("Escape");
    await expect(upNext).toHaveCount(0);
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing"); // (it turned the button down; it did not leave the film)
    phone.close();
  });
});
