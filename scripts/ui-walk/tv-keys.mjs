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

const playFilm = async (page) => {
  await page.locator(`.tv-tile[title="${movies[1].title}"]`).first().focus();
  await page.keyboard.press("Enter");
  await page.getByTestId("tv-detail").waitFor();
  await wait(900);
  await page.keyboard.press("Enter");
  await page.locator('[data-testid="tv"][data-state="playing"]').waitFor({ timeout: 20_000 });
  await wait(1200);
  await page.keyboard.press("ArrowDown");
  await wait(500);
};
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
  ["profile", "2U OK"],
  ["profile-settings", "2U OK R"],
  ["profile-card", "2U OK D"],
  ["settings", "2U OK R OK"],
  ["settings-colour", "2U OK R OK R"],
  ["settings-colour-next", "2U OK R OK 2R"],
  ["settings-language", "2U OK R OK R U"],
  ["settings-playback", "2U OK R OK R U 3R"],
  ["settings-switch", "2U OK R OK R D"],
  ["settings-back", "2U OK R OK U"],
  ["party", "L 5D OK"],
  ["connect", "L 6D OK D"],
  ["player", "", async (page) => {
    await playFilm(page);
  }],
  ["player-menu", "", async (page) => {
    await playFilm(page);
    await pressAll(page, "3R OK");
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
