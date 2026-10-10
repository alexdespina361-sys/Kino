import { expect, test } from "@playwright/test";
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
    await expect(phone.getByTestId("player-state")).toContainText("SOURCE_NOT_DIRECTLY_PLAYABLE");
  });

  test("a wrong pairing code is rejected with a clear message", async ({ browser }) => {
    const tv = await openTv(browser);
    const real = await readPairingCode(tv);
    const wrong = real === "000000" ? "000001" : "000000";

    const phone = await (await browser.newContext(PHONE)).newPage();
    await phone.goto("/");
    await phone.getByTestId("code-input").fill(wrong);
    await expect(phone.getByTestId("error")).toHaveText("Invalid or expired code.");
    await expect(tv.getByTestId("pairing-code")).toBeVisible(); // TV still waiting
  });

  test("the TV stays paired across a page reload, and the phone follows", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);

    await tv.reload();
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");
    await tv.getByTestId("unlock").focus();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-paired")).toBeVisible(); // not asking for a new code

    await phone.getByTestId("url-input").fill(`${baseURL}/fixtures/sample.mp4`);
    await phone.getByTestId("play-url").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
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
