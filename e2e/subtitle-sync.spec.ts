import { randomBytes } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { loadOnTv, openPairedPhone, openTv, RawPhone, readPairingCode, test, tvRoot } from "./helpers";

/**
 * The subtitle aligner (src/client/subsync) in a real browser. The film is a tiny HLS stream with sound (fixtures/hls-sound: a test pattern and a
 * tone, VP9/Opus because Chromium here cannot decode H.264), so there is nothing to time: these are about the plumbing - that the aligner starts by
 * itself with a film that plays through hls.js, that it is off for one that does not and when the viewer turned it off, that the phone and the
 * TV can turn it off and on and the choice is kept, and that the server keeps what screens leave each other. What it does to the lines is in the
 * unit tests (session.test.ts) and was measured on real clips (docs/subtitle-sync.md).
 */
const film = (title: string, again = "") => ({
  title,
  stream: { url: `/fixtures/hls-sound/master.m3u8${again}`, type: "hls" as const },
  subtitles: [{ id: "en", label: "English", lang: "en", url: "/fixtures/sample.vtt" }],
});

/** The files of the aligner a page has been given, by name. */
function watchAssets(tv: Page): Map<string, number> {
  const assets = new Map<string, number>();
  tv.on("response", (response) => {
    const at = response.url().indexOf("/subtitle-sync/");
    if (at >= 0) assets.set(response.url().slice(at + "/subtitle-sync/".length), response.status());
  });
  return assets;
}

const prefs = (tv: Page) => tv.evaluate(() => JSON.parse(localStorage.getItem("tv.prefs") ?? "{}") as { subtitleSync?: boolean });

test.describe("the subtitle aligner", () => {
  test("starts by itself with a film that plays through hls.js, and says so", async ({ browser }) => {
    const tv = await openTv(browser);
    const assets = watchAssets(tv);
    const phone = await RawPhone.connect(tv.url().split("/").slice(0, 3).join("/"), await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: film("Tone") });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    phone.cmd({ type: "SET_SUBTITLE", track: 0 });
    phone.cmd({ type: "PLAY" });

    await expect.poll(() => assets.get("1/silero-vad-16k.bin"), { timeout: 30_000 }).toBe(200); // (the voice detector's model, from the immutable folder)
    await expect.poll(() => phone.states.at(-1)?.subtitleSync, { timeout: 30_000 }).toMatch(/^(syncing|synced)$/);
    phone.close();
  });

  test("costs nothing while no subtitles are on: no worker and no model are fetched until one is chosen", async ({ browser }) => {
    const tv = await openTv(browser);
    const assets = watchAssets(tv);
    const workers: string[] = [];
    tv.on("response", (response) => {
      if (/\/assets\/subsync\.worker-/.test(response.url())) workers.push(response.url());
    });
    const phone = await RawPhone.connect(tv.url().split("/").slice(0, 3).join("/"), await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: film("Tone") });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    phone.cmd({ type: "PLAY" });
    await expect.poll(() => phone.states.at(-1)?.subtitleSync).toBe("ready");
    await tv.waitForTimeout(3000);
    expect(await tv.evaluate(() => document.querySelector("video")!.currentTime)).toBeGreaterThan(0.5); // (the film plays all the same)
    expect([...assets.keys()]).toEqual([]);
    expect(workers).toEqual([]);

    phone.cmd({ type: "SET_SUBTITLE", track: 0 });
    await expect.poll(() => assets.get("1/silero-vad-16k.bin"), { timeout: 30_000 }).toBe(200);
    await expect.poll(() => workers.length, { timeout: 30_000 }).toBe(1);
    phone.close();
  });

  test("is left alone when the viewer has turned it off: nothing of it is fetched", async ({ browser }) => {
    const tv = await openTv(browser);
    const assets = watchAssets(tv);
    const chunks: string[] = [];
    tv.on("response", (response) => {
      if (/\/assets\/(start|subsync\.worker)-/.test(response.url())) chunks.push(response.url());
    });
    const phone = await RawPhone.connect(tv.url().split("/").slice(0, 3).join("/"), await readPairingCode(tv));
    phone.cmd({ type: "SET_SUBTITLE_SYNC", on: false });
    phone.cmd({ type: "LOAD", media: film("Tone") });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    phone.cmd({ type: "SET_SUBTITLE", track: 0 });
    phone.cmd({ type: "PLAY" });
    await expect.poll(() => phone.states.at(-1)?.subtitleSync).toBe("off");
    await tv.waitForTimeout(2500);
    expect(await tv.evaluate(() => document.querySelector("video")!.currentTime)).toBeGreaterThan(0.5); // (the film plays all the same)
    expect([...assets.keys()]).toEqual([]);
    expect(chunks).toEqual([]);
    phone.close();
  });

  test("says it is not available for a film that does not play through hls.js, without fetching anything", async ({ browser }) => {
    const tv = await openTv(browser);
    const assets = watchAssets(tv);
    const phone = await RawPhone.connect(tv.url().split("/").slice(0, 3).join("/"), await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: { title: "Sample", stream: { url: "/fixtures/sample.mp4", type: "mp4" }, subtitles: [{ id: "en", label: "English", lang: "en", url: "/fixtures/sample.vtt" }] } });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await expect.poll(() => phone.states.at(-1)?.subtitleSync).toBe("unavailable");
    await tv.waitForTimeout(1000);
    expect([...assets.keys()]).toEqual([]);
    phone.close();
  });

  test("can be turned off and on from the phone, and the TV's menu shows it and does the same; the choice is kept for the next film", async ({ browser }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await loadOnTv(phone, film("Tone"));
    await expect(phone.getByTestId("media-title")).toBeVisible();

    await phone.getByTestId("chip-tracks").click();
    await phone.getByTestId("subtitle-0").click(); // English
    const sync = phone.getByTestId("subtitle-sync");
    await expect(sync).toHaveAttribute("aria-checked", "true");
    await sync.click();
    await expect(sync).toHaveAttribute("aria-checked", "false");
    await expect.poll(async () => (await prefs(tv)).subtitleSync).toBe(false);

    // The TV's own menu says the same, and turns it back on.
    await tv.getByTestId("tv-audio-sub-btn").click();
    const row = tv.locator("[data-key='sub-sync']");
    await expect(row).toBeVisible();
    await expect(row).toContainText("Off");
    await row.click();
    await expect.poll(async () => (await prefs(tv)).subtitleSync).toBe(true);
    await expect(sync).toHaveAttribute("aria-checked", "true"); // (the phone was told)

    // Off again, and the next film starts without it.
    await sync.click();
    await expect.poll(async () => (await prefs(tv)).subtitleSync).toBe(false);
    await loadOnTv(phone, film("Another tone", "?again=1")); // (another address, so the TV really starts another film)
    await expect(phone.getByTestId("media-title")).toContainText("Another tone");
    await phone.getByTestId("chip-tracks").click();
    await phone.getByTestId("subtitle-0").click();
    await expect(phone.getByTestId("subtitle-sync")).toHaveAttribute("aria-checked", "false");
  });
});

test.describe("the server's shared subtitle timings", () => {
  const timing = { v: 1, lines: 40, placed: [[3, -300, -290, 1], [4, -301, -291, 0]] };

  test("keep what a screen leaves, join what another leaves, and give it back", async ({ request }) => {
    const key = randomBytes(16).toString("hex");
    expect((await request.get(`/api/subsync/${key}`)).status()).toBe(404);
    expect((await request.put(`/api/subsync/${key}`, { data: timing })).status()).toBe(204);
    expect((await request.put(`/api/subsync/${key}`, { data: { v: 1, lines: 40, placed: [[9, -250, -240, 1]] } })).status()).toBe(204);
    const kept = await request.get(`/api/subsync/${key}`);
    expect(kept.status()).toBe(200);
    expect(await kept.json()).toEqual({ v: 1, lines: 40, placed: [[3, -300, -290, 1], [4, -301, -291, 0], [9, -250, -240, 1]] });
    // (Another file with the same name has another number of lines: not the same file.)
    expect((await request.put(`/api/subsync/${key}`, { data: { v: 1, lines: 41, placed: [[9, 0, 0, 0]] } })).status()).toBe(409);
  });

  test("take nothing that is not a timing (no words, nothing out of range)", async ({ request }) => {
    const key = randomBytes(16).toString("hex");
    expect((await request.put(`/api/subsync/${key}`, { data: { v: 1, lines: 40, placed: [[3, 99999, 0, 1]] } })).status()).toBe(400);
    expect((await request.put(`/api/subsync/${key}`, { headers: { "content-type": "application/json" }, data: '"Hello there"' })).status()).toBe(400);
    expect((await request.put(`/api/subsync/${key}`, { data: "Hello there" })).status()).toBe(415); // (not JSON at all)
    expect((await request.get(`/api/subsync/not-a-key`)).status()).toBe(400);
    expect((await request.get(`/api/subsync/${key}`)).status()).toBe(404);
  });
});
