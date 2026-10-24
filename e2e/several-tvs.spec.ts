import { expect, type Browser, type Locator, type Page } from "@playwright/test";
import { openPairedPhone, openTv, PHONE, readPairingCode, test, tvRoot, tvTime } from "./helpers";

const sample = (baseURL: string | undefined) => `${baseURL}/fixtures/sample.mp4`;

const rows = (phone: Page) => phone.getByTestId("tv-row");

/** Forget on a TV's row, and the "Forget" that answers the question it asks. */
async function forget(row: Locator) {
  await row.getByTestId("tv-forget").click();
  await row.getByTestId("tv-forget-yes").click();
}

/** The list of TVs: from the menu of a phone that controls one, or (`fromMenu` false) from the first screen of one that does not. */
async function openList(phone: Page, fromMenu = true) {
  if (fromMenu) await phone.getByTestId("menu").click();
  await phone.getByTestId("tvs-open").click();
  await expect(phone.getByTestId("tvs-sheet")).toBeVisible();
}

/** Another TV, connected from the list with the code it shows: the phone controls that one from then on. */
async function addTv(browser: Browser, phone: Page): Promise<Page> {
  const tv = await openTv(browser);
  await openList(phone);
  await phone.getByTestId("tvs-code").fill(await readPairingCode(tv));
  await expect(phone.getByTestId("tvs-sheet")).toHaveCount(0); // the list has done its job once the TV has answered
  await expect(tv.getByTestId("tv-paired")).toBeVisible();
  return tv;
}

test.describe("a phone with several TVs", () => {
  test("a second TV is connected from the list with its code, the phone goes back to the first with none, and both carry on", async ({ browser, baseURL }) => {
    const first = await openTv(browser);
    const phone = await openPairedPhone(browser, first);
    const firstName = await phone.getByTestId("tv-name").innerText();
    await phone.getByTestId("url-input").fill(sample(baseURL));
    await phone.getByTestId("play-url").click();
    await expect(tvRoot(first)).toHaveAttribute("data-state", "playing");

    const second = await addTv(browser, phone);
    await expect(phone.getByTestId("tv-name")).not.toHaveText(firstName);
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");
    await expect(phone.getByTestId("player-state")).toHaveCount(0); // (the second has nothing on)
    const at = await tvTime(first);
    await expect.poll(() => tvTime(first)).toBeGreaterThan(at + 1); // the first goes on, with nobody holding it
    await expect(tvRoot(first)).toHaveAttribute("data-state", "playing");

    await phone.getByTestId("menu").click();
    await expect(phone.getByTestId("tvs-open")).toHaveText("My TVs · 2");
    await phone.getByTestId("tvs-open").click();
    await expect(rows(phone)).toHaveCount(2); // in the order they were connected
    await expect(rows(phone).nth(0)).toContainText(firstName);
    await expect(rows(phone).nth(0)).toHaveAttribute("data-current", "false");
    await expect(rows(phone).nth(0)).toHaveAttribute("data-online", "true");
    await expect(rows(phone).nth(1)).toHaveAttribute("data-current", "true");

    await rows(phone).nth(0).getByTestId("tv-switch").click(); // no code
    await expect(phone.getByTestId("tvs-sheet")).toHaveCount(0);
    await expect(phone.getByTestId("tv-name")).toHaveText(firstName);
    await expect(phone.getByTestId("player-state")).toHaveAttribute("data-state", "playing"); // its remote, on the film that carried on
    await expect(second.getByTestId("tv-paired")).toBeVisible(); // the one it left is still its own
    await expect(second.getByTestId("pairing-code")).toHaveCount(0);

    // The list is the server's: a phone that is opened again has it, and is on the TV it was on.
    await phone.reload();
    await expect(phone.getByTestId("tv-name")).toHaveText(firstName);
    await phone.getByTestId("menu").click();
    await expect(phone.getByTestId("tvs-open")).toHaveText("My TVs · 2");
  });

  test("what the phone presses goes to the TV it controls and to no other", async ({ browser, baseURL }) => {
    const first = await openTv(browser);
    const phone = await openPairedPhone(browser, first);
    await phone.getByTestId("url-input").fill(sample(baseURL));
    await phone.getByTestId("play-url").click();
    await expect(tvRoot(first)).toHaveAttribute("data-state", "playing");

    const second = await addTv(browser, phone);
    await phone.getByTestId("url-input").fill(sample(baseURL));
    await phone.getByTestId("play-url").click();
    await expect(tvRoot(second)).toHaveAttribute("data-state", "playing");

    await phone.getByTestId("pause").click();
    await expect(tvRoot(second)).toHaveAttribute("data-state", "paused");
    await expect(tvRoot(first)).toHaveAttribute("data-state", "playing"); // not this one

    await openList(phone);
    await rows(phone).nth(0).getByTestId("tv-switch").click();
    await expect(phone.getByTestId("player-state")).toHaveAttribute("data-state", "playing");
    await phone.getByTestId("pause").click();
    await expect(tvRoot(first)).toHaveAttribute("data-state", "paused");
  });

  test("a phone that has moved on does not hear what the TV it left is doing, and is not counted among that TV's remotes", async ({ browser, baseURL }) => {
    const first = await openTv(browser);
    const phone = await openPairedPhone(browser, first);
    await addTv(browser, phone); // the phone controls the second now, which has nothing on

    // Another phone takes the first TV from the code on its screen, and plays a video there.
    const code = (await first.getByTestId("tv-join-code").innerText()).replace(/\s/g, "");
    const other = await (await browser.newContext(PHONE)).newPage();
    await other.goto(`/?control=${code}`);
    await expect(other.getByTestId("tv-online")).toHaveText("TV connected");
    await other.getByTestId("url-input").fill(sample(baseURL));
    await other.getByTestId("play-url").click();
    await expect(tvRoot(first)).toHaveAttribute("data-state", "playing");
    const at = await tvTime(first);
    await expect.poll(() => tvTime(first)).toBeGreaterThan(at + 1); // (it has had time to tell anyone who listens)

    await expect(phone.getByTestId("media-title")).toHaveCount(0); // not the remote of a film on a TV it is not controlling
    await expect(phone.getByTestId("player-state")).toHaveCount(0);
    await other.getByTestId("menu").click();
    await expect(other.getByTestId("control-card")).toContainText("1 connected"); // the first phone is not controlling it now
  });

  test("the first screen of a phone that let go of its TV offers the ones it still has: a tap, no code", async ({ browser }) => {
    const first = await openTv(browser);
    const phone = await openPairedPhone(browser, first);
    const firstName = await phone.getByTestId("tv-name").innerText();
    const second = await addTv(browser, phone);

    await phone.getByTestId("menu").click();
    await phone.getByTestId("disconnect").click(); // lets go of the one it controls: the second
    await expect(phone.getByTestId("code-input")).toBeVisible();
    await expect(phone.getByTestId("pair-notice")).toHaveCount(0); // it was asked for
    await expect(second.getByTestId("pairing-code")).toBeVisible(); // that TV offers itself again
    await expect(first.getByTestId("tv-paired")).toBeVisible(); // the other is still the phone's
    await expect(phone.getByTestId("tvs-open")).toHaveText("My TVs");

    await openList(phone, false);
    await expect(rows(phone)).toHaveCount(1);
    await expect(rows(phone)).toContainText(firstName);
    await rows(phone).getByTestId("tv-switch").click();
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");
    await expect(phone.getByTestId("tv-name")).toHaveText(firstName);
    await expect(first.getByTestId("tv-flash")).toHaveText("A phone is connected."); // the TV says that its phone is back
  });

  test("forgetting a TV lets that one go and leaves the others alone; forgetting the last one is the first screen with no list", async ({ browser }) => {
    const first = await openTv(browser);
    const phone = await openPairedPhone(browser, first);
    const firstName = await phone.getByTestId("tv-name").innerText();
    const second = await addTv(browser, phone);
    const secondName = await phone.getByTestId("tv-name").innerText();

    await openList(phone);
    // A tap on Forget asks first, naming the TV; Cancel leaves everything as it was.
    await rows(phone).nth(0).getByTestId("tv-forget").click();
    await expect(phone.getByTestId("tv-forget-ask")).toContainText(`Forget “${firstName}”?`);
    await phone.getByTestId("tv-forget-no").click();
    await expect(phone.getByTestId("tv-forget-ask")).toHaveCount(0);
    await expect(rows(phone)).toHaveCount(2);
    await expect(first.getByTestId("tv-paired")).toBeVisible(); // (nothing was let go)

    await forget(rows(phone).nth(0)); // the first, which it is not controlling
    await expect(rows(phone)).toHaveCount(1);
    await expect(first.getByTestId("pairing-code")).toBeVisible(); // let go: it offers itself again with a new code
    await expect(phone.getByTestId("tvs-sheet")).toBeVisible(); // and the phone stays where it was
    await expect(phone.getByTestId("tv-name")).toHaveText(secondName);
    await expect(second.getByTestId("tv-paired")).toBeVisible();

    await forget(rows(phone).nth(0)); // the one in use, which was the last
    await expect(phone.getByTestId("code-input")).toBeVisible();
    await expect(phone.getByTestId("tvs-sheet")).toHaveCount(0);
    await expect(phone.getByTestId("tvs-open")).toHaveCount(0); // nothing is on a list that is empty
    await expect(phone.getByTestId("pair-notice")).toHaveCount(0); // it was asked for
    await expect(second.getByTestId("pairing-code")).toBeVisible();
  });

  test("a TV's own Disconnect takes it off the phone's list: quietly when the phone had moved on, with a line when it was in use", async ({ browser }) => {
    const first = await openTv(browser);
    const phone = await openPairedPhone(browser, first);
    const second = await addTv(browser, phone);
    const secondName = await phone.getByTestId("tv-name").innerText();

    await first.getByTestId("tv-disconnect").click(); // the TV the phone moved on from
    await expect(first.getByTestId("pairing-code")).toBeVisible();
    await openList(phone);
    await expect(rows(phone)).toHaveCount(1);
    await expect(rows(phone).nth(0)).toContainText(secondName);
    await phone.getByTestId("sheet-close").click();
    await expect(phone.getByTestId("tv-name")).toHaveText(secondName); // still on the second, and nothing was said
    await expect(phone.getByTestId("pair-notice")).toHaveCount(0);

    await second.getByTestId("tv-disconnect").click(); // the TV in use, the last one
    await expect(phone.getByTestId("pair-notice")).toHaveText("This phone is no longer connected to the TV. Enter the code on the TV to connect again.");
    await expect(phone.getByTestId("tvs-open")).toHaveCount(0);
  });

  test("when the TV in use disconnects its phone and another is on the list, the first screen says so and offers that one", async ({ browser }) => {
    const first = await openTv(browser);
    const phone = await openPairedPhone(browser, first);
    const firstName = await phone.getByTestId("tv-name").innerText();
    const second = await addTv(browser, phone);

    await second.getByTestId("tv-disconnect").click();
    await expect(phone.getByTestId("pair-notice")).toBeVisible();
    await expect(phone.getByTestId("tvs-open")).toHaveText("My TVs");
    await openList(phone, false);
    await expect(rows(phone)).toHaveCount(1);
    await expect(rows(phone)).toContainText(firstName);
    await rows(phone).getByTestId("tv-switch").click();
    await expect(phone.getByTestId("tv-name")).toHaveText(firstName);
    await expect(phone.getByTestId("pair-notice")).toHaveCount(0);
  });

  test("the list shows which TVs are on, as they come and go", async ({ browser }) => {
    const first = await openTv(browser);
    const phone = await openPairedPhone(browser, first);
    await addTv(browser, phone);
    await openList(phone);
    await expect(rows(phone).nth(0)).toHaveAttribute("data-online", "true");
    await expect(rows(phone).nth(0)).toContainText("Online");

    await first.goto("about:blank"); // switched off
    await expect(rows(phone).nth(0)).toHaveAttribute("data-online", "false");
    await expect(rows(phone).nth(0)).toContainText("Offline");
    await expect(rows(phone).nth(1)).toHaveAttribute("data-online", "true"); // (the one in use is on)

    await first.goto("/tv"); // and on again: it is the phone's still, and says so by itself
    await expect(rows(phone).nth(0)).toHaveAttribute("data-online", "true");
  });

  test("the TV in use is named from the list; the name is on the list and in the header, and it is kept", async ({ browser }) => {
    const first = await openTv(browser);
    const phone = await openPairedPhone(browser, first);
    const firstName = await phone.getByTestId("tv-name").innerText();
    await addTv(browser, phone);

    await openList(phone);
    await phone.getByTestId("tv-rename").fill("Living room");
    await phone.getByTestId("tv-rename").press("Enter");
    await expect(phone.getByTestId("tv-name")).toHaveText("Living room");
    await expect(rows(phone).nth(1)).toContainText("Living room");
    await expect(rows(phone).nth(0)).toContainText(firstName);

    await phone.reload();
    await expect(phone.getByTestId("tv-name")).toHaveText("Living room"); // the server's name, not the page's

    await openList(phone);
    await phone.getByTestId("tv-rename").fill("   "); // nothing: the TV is called what it was
    await phone.getByTestId("tv-rename").press("Enter");
    await expect(phone.getByTestId("tv-name")).not.toHaveText("Living room");
    await expect(phone.getByTestId("tv-name")).toHaveText(/^TV [0-9A-Z]{4}$/);
  });

  test("a name given on one phone is the TV's name on the other phone too", async ({ browser }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await phone.getByTestId("menu").click();
    await phone.getByTestId("control-open").click(); // (folded under a row of the sheet until it is wanted)
    const code = (await phone.getByTestId("control-code").innerText()).replace(/\s/g, "");
    const other = await (await browser.newContext(PHONE)).newPage();
    await other.goto(`/?control=${code}`); // what scanning the QR code in the menu opens
    await expect(other.getByTestId("tv-online")).toHaveText("TV connected");

    await openList(phone, false);
    await phone.getByTestId("tv-rename").fill("Living room");
    await phone.getByTestId("tv-rename").press("Enter");
    await expect(other.getByTestId("tv-name")).toHaveText("Living room");
  });

  test("a list of eight TVs is full: it says so and has no field for a ninth, until one is forgotten", async ({ browser }) => {
    const first = await openTv(browser);
    const phone = await openPairedPhone(browser, first);
    for (let n = 1; n < 8; n++) await addTv(browser, phone);
    await openList(phone);
    await expect(rows(phone)).toHaveCount(8);
    await expect(phone.getByTestId("tvs-full")).toBeVisible();
    await expect(phone.getByTestId("tvs-code")).toHaveCount(0);

    await forget(rows(phone).nth(0));
    await expect(rows(phone)).toHaveCount(7);
    await expect(phone.getByTestId("tvs-full")).toHaveCount(0);
    await expect(phone.getByTestId("tvs-code")).toBeVisible();
    await expect(first.getByTestId("pairing-code")).toBeVisible(); // the one forgotten offers itself again
  });

  test("the phone's Back button closes the list without leaving the remote", async ({ browser }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    const address = phone.url();
    await openList(phone);
    await phone.goBack();
    await expect(phone.getByTestId("tvs-sheet")).toHaveCount(0);
    expect(phone.url()).toBe(address);
    await expect(phone.getByTestId("tv-name")).toBeVisible();
  });

  test("a code that is wrong is said in the list, which stays open for the next try", async ({ browser }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await openList(phone);
    await phone.getByTestId("tvs-code").fill("000000");
    await expect(phone.getByTestId("tvs-error")).toBeVisible();
    await expect(phone.getByTestId("tvs-sheet")).toBeVisible();
    await expect(phone.getByTestId("tvs-code")).toHaveValue(""); // the digits are of no use again
    await phone.getByTestId("sheet-close").click();
    await expect(phone.getByTestId("error")).toHaveCount(0); // what went wrong in there is not for the page behind it
  });

  test("the list fits a small phone: nothing scrolls sideways, and every row and the field for a code are within reach", async ({ browser }) => {
    const first = await openTv(browser);
    const phone = await (await browser.newContext({ ...PHONE, viewport: { width: 320, height: 568 }, screen: { width: 320, height: 568 } })).newPage();
    await phone.goto("/");
    await phone.getByTestId("code-input").fill(await readPairingCode(first));
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");
    await addTv(browser, phone);
    await addTv(browser, phone);
    await openList(phone);
    await expect(rows(phone)).toHaveCount(3);
    await phone.evaluate(() => Promise.allSettled(document.getAnimations().map((animation) => animation.finished))); // (the sheet slides up: measured when it has)

    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const row of await rows(phone).all()) {
      const box = (await row.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(320);
      expect(box.height).toBeGreaterThanOrEqual(44); // a finger fits on it
    }
    const sheet = (await phone.getByTestId("tvs-sheet").boundingBox())!;
    expect(sheet.y).toBeGreaterThanOrEqual(0); // the sheet is not taller than the screen: what does not fit in it is scrolled
    expect(sheet.y + sheet.height).toBeLessThanOrEqual(568);
    await phone.getByTestId("tvs-code").scrollIntoViewIfNeeded();
    const field = (await phone.getByTestId("tvs-code").boundingBox())!;
    expect(field.y).toBeGreaterThanOrEqual(sheet.y);
    expect(field.y + field.height).toBeLessThanOrEqual(sheet.y + sheet.height);
    expect(field.x).toBeGreaterThanOrEqual(0);
    expect(field.x + field.width).toBeLessThanOrEqual(320);

    // The question that Forget asks fits the row as well: its two answers side by side, inside it, each a finger's size.
    await rows(phone).nth(0).getByTestId("tv-forget").click();
    const ask = (await phone.getByTestId("tv-forget-ask").boundingBox())!;
    expect(ask.x).toBeGreaterThanOrEqual(0);
    expect(ask.x + ask.width).toBeLessThanOrEqual(320);
    for (const answer of ["tv-forget-yes", "tv-forget-no"]) {
      const box = (await phone.getByTestId(answer).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(ask.x);
      expect(box.x + box.width).toBeLessThanOrEqual(ask.x + ask.width + 0.5);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
