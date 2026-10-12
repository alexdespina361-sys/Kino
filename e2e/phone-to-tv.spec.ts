import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { openPairedPhone, openTv, PHONE, RawPhone, readPairingCode, tvRoot, tvTime } from "./helpers";

test.describe("phone UI -> server -> TV player", () => {
  test("MP4: pair, load, play, pause, seek, stop", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);

    // The TV leaves the pairing screen once paired.
    await expect(tv.getByTestId("tv-paired")).toBeVisible();

    await phone.getByTestId("url-input").fill(`${baseURL}/fixtures/sample.mp4`);
    await phone.getByTestId("play-url").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    await expect(phone.getByTestId("player-state")).toHaveAttribute("data-state", "playing");

    await phone.getByTestId("pause").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await expect(phone.getByTestId("player-state")).toHaveAttribute("data-state", "paused");

    // Seek forward with +10 s from the paused position; the phone must show the TV's reported time.
    const before = await tvTime(tv);
    await phone.getByRole("button", { name: "Forward 10 seconds" }).click();
    await expect.poll(() => tvTime(tv)).toBeGreaterThan(before + 9);
    await expect(phone.getByTestId("time")).toHaveAttribute("data-duration", /^(29|30)$/); // a 30 s clip
    await expect.poll(async () => Number(await phone.getByTestId("time").getAttribute("data-current"))).toBeGreaterThanOrEqual(10);

    await phone.getByTestId("play").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    await expect.poll(() => tvTime(tv)).toBeGreaterThan(before + 10.5);

    // Speed controls live in a sheet
    await phone.getByTestId("chip-speed").click();
    await phone.getByTestId("speed-1.5").click();
    await expect(phone.getByTestId("speed-1.5")).toHaveClass(/active/);
    await expect.poll(() => tv.evaluate(() => document.querySelector("video")!.playbackRate)).toBe(1.5);
    await phone.getByTestId("sheet-close").click();

    await phone.getByTestId("stop").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "idle");
    await expect(phone.getByTestId("url-input")).toBeVisible(); // back to the picker
  });

  test("the phone's own Back button closes a sheet, then a page of the account, and does not leave the remote", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await phone.getByTestId("url-input").fill(`${baseURL}/fixtures/sample.mp4`);
    await phone.getByTestId("play-url").click();
    await expect(phone.getByTestId("player-state")).toHaveAttribute("data-state", "playing");
    const address = phone.url();

    await phone.getByTestId("chip-speed").click();
    await expect(phone.getByTestId("speed-sheet")).toBeVisible();
    await phone.goBack();
    await expect(phone.getByTestId("speed-sheet")).toHaveCount(0);
    expect(phone.url()).toBe(address);
    await expect(phone.getByTestId("player-state")).toBeVisible();

    // A sheet closed by its own button leaves nothing behind: the next Back is not wasted on an entry that is already gone.
    await phone.getByTestId("chip-speed").click();
    await phone.getByTestId("sheet-close").click();
    await expect(phone.getByTestId("speed-sheet")).toHaveCount(0);
    await expect.poll(() => phone.evaluate(() => history.state)).toBeNull();

    // The account's pages go back one at a time, and the last Back closes it.
    await phone.getByTestId("account-button").click();
    await phone.getByTestId("menu-settings").click();
    await expect(phone.getByTestId("settings-page")).toBeVisible();
    await phone.goBack();
    await expect(phone.getByTestId("settings-page")).toHaveCount(0);
    await expect(phone.getByTestId("account-screen")).toBeVisible();
    await phone.goBack();
    await expect(phone.getByTestId("account-screen")).toHaveCount(0);
    await expect(phone.getByTestId("player-state")).toBeVisible();
    expect(phone.url()).toBe(address);
  });

  test("the remote follows the end of the picture: the next episode's countdown with a Cancel that reaches the TV, then Finished", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const tv = await openTv(browser);
    const raw = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    await expect(tv.getByTestId("tv-join-code")).toBeVisible();
    const control = (await tv.getByTestId("tv-join-code").textContent())!.replace(/\s/g, ""); // the code that lets a second phone in
    const episode = (n: number) => ({ season: 1, episode: n, title: `Part ${n}`, url: `${baseURL}/fixtures/pages/${n === 1 ? "video" : "hls"}.html` });
    // (fixtures/long.mp4 is forty seconds: the card keeps away from anything of thirty or less.)
    raw.cmd({ type: "LOAD", media: { title: "Parts · S1 E1", stream: { url: "/fixtures/long.mp4", type: "mp4" }, series: { season: 1, episode: 1, episodes: [episode(1), episode(2)], next: episode(2) } } });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");

    const phone = await (await browser.newContext(PHONE)).newPage();
    await phone.goto("/");
    await phone.getByTestId("code-input").fill(control);
    const line = phone.getByTestId("player-state");
    await expect(line).toHaveText("Paused");
    const seek = (to: number) => tv.evaluate((time) => void (document.querySelector("video")!.currentTime = time), to);

    await seek(24);
    raw.cmd({ type: "PLAY" });
    await expect(line).toHaveText(/^Next episode in \d+s$/);
    await expect(tv.getByTestId("netflix-upnext")).toBeVisible();
    await phone.getByTestId("upnext-cancel").click();
    await expect(tv.getByTestId("netflix-upnext")).toHaveCount(0); // turned down on the TV too, so nothing starts by itself
    await expect(line).toHaveText(/^Playing on /);
    await expect(phone.getByTestId("upnext-cancel")).toHaveCount(0);

    await seek(38.8);
    await expect(tv.getByTestId("tv-end")).toBeVisible({ timeout: 15_000 });
    await expect(line).toHaveText("Finished");
    raw.close();
  });

  test("HLS: load and play through hls.js, then seek and stop", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);

    await phone.getByTestId("url-input").fill(`${baseURL}/fixtures/hls/master.m3u8`);
    await phone.getByTestId("play-url").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");

    await phone.getByTestId("pause").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await phone.getByRole("button", { name: "Forward 10 seconds" }).click();
    await expect.poll(() => tvTime(tv)).toBeGreaterThan(9);

    await phone.getByTestId("stop").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "idle");
  });

  test("a source that cannot be played directly is reported, not hidden", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);

    await phone.getByTestId("url-input").fill(`${baseURL}/fixtures/does-not-exist.mp4`);
    await phone.getByTestId("play-url").click();

    await expect(tvRoot(tv)).toHaveAttribute("data-state", "error");
    await expect(tvRoot(tv)).toHaveAttribute("data-error", "SOURCE_NOT_DIRECTLY_PLAYABLE");
    await expect(phone.getByTestId("player-state")).toContainText("This video can't be played on the TV."); // in words, not as the code the TV reported
    await expect(phone.getByTestId("player-state")).toHaveAttribute("data-error", "SOURCE_NOT_DIRECTLY_PLAYABLE");
  });

  test("a wrong pairing code is rejected with a clear message", async ({ browser }) => {
    const tv = await openTv(browser);
    const real = await readPairingCode(tv);
    const wrong = real === "000000" ? "000001" : "000000";

    const phone = await (await browser.newContext(PHONE)).newPage();
    await phone.goto("/");
    await phone.getByTestId("code-input").fill(wrong);
    await expect(phone.getByTestId("error")).toHaveText("Invalid or expired code.");
    await expect(phone.getByTestId("code-input")).toHaveValue(""); // cleared for the next try, with the keyboard still up
    await expect(phone.getByTestId("code-input")).toBeFocused();
    await expect(tv.getByTestId("pairing-code")).toBeVisible(); // TV still waiting
  });

  test("the TV stays paired across a page reload, and the phone follows", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);

    await tv.reload();
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");
    await expect(tv.getByTestId("rail-connect")).toHaveAttribute("data-badged", "true"); // the reloaded page opens on the library, which says so in its menu
    await tv.getByTestId("rail-connect").click();
    await expect(tv.getByTestId("tv-paired")).toBeVisible(); // not asking for a new code

    await phone.getByTestId("url-input").fill(`${baseURL}/fixtures/sample.mp4`);
    await phone.getByTestId("play-url").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
  });

  test("a TV page opened again in the middle of a video is put back on it, paused where it was, and the phone is still connected", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await phone.getByTestId("url-input").fill(`${baseURL}/fixtures/sample.mp4`);
    await phone.getByTestId("play-url").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    await phone.getByTestId("pause").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await phone.getByRole("button", { name: "Forward 10 seconds" }).click();
    await expect.poll(() => tvTime(tv)).toBeGreaterThan(9);
    const left = await tvTime(tv);

    // The browser is quit and opened again: the TV is paired, and on the video it was on, a press away from carrying on.
    await tv.reload();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    expect(Math.abs((await tvTime(tv)) - left)).toBeLessThan(2);
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");
    await expect(phone.getByTestId("player-state")).toHaveAttribute("data-state", "paused");

    await phone.getByTestId("play").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    await expect.poll(() => tvTime(tv)).toBeGreaterThan(left + 1);
  });

  test("a TV page opened again after the video was stopped on the phone, or left on the TV, opens on the library as before", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await phone.getByTestId("url-input").fill(`${baseURL}/fixtures/sample.mp4`);
    await phone.getByTestId("play-url").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    await phone.getByTestId("stop").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "idle");

    await tv.reload();
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "idle");
    await tv.waitForTimeout(1500); // (a put-back would have started by now)
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "idle");
  });

  test("the phone stays paired across a page reload", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await phone.reload();
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");
    await phone.getByTestId("url-input").fill(`${baseURL}/fixtures/sample.mp4`);
    await phone.getByTestId("play-url").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
  });

  test("the TV and the phone stay paired when the browser forgets its page storage, or its cookies, and keeps the other", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    const ids = (page: typeof tv) => page.evaluate(() => ({ stored: localStorage.getItem("tv.deviceId") ?? localStorage.getItem("controller.id"), cookie: document.cookie }));

    // Both ids sit in the cookies as well as in the page's storage.
    expect((await ids(tv)).cookie).toMatch(/tv\.deviceId=tv_/);
    expect((await ids(phone)).cookie).toMatch(/controller\.id=ctl_/);

    // A browser that wipes the page's storage when it closes: the cookies bring the ids back, and the storage is filled in again.
    await tv.evaluate(() => localStorage.removeItem("tv.deviceId"));
    await phone.evaluate(() => localStorage.removeItem("controller.id"));
    await tv.reload();
    await phone.reload();
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");
    await expect(tv.getByTestId("rail-connect")).toHaveAttribute("data-badged", "true"); // paired: the library's menu says so, and no new code was asked for
    expect((await ids(tv)).stored).toMatch(/^tv_/);
    expect((await ids(phone)).stored).toMatch(/^ctl_/);

    // And one that clears its cookies and keeps the storage.
    await tv.context().clearCookies();
    await phone.context().clearCookies();
    await tv.reload();
    await phone.reload();
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");
    await expect(tv.getByTestId("rail-connect")).toHaveAttribute("data-badged", "true");
    expect((await ids(tv)).cookie).toMatch(/tv\.deviceId=tv_/);

    await phone.getByTestId("url-input").fill(`${baseURL}/fixtures/sample.mp4`);
    await phone.getByTestId("play-url").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
  });

  test("when the TV goes away the remote says so and offers another TV, instead of buttons that go nowhere", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await phone.getByTestId("url-input").fill(`${baseURL}/fixtures/sample.mp4`);
    await phone.getByTestId("play-url").click();
    await expect(phone.getByTestId("player-state")).toBeVisible();

    await tv.close();
    await expect(phone.getByTestId("tv-online")).toHaveText("TV disconnected");
    await expect(phone.getByTestId("tv-away")).toContainText("The TV is offline");
    await expect(phone.getByTestId("player-state")).toHaveCount(0);

    // The way out is the list of TVs, where another one is connected with its code. The one that is off stays on the list: it comes back by itself.
    const other = await openTv(browser);
    await phone.getByTestId("connect-another").click();
    await expect(phone.getByTestId("tvs-sheet")).toBeVisible();
    await expect(phone.getByTestId("tv-row")).toHaveCount(1);
    await expect(phone.getByTestId("tv-row")).toHaveAttribute("data-online", "false");
    await phone.getByTestId("tvs-code").fill(await readPairingCode(other));
    await expect(phone.getByTestId("tvs-sheet")).toHaveCount(0);
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");
    await expect(phone.getByTestId("pair-notice")).toHaveCount(0);
    await phone.getByTestId("menu").click();
    await expect(phone.getByTestId("tvs-open")).toHaveText("My TVs · 2");
  });

  test("the TV's name and its state fit the header of a narrow phone", async ({ browser }) => {
    const tv = await openTv(browser);
    const phone = await (await browser.newContext({ ...PHONE, viewport: { width: 320, height: 568 }, screen: { width: 320, height: 568 } })).newPage();
    await phone.goto("/");
    await phone.getByTestId("code-input").fill(await readPairingCode(tv));
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");
    expect(await phone.getByTestId("tv-name").evaluate((name) => name.scrollWidth - name.clientWidth)).toBeLessThanOrEqual(0); // not cut short
    expect(await phone.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  });
});

test.describe("paste a page link: the server resolves it, the TV plays it", () => {
  test("a page with an ordinary <video>: playing, titled from the page, clutter never reaches the TV", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);

    await phone.getByTestId("url-input").fill(`${baseURL}/fixtures/pages/video.html`);
    await phone.getByTestId("play-url").click();

    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    await expect(phone.getByTestId("media-title")).toHaveText("Fixture Movie (HTML5 video)");
    await expect(phone.getByTestId("player-state")).toHaveAttribute("data-state", "playing");
    await expect(tv.getByText("BUY NOW")).toHaveCount(0); // the source page's ad never appears on the TV
  });

  test("a page that only declares its HLS stream in JSON-LD plays through hls.js", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await phone.getByTestId("url-input").fill(`${baseURL}/fixtures/pages/hls.html`);
    await phone.getByTestId("play-url").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    await expect(phone.getByTestId("media-title")).toHaveText("Fixture HLS Stream");
  });

  test("an unsupported page fails gracefully with a clear message and leaves the TV alone", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await phone.getByTestId("url-input").fill(`${baseURL}/fixtures/pages/none.html`);
    await phone.getByTestId("play-url").click();
    await expect(phone.getByTestId("resolve-status")).toHaveText(
      "Couldn't find a compatible video source. This website is currently unsupported.",
    );
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "idle");
  });

  test("Paste plays a copied link at once, and only puts other text in the box", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await phone.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseURL! });

    await phone.evaluate(() => navigator.clipboard.writeText("just some words"));
    await phone.getByTestId("paste").click();
    await expect(phone.getByTestId("url-input")).toHaveValue("just some words");
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "idle"); // not a link: nothing was sent

    await phone.getByRole("button", { name: "Clear" }).click();
    await phone.evaluate((link) => navigator.clipboard.writeText(`Watch this ${link} !!`), `${baseURL}/fixtures/sample.mp4`);
    await phone.getByTestId("paste").click(); // a link in a sentence: found, and sent without the second tap
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    await expect(phone.getByTestId("player-state")).toHaveAttribute("data-state", "playing");
  });

  test("a link that isn't http(s) gets a plain-language error", async ({ browser }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await phone.getByTestId("url-input").fill("file:///etc/passwd");
    await phone.getByTestId("play-url").click();
    await expect(phone.getByTestId("resolve-status")).toHaveText("That doesn't look like a link I can open.");
  });
});

test("raw protocol: LOAD, PLAY, PAUSE, SEEK 10, STOP against the real TV player", async ({ browser, baseURL }) => {
  const tv = await openTv(browser);
  const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
  await expect(tv.getByTestId("tv-paired")).toBeVisible();

  phone.cmd({ type: "LOAD", media: { title: "Sample", stream: { url: "/fixtures/sample.mp4", type: "mp4" } } });
  // LOAD alone loads: the TV is ready and paused at 0 with a known duration, not playing.
  await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
  expect(await tvTime(tv)).toBe(0);
  expect(await tv.evaluate(() => document.querySelector("video")!.duration)).toBeGreaterThan(29);

  phone.cmd({ type: "PLAY" });
  await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");

  phone.cmd({ type: "PAUSE" });
  await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");

  phone.cmd({ type: "SEEK", time: 10 });
  await expect.poll(() => tvTime(tv)).toBeGreaterThanOrEqual(9.5);
  await expect.poll(() => tvTime(tv)).toBeLessThan(11);

  phone.cmd({ type: "STOP" });
  await expect(tvRoot(tv)).toHaveAttribute("data-state", "idle");

  // The phone was told about each real state the TV reached.
  const seen = new Set(phone.states.map((s) => s.state));
  for (const state of ["loading", "paused", "playing", "idle"] as const) expect(seen).toContain(state);
  phone.close();
});

test("media with subtitles: loads subtitles on TV, supports SET_SUBTITLE and SET_SPEED", async ({ browser, baseURL }) => {
  const tv = await openTv(browser);
  const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));

  phone.cmd({
    type: "LOAD",
    media: {
      title: "Sample with Subs",
      stream: { url: "/fixtures/sample.mp4", type: "mp4" },
      subtitles: [
        { id: "sub-en", label: "English", lang: "en", url: "/fixtures/sample.vtt" },
      ],
    },
  });

  await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
  // Check TV attached the track element
  await expect.poll(() => tv.evaluate(() => document.querySelectorAll("video track").length)).toBe(1);

  // Switch subtitle on
  phone.cmd({ type: "SET_SUBTITLE", track: 0 });
  await expect.poll(() => tv.evaluate(() => document.querySelector("video")!.textTracks[0]?.mode)).toBe("hidden");

  // Switch subtitle off
  phone.cmd({ type: "SET_SUBTITLE", track: -1 });
  await expect.poll(() => tv.evaluate(() => document.querySelector("video")!.textTracks[0]?.mode)).toBe("disabled");

  // Speed change via command
  phone.cmd({ type: "SET_SPEED", rate: 1.25 });
  await expect.poll(() => tv.evaluate(() => document.querySelector("video")!.playbackRate)).toBe(1.25);

  phone.cmd({ type: "STOP" });
  await expect(tvRoot(tv)).toHaveAttribute("data-state", "idle");
  phone.close();
});

test("TV screen interactive controls: stop button on TV browser", async ({ browser, baseURL }) => {
  const tv = await openTv(browser);
  const phone = await openPairedPhone(browser, tv);

  await phone.getByTestId("url-input").fill(`${baseURL}/fixtures/sample.mp4`);
  await phone.getByTestId("play-url").click();
  await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");

  // Clicking STOP directly on the TV browser stops playback (a mouse move wakes the overlay, which hides itself while you watch)
  await tv.mouse.move(400, 300);
  await tv.getByTitle("Stop playback").click();
  await expect(tvRoot(tv)).toHaveAttribute("data-state", "idle");
  await expect(phone.getByTestId("url-input")).toBeVisible();
});

test.describe("a sheet on the phone is pulled down to close", () => {
  /** A sheet open on a phone that is playing something: the speed list, which has an option for every rate. */
  const withSheet = async (browser: Browser, baseURL: string, height = 844) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await phone.setViewportSize({ width: 390, height });
    await phone.getByTestId("url-input").fill(`${baseURL}/fixtures/sample.mp4`);
    await phone.getByTestId("play-url").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    await phone.getByTestId("chip-speed").click();
    const sheet = phone.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await slidUp(sheet);
    // Marks the page, so that a reload shows; and notes whether the page kept the touches for itself (a pull left to the browser is a refresh).
    await phone.evaluate(() => {
      const w = window as unknown as { kept: boolean; moves: boolean[] };
      w.kept = true;
      w.moves = [];
      window.addEventListener("touchmove", (event) => w.moves.push(event.defaultPrevented));
    });
    return { tv, phone, sheet };
  };

  /**
   * A finger put down at `from`, moved `by` pixels down in `steps` moves `every` milliseconds apart (through the browser's own input), and let go.
   * Each touch carries the time it happened at, so how fast the finger went is what is written here, not how busy the machine was.
   */
  const pull = async (phone: Page, from: { x: number; y: number }, by: number, { steps = 10, every = 16 } = {}) => {
    const client = await phone.context().newCDPSession(phone);
    const began = Date.now() / 1000;
    const send = (type: "touchStart" | "touchMove" | "touchEnd", y: number, after: number) =>
      client.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: from.x, y }], timestamp: began + after / 1000 });
    await send("touchStart", from.y, 0);
    for (let step = 1; step <= steps; step++) {
      await send("touchMove", from.y + (by * step) / steps, step * every);
      await phone.waitForTimeout(every);
    }
    await send("touchEnd", from.y + by, steps * every);
    await client.detach();
  };
  /** The sheet has finished sliding up, so it is where it will stay (a busy machine can hold the slide back for a while). */
  const slidUp = (sheet: Locator) => sheet.evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished)).then(() => undefined));

  const gripOf = async (sheet: Locator) => {
    const box = (await sheet.locator(".sheet-grip").boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const state = (phone: Page) => phone.evaluate(() => ({ kept: (window as unknown as { kept?: boolean }).kept === true, moves: (window as unknown as { moves: boolean[] }).moves }));

  test("pulled well down, or flicked, the sheet goes, and the page is not reloaded", async ({ browser, baseURL }) => {
    const { phone, sheet } = await withSheet(browser, baseURL!);
    expect(await phone.evaluate(() => document.documentElement.classList.contains("sheet-open"))).toBe(true); // (the browser's pull to refresh is off while a sheet is up)
    expect(await phone.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY)).toBe("contain");

    await pull(phone, await gripOf(sheet), 260, { steps: 12, every: 30 }); // a slow, long pull
    await expect(sheet).toHaveCount(0);
    const after = await state(phone);
    expect(after.kept).toBe(true); // still the same page
    expect(after.moves.length).toBeGreaterThan(0);
    expect(after.moves.every(Boolean)).toBe(true); // every move of the pull was the sheet's, none was left to the browser
    expect(await phone.evaluate(() => document.documentElement.classList.contains("sheet-open"))).toBe(false);

    await phone.getByTestId("chip-speed").click(); // and the next one opens as usual, then goes with a flick
    const again = phone.getByRole("dialog");
    await expect(again).toBeVisible();
    await slidUp(again);
    await pull(phone, await gripOf(again), 100, { steps: 2, every: 10 }); // short, but fast (50 px in 10 ms)
    await expect(again).toHaveCount(0);
    expect((await state(phone)).kept).toBe(true);
  });

  test("pulled a little and let go, it springs back and stays open", async ({ browser, baseURL }) => {
    const { phone, sheet } = await withSheet(browser, baseURL!);
    const top = (await sheet.boundingBox())!.y;
    await pull(phone, await gripOf(sheet), 50, { steps: 5, every: 40 });
    await expect(sheet).toBeVisible();
    await expect.poll(async () => Math.round((await sheet.boundingBox())!.y)).toBe(Math.round(top)); // back where it was
    expect((await state(phone)).kept).toBe(true);
    await phone.getByTestId("speed-1.5").click(); // and it still works
    await expect(phone.getByTestId("speed-1.5")).toHaveClass(/active/);
  });

  test("on a list that is scrolled down a pull is the list scrolling; at the top of it, the sheet", async ({ browser, baseURL }) => {
    const { phone, sheet } = await withSheet(browser, baseURL!, 380); // low enough for the options not to fit
    const body = sheet.locator(".sheet-body");
    expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await body.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    const scrolled = await body.evaluate((el) => el.scrollTop);
    expect(scrolled).toBeGreaterThan(20);

    const box = (await body.boundingBox())!;
    await pull(phone, { x: box.x + box.width / 2, y: box.y + 40 }, 120, { steps: 10, every: 20 });
    await expect(sheet).toBeVisible(); // the list went back up under the finger; the sheet stayed
    expect(await body.evaluate((el) => el.scrollTop)).toBeLessThan(scrolled);

    await body.evaluate((el) => el.scrollTo(0, 0));
    await pull(phone, { x: box.x + box.width / 2, y: box.y + 40 }, 260, { steps: 12, every: 30 });
    await expect(sheet).toHaveCount(0); // at the top, the same pull is the sheet's
    expect((await state(phone)).kept).toBe(true);
  });

  test("a finger that starts on a field is the field's: the sheet does not follow it", async ({ browser, baseURL }) => {
    const { phone, sheet } = await withSheet(browser, baseURL!);
    await phone.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await phone.getByTestId("change-video").click();
    const link = phone.getByTestId("link-sheet");
    await expect(link).toBeVisible();
    await slidUp(link);
    const top = Math.round((await link.boundingBox())!.y);
    const field = (await phone.getByTestId("url-input").boundingBox())!;

    await pull(phone, { x: field.x + field.width / 2, y: field.y + field.height / 2 }, 260, { steps: 12, every: 30 });
    await expect(link).toBeVisible();
    expect(Math.round((await link.boundingBox())!.y)).toBe(top);
    expect((await state(phone)).moves.some(Boolean)).toBe(false); // none of the pull was taken from the page

    await pull(phone, await gripOf(link), 260, { steps: 12, every: 30 }); // the same pull from the grip still closes it
    await expect(link).toHaveCount(0);
  });
});
