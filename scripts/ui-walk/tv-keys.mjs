// The TV by key only (arrows, OK, Back), the way a remote reaches things: for each screen a picture of it with the remote where it would be, and a
// check of that: something is focused, it is on the screen and it shows (:focus-visible). A screen where that is not so is a FAIL: a remote has
// nothing to press there. The key words: L R U D = the arrows, OK = Enter, B = Escape, a number repeats ("3R").
//
//   node scripts/ui-walk/tv-keys.mjs [hd|full] [names...]       (through run.mjs: --only=tv-keys; names are steps: --steps=keys-rate)
// The pictures go to <out>/tv-1280-keys/ (tv-1920-keys/), and what the remote is on, screen by screen, to focus.txt beside them.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { chromium, wait, HD, FULL_HD, openContext, snap, step, pointerAway, out, movies } from "./lib.mjs";
import { seed } from "./seed.mjs";

const KEYS = { L: "ArrowLeft", R: "ArrowRight", U: "ArrowUp", D: "ArrowDown", OK: "Enter", B: "Escape" };
const pressAll = async (page, text, gap = 230) => {
  for (const token of text.trim().split(/\s+/).filter(Boolean)) {
    const [, times, word] = token.match(/^(\d+)?([A-Z]+)$/) ?? [];
    if (!KEYS[word]) throw new Error(`bad key word ${token}`);
    for (let n = 0; n < Number(times ?? 1); n++) {
      await page.keyboard.press(KEYS[word]);
      await wait(gap);
    }
  }
  await wait(250);
};

/** Opens the film the walk can play (it is not the first tile: the remote is put on it, as the arrows above would have done, and from there it is keys) and shows the controls. */
const playFilm = async (page) => {
  await page.locator(`.tv-tile[title="${movies[1].title}"]`).first().focus();
  await page.keyboard.press("Enter");
  await page.getByTestId("tv-detail").waitFor();
  await wait(900);
  await page.keyboard.press("Enter");
  await page.locator('[data-testid="tv"][data-state="playing"]').waitFor({ timeout: 20_000 });
  await wait(1200);
  await page.keyboard.press("ArrowDown"); // (the first press shows the controls and puts the remote on them)
  await wait(500);
};
/** [name, keys, after]: the screens a remote reaches from the library's first screen (the same ones the TV audit drove). */
const SCREENS = [
  ["home", ""],
  ["home-next-tile", "R"],
  ["home-banner", "U"],
  ["home-top", "2U"],
  ["rail", "L 2D"],
  ["detail", "OK"],
  ["detail-list", "OK R"],
  ["detail-series", "L 2D OK OK 2D"],
  ["search", "L U OK 2D R"],
  ["rate", "OK 2R OK"],
  ["rate-low", "OK 2R OK 4L"],
  ["profile", "L 7D OK"],
  ["settings", "L 7D OK 3R OK"],
  ["settings-language", "L 7D OK 3R OK R 3U L"],
  ["settings-colour", "L 7D OK 3R OK R 2U"],
  ["settings-switch", "L 7D OK 3R OK R 5D"],
  ["party", "L 5D OK"],
  ["connect", "L 6D OK D"],
  ["player", "", async (page) => {
    await playFilm(page);
  }],
  ["player-menu", "", async (page) => {
    await playFilm(page);
    await pressAll(page, "3R OK"); // (skip back, skip forward, then the speed button: its menu opens on the speed that is on)
    await page.getByTestId("audio-subtitles-modal").waitFor();
    await wait(400);
  }],
];

const readFocus = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) return null;
    const r = el.getBoundingClientRect();
    const text = (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
    return {
      what: [el.tagName.toLowerCase(), el.getAttribute("data-testid") ? `[${el.getAttribute("data-testid")}]` : "", text ? ` "${text}"` : ""].join(""),
      visible: el.matches(":focus-visible"),
      onScreen: r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight,
    };
  });

const browser = await chromium.launch();
const size = process.argv[2] === "full" ? FULL_HD : HD;
const device = `tv-${size.width}-keys`;
const wanted = process.argv.slice(3);
mkdirSync(`${out}/${device}`, { recursive: true });
writeFileSync(`${out}/${device}/focus.txt`, "");

for (const [name, keys, after] of SCREENS) {
  if (wanted.length > 0 && !wanted.includes(name)) continue;
  await step(device, `keys-${name}`, async () => {
    const context = await openContext(browser, size, { seed });
    try {
      const page = await context.newPage();
      await page.goto("/tv");
      await page.getByTestId("tv-browse").waitFor();
      await page.getByTestId("tv-welcome").waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
      await wait(900);
      await pointerAway(page, size);
      await pressAll(page, keys);
      if (after) await after(page);
      await wait(400);
      const focus = await readFocus(page);
      await snap(page, device, `keys-${name}`, { settle: 300 });
      appendFileSync(`${out}/${device}/focus.txt`, `${name.padEnd(18)} ${keys.padEnd(24)} ${focus ? `${focus.what}${focus.visible ? "" : "  (NOT :focus-visible)"}${focus.onScreen ? "" : "  (OFF SCREEN)"}` : "(nothing focused)"}\n`);
      if (!focus) throw new Error("nothing is focused");
      if (!focus.visible) throw new Error(`${focus.what} is focused but does not show it (not :focus-visible)`);
      if (!focus.onScreen) throw new Error(`${focus.what} is focused but is not on the screen`);
    } finally {
      await context.close();
    }
  });
}
await browser.close();
