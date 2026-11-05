import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { openLibrary, pressMenuLine, RawPhone, readPairingCode, test, tvRoot } from "./helpers";

/**
 * A film whose link the place it comes from refuses (an HTTP 502 for its playlist, which is also what a token that has run out can be answered with): the TV is
 * not what failed, so the card does not say so; the title is asked for again by itself, once, because a new look finds a new link; and when that does not help
 * either, the card says that the source did not answer and its Try again asks for the title once more.
 */

/** The film's playlist, which the place it comes from refuses. */
const REFUSED = "/fixtures/hls/refused.m3u8";

/** The page refuses the playlist, and keeps what it sends to the server, to count the times the title is asked for. */
const refuse = async (context: BrowserContext) => {
  await context.route(`**${REFUSED}`, (route) => route.fulfill({ status: 502, contentType: "text/plain", body: "Bad Gateway" }));
  await context.addInitScript(() => {
    const sent: string[] = [];
    (window as unknown as { __sent: string[] }).__sent = sent;
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data: Parameters<WebSocket["send"]>[0]) {
      if (typeof data === "string") sent.push(data);
      return send.call(this, data);
    };
  });
};

/** How many times this page has asked the server to play something (`TV_PLAY_URL`). */
const lookups = (tv: Page) =>
  tv.evaluate(() => (window as unknown as { __sent: string[] }).__sent.filter((each) => each.includes('"TV_PLAY_URL"')).length);

/** A TV that is shown a film whose link is refused, by a phone that says which page it came from. */
async function refusedFilm(browser: Browser, baseURL: string, page: string) {
  const tv = await openLibrary(browser, refuse);
  await pressMenuLine(tv, "rail-connect");
  const phone = await RawPhone.connect(baseURL, await readPairingCode(tv));
  phone.cmd({ type: "LOAD", media: { title: "A refused film", page, stream: { url: REFUSED, type: "hls" } } });
  return { tv, phone };
}

test.describe("a film whose link the source refuses", () => {
  test("is looked up again by itself, and the film that comes plays: no card for it", async ({ browser, baseURL }) => {
    const { tv } = await refusedFilm(browser, baseURL!, `${baseURL}/fixtures/sample.mp4`);
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing", { timeout: 25_000 });
    await expect(tv.getByTestId("tv-error")).toHaveCount(0);
    expect(await lookups(tv)).toBe(1);
  });

  test("says that the source did not answer when the second look does not help, and Try again asks for the title once more", async ({ browser, baseURL }) => {
    const { tv } = await refusedFilm(browser, baseURL!, `${baseURL}/fixtures/no-such-page.html`);
    const card = tv.getByTestId("tv-error");
    await expect(card).toBeVisible({ timeout: 25_000 });
    await expect(card).toContainText("source isn't answering");
    await expect(card).not.toContainText("can't be played on the TV");
    await expect(tvRoot(tv)).toHaveAttribute("data-error", "SOURCE_UNAVAILABLE");
    // The one look that was made by itself is all there is: a card that stays is not asked for again and again.
    await tv.waitForTimeout(1500);
    expect(await lookups(tv)).toBe(1);

    await tv.getByTestId("error-retry").click();
    await expect.poll(() => lookups(tv)).toBe(2);
    await expect(card).toBeVisible({ timeout: 25_000 });
  });
});
