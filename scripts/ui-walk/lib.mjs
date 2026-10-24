// Shared pieces of the screenshot walk: a made-up catalogue with drawn posters, the way each device is opened, the step/snap helpers.
// Run by run.mjs against a server on its own (accounts live in the server's memory). There is one look (the refined one), so nothing chooses it.
import { chromium, devices } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { saveScan } from "./scan.mjs";

export { chromium };

/** The folder name the pictures and scans go under. There is one look now (it used to be two, compared); the name stays so the old folders and notes still read. */
export const look = "polish";
export const base = process.env.BASE ?? "http://127.0.0.1:8810";
export const out = process.env.OUT ?? `.ui-polish/shots/${look}`;
/** With SCAN=1 every picture is also measured (scan.mjs): one JSON of computed styles per picture, for drift.mjs. */
const scanning = process.env.SCAN === "1";
const scanOut = process.env.SCAN_OUT ?? `.ui-polish/scan/${look}`;
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------ the made-up catalogue ------------------------------ */

const MOVIES = [
  ["The Long Harbour", 2019, "A dockworker's last winter in a town that is selling its piers one by one."],
  ["Paper Moons", 2011, "Two sisters run a failing cinema and decide to film the last reel themselves."],
  ["Salt and Ember", 2022, "A chef returns to the island kitchen she left behind and finds it burning, slowly, on purpose."],
  ["A Quiet Machine", 2016, "The night shift at a data centre becomes the only place where anyone says what they mean."],
  ["Night Train to Arden", 2008, "Nine strangers, one sleeper car, and a timetable that stopped being true at midnight."],
  ["The Glass Orchard", 2023, "A botanist inherits a greenhouse with a locked door and a very patient caretaker."],
  ["Midwinter Parade", 1999, "A small-town band has one rehearsal left, one snowstorm, and an unfinished march."],
  ["Copper Sky", 2014, "Two surveyors map a valley that is about to be flooded and argue about what to leave out."],
  ["Letters from Nowhere", 2005, "A postal clerk starts answering the mail that has no address."],
  ["The Last Cartographer", 2021, "The final map of a country that has just changed its name, drawn in a single week."],
  ["Harvest Moon Motel", 1996, "Every room has a story and the manager has promised to tell them all before checkout."],
  ["Under the Tin Roof", 2018, "Three generations share a house, a radio and one very old argument."],
  ["Velvet Static", 2020, "A pirate radio host goes quiet and the whole city leans in to listen."],
  ["The Orchard Year", 2002, "Twelve months with a family that cannot decide whether to sell the trees."],
  ["Blue Hour", 2017, "A photographer waits every evening for the same twenty minutes of light."],
  ["Small Fires", 2013, "A volunteer fire brigade with no fires and a great deal to prove."],
  ["The Weather Inside", 2024, "A meteorologist is wrong about everything except the people around her."],
  ["Distant Relatives", 2009, "A reunion that nobody wanted, held in the one house that still has all the chairs."],
  ["Driftwood", 1991, "A carpenter builds a boat out of whatever the tide leaves behind."],
  ["Sundown Protocol", 2025, "When the last office light goes off, the building starts keeping its own records."],
  ["Lanterns", 2012, "A festival, a power cut, and a village that discovers it can see perfectly well."],
  ["The Borrowed Summer", 2006, "A teenager spends a season in a house that belongs to someone else's memories."],
  ["Echo Park, Late", 1987, "Closing time at a record shop, and one customer who knows every song."],
  ["Wild Honey", 2015, "A beekeeper, a rival, and a hive that will not choose a side."],
  ["The Clockmaker's Daughter", 2010, "She inherits forty clocks, none of which agree, and one of which is right."],
  ["Seven Days in Marrow", 2022, "A week in a town where the only road is being repaved from both ends."],
  ["Tidewater", 1998, "A ferry pilot meets the same passenger on every crossing."],
  ["Northern Lights Café", 2007, "The best coffee for two hundred miles and a waitress who has heard every story twice."],
  ["The Understudy", 2019, "She has learned every part but one: her own."],
  ["Ash and Clover", 2003, "Two farms, one boundary, and a spring neither family will admit is shared."],
  ["Moth Season", 2021, "A lighthouse keeper's apprentice learns what the light is really for."],
  ["Halfway Home", 2000, "A road trip that keeps being interrupted by relatives."],
];
const SERIES = [
  ["The Long Night", 2022, "Six winters, one lighthouse, and the people who never leave it."],
  ["Harbour Lights", 2019, "A port town's night shift, told one ship at a time."],
  ["Brightwater", 2024, "A water engineer and a journalist follow a leak to the top of a very tall building."],
  ["Quiet Hours", 2017, "The after-midnight staff of a hospital, and the rules they make up."],
  ["The Understudies", 2021, "A theatre company where everyone is waiting for someone else to fall ill."],
  ["Field Notes", 2023, "A naturalist's letters home, and what the village does with them."],
  ["Orbit Street", 2015, "An ordinary street in which something extraordinary happens every episode, to somebody else."],
  ["Last Ferry", 2020, "The final boat of the day, and who is on it."],
];

const hues = (i) => (i * 47 + 200) % 360;
const lines = (title, per) => {
  const words = title.split(" ");
  const rows = [];
  for (const word of words) {
    const last = rows[rows.length - 1];
    if (last !== undefined && (last + " " + word).length <= per) rows[rows.length - 1] = last + " " + word;
    else rows.push(word);
  }
  return rows;
};
const esc = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** An upright poster (w x h) or a wide picture, drawn from the title: a gradient, a disc of light, the title. */
export function artwork(kind, i) {
  const all = [...MOVIES, ...SERIES];
  const [title, year] = all[i] ?? ["Untitled", 2000];
  const poster = kind === "p";
  const w = poster ? 400 : 1280;
  const h = poster ? 600 : 720;
  const hue = hues(i);
  const size = poster ? 44 : 64;
  const rows = lines(title, poster ? 13 : 24);
  const x = poster ? 34 : 90;
  const y0 = poster ? h - 70 - (rows.length - 1) * (size + 6) : h - 150 - (rows.length - 1) * (size + 8);
  // (a wide picture is a still from the film: no title in it, where a poster has one)
  const text = !poster ? "" : rows.map((row, n) => `<text x="${x}" y="${y0 + n * (size + 6)}" font-family="Georgia,serif" font-size="${size}" font-weight="bold" fill="#fff">${esc(row)}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},55%,40%)"/><stop offset="1" stop-color="hsl(${(hue + 50) % 360},62%,13%)"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${w * 0.74}" cy="${h * 0.3}" r="${Math.min(w, h) * 0.24}" fill="hsl(${(hue + 25) % 360},75%,62%)" opacity="0.32"/><rect x="0" y="${h * 0.62}" width="${w}" height="${h * 0.38}" fill="#000" opacity="0.28"/>${text}${poster ? `<text x="${x}" y="${h - 30}" font-family="Arial,sans-serif" font-size="22" fill="#fff" opacity="0.75">${year}</text>` : `<ellipse cx="${w * 0.3}" cy="${h * 0.78}" rx="${w * 0.35}" ry="${h * 0.18}" fill="#000" opacity="0.35"/><rect x="${w * 0.55}" y="${h * 0.52}" width="${w * 0.07}" height="${h * 0.3}" fill="#000" opacity="0.4"/>`}</svg>`;
}

const movieItem = (entry, i) => ({
  id: `m${i}`,
  title: entry[0],
  year: entry[1],
  kind: "movie",
  image: `/img/p/${i}.svg`,
  backdrop: `/img/b/${i}.svg`,
  description: entry[2],
  // the first four play for real (a long clip served by this server); the others have links that only lead to their pages
  url: i < 4 ? `${base}/fixtures/long.mp4?n=${i}` : `https://films.example/watch/${i}`,
});
const seriesItem = (entry, n) => {
  const i = MOVIES.length + n;
  return { id: `s${n}`, title: entry[0], year: entry[1], kind: "series", image: `/img/p/${i}.svg`, backdrop: `/img/b/${i}.svg`, description: entry[2], url: `https://films.example/show/${n}` };
};
export const movies = MOVIES.map(movieItem);
export const series = SERIES.map(seriesItem);

export const library = {
  updatedAt: Date.now(),
  rows: [
    { id: "r1", title: "Popular this week", source: "Catalogue", kind: "movie", items: movies.slice(0, 12) },
    { id: "r2", title: "Series to binge", source: "Catalogue", kind: "series", items: series },
    { id: "r3", title: "Award winners", source: "Catalogue", kind: "movie", items: movies.slice(12, 24) },
    { id: "r4", title: "Short and sweet", source: "Catalogue", kind: "movie", items: movies.slice(20, 32) },
  ],
};

/** Everything the page asks the server's library for, answered from the catalogue; pictures are drawn on the spot. */
export async function withCatalogue(context) {
  await context.route(/\/img\/(p|b)\/\d+\.svg/, (route) => {
    const [, kind, number] = new URL(route.request().url()).pathname.match(/\/img\/(p|b)\/(\d+)\.svg/);
    return route.fulfill({ contentType: "image/svg+xml", body: artwork(kind, Number(number)) });
  });
  await context.route("**/api/library", (route) => route.fulfill({ json: library }));
  await context.route(/\/api\/library\/search/, (route) => {
    const q = (new URL(route.request().url()).searchParams.get("q") ?? "").toLowerCase();
    const all = [...movies, ...series].filter((item) => item.title.toLowerCase().includes(q));
    return route.fulfill({ json: { items: all } });
  });
  await context.route(/\/api\/library\/seasons/, (route) => route.fulfill({ json: { seasons: [1, 2, 3] } }));
  await context.route(/\/api\/library\/episodes/, (route) => {
    const season = Number(new URL(route.request().url()).searchParams.get("season"));
    const names = ["Pilot", "The Long Night", "Salt", "The Third Day", "Low Tide", "What the Water Kept"];
    return route.fulfill({
      json: {
        episodes: names.map((name, n) => ({
          season,
          episode: n + 1,
          title: season === 1 ? name : `${name}, again`,
          overview: "The harbour wakes late, and everyone pretends not to have noticed.",
          runtime: 38 + n * 3,
          still: `/img/b/${(n * 5 + season) % 30}.svg`,
          url: `${base}/fixtures/pages/video.html?s=${season}&e=${n + 1}`,
        })),
      },
    });
  });
}

/* ------------------------------ devices ------------------------------ */

export const HD = { width: 1280, height: 720 };
export const FULL_HD = { width: 1920, height: 1080 };
export const QHD = { width: 2560, height: 1440 };
export const DESKTOP = { width: 1440, height: 900 };
export const LAPTOP = { width: 1366, height: 768 };
// PHONE_SIZE=844x390 walks a phone of that size (held sideways, say) instead of the usual 390x844; its pictures go to phone-844x390/.
const sized = (process.env.PHONE_SIZE ?? "").match(/^(\d+)x(\d+)$/);
export const PHONE = sized ? { width: Number(sized[1]), height: Number(sized[2]) } : { width: 390, height: 844 };
export const phoneName = sized ? `phone-${PHONE.width}x${PHONE.height}` : "phone-390";
export const PHONE_SMALL = { width: 360, height: 800 };

/** What a device that came back after leaving full screen once and turned the link box on looks like (the pages start like this in the tests too). */
const kept = (first) => [...(first ? [] : [{ name: "kino.fullscreen.left", value: "1" }, { name: "kino.linkbox", value: "1" }])];
const storageOf = (first) => ({ cookies: [], origins: kept(first).length > 0 ? [{ origin: base, localStorage: kept(first) }] : [] });

// WALK_LOCALE=ro-RO walks the pages in Romanian (it-IT: Italian), the two languages whose words are the longest; write its pictures somewhere of their own (--out).
export async function openContext(browser, viewport, { phone = false, first = false, seed = {}, locale = process.env.WALK_LOCALE ?? "en-US" } = {}) {
  const options = { baseURL: base, viewport, locale, storageState: storageOf(first) };
  if (phone) Object.assign(options, { screen: viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: devices["Pixel 7"].userAgent });
  const context = await browser.newContext(options);
  if (Object.keys(seed).length > 0) {
    await context.addInitScript((entries) => {
      for (const [key, value] of Object.entries(entries)) if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
    }, seed);
  }
  await withCatalogue(context);
  return context;
}

/** What a device keeps about its guest, in the form the page itself writes. */
export const guestData = (data) => ({
  "kino.data.guest": JSON.stringify({ v: 1, data: { progress: [], watched: [], list: [], listNames: [], ratings: [], settings: [], ...data }, rev: 0, dirty: [] }),
});

/* ------------------------------ the walk ------------------------------ */

export const log = [];
/** With STEPS=02-home,04-rail-open only those steps run (the others are skipped, not failed): for looking at one screen while a stylesheet is being written. */
const onlySteps = process.env.STEPS ? process.env.STEPS.split(",").filter(Boolean) : null;
export async function step(device, name, fn) {
  if (onlySteps && !onlySteps.some((want) => name === want || name.startsWith(want))) return;
  const started = Date.now();
  try {
    await fn();
    log.push(`ok   ${device}/${name} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  } catch (error) {
    log.push(`FAIL ${device}/${name}: ${String(error.message).split("\n")[0].slice(0, 160)}`);
  }
  console.log(log[log.length - 1]);
}

/** Held until the little messages that come and go (a friend started a film, asked to be friends) have gone, unless the picture is of one. */
const quiet = (page) =>
  page
    .waitForFunction(() => !document.querySelector('[data-testid="account-toast"], [data-testid="toast"], [data-testid="tv-account-toast"]'), null, { timeout: 9_000 })
    .catch(() => {});

/**
 * What changes from one run to the next without anybody touching the page - a code made at random (and the width it gives a centred block),
 * the pattern of a QR code, a frame of the film - is set to the same thing every time for the picture, so comparing two runs shows what the
 * *page* did. `live` keeps the film's frame (a picture to look at, not to compare). `unsteady` puts it all back.
 */
const steady = (page, live) =>
  page.evaluate((keepFilm) => {
    const kept = (window.__steady = window.__steady ?? { texts: [], paths: [], style: null });
    const swaps = [
      [/\b\d{3} \d{3}\b/g, "123 456"],
      [/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/g, "ABCD-2345"],
      [/\bTV [0-9A-F]{4}\b/g, "TV 4F2A"],
    ];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      let text = node.nodeValue ?? "";
      for (const [pattern, to] of swaps) text = text.replace(pattern, to);
      if (text !== node.nodeValue) {
        kept.texts.push([node, node.nodeValue]);
        node.nodeValue = text;
      }
    }
    for (const svg of document.querySelectorAll('[data-testid="pairing-qr"]')) {
      const path = svg.querySelector("path");
      const [, , total] = (svg.getAttribute("viewBox") ?? "").split(" ").map(Number);
      if (!path || !total) continue;
      const size = total - 4;
      let seed = 12345;
      const bit = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 16) & 1;
      const finder = (r, c) => {
        const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
        return ring !== 2; // (a 7 x 7 square: dark edge, light ring, dark middle)
      };
      let d = "";
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          const corner = (r < 7 && c < 7 && [r, c]) || (r < 7 && c >= size - 7 && [r, c - (size - 7)]) || (r >= size - 7 && c < 7 && [r - (size - 7), c]);
          const dark = corner ? finder(corner[0], corner[1]) : bit() === 1;
          if (dark) d += `M${c} ${r}h1v1h-1z`;
        }
      }
      kept.paths.push([path, path.getAttribute("d")]);
      path.setAttribute("d", d);
    }
    if (!keepFilm) {
      kept.style = document.createElement("style");
      kept.style.textContent = "video { visibility: hidden !important; }";
      document.head.append(kept.style);
    }
  }, live);

const unsteady = (page) =>
  page.evaluate(() => {
    const kept = window.__steady;
    if (!kept) return;
    for (const [node, text] of kept.texts) node.nodeValue = text;
    for (const [path, d] of kept.paths) path.setAttribute("d", d ?? "");
    kept.style?.remove();
    window.__steady = undefined;
  });

/**
 * With TASTE_CSS=<file> every picture is taken with that style sheet added to the page, and with TASTE_ATTR=data-accent=blue with that attribute on
 * <html> (taste.mjs: one thing changed on the refined look, for the owner to choose between).
 */
const tasteCss = process.env.TASTE_CSS ? readFileSync(process.env.TASTE_CSS, "utf8") : "";
const tasteAttr = (process.env.TASTE_ATTR ?? "").split("=");
const tasted = (page) =>
  tasteCss || tasteAttr[0]
    ? page.evaluate(
        ([css, [name, value]]) => {
          if (name) document.documentElement.setAttribute(name, value ?? "");
          if (!css || document.getElementById("taste-css")) return;
          const style = document.createElement("style");
          style.id = "taste-css";
          style.textContent = css;
          document.head.append(style);
        },
        [tasteCss, tasteAttr],
      )
    : null;

/** A picture of what the page shows, after the things that fade and slide have settled. */
export async function snap(page, device, name, { settle = 500, keepToast = false, live = false, ...shot } = {}) {
  mkdirSync(`${out}/${device}`, { recursive: true });
  if (!keepToast) await quiet(page);
  await wait(settle);
  await tasted(page);
  await steady(page, live);
  await page.screenshot({ path: `${out}/${device}/${name}.png`, animations: "disabled", ...shot });
  if (scanning && !shot.fullPage) await saveScan(page, `${scanOut}/${device}`, name);
  await unsteady(page);
}

/**
 * A page that scrolls inside itself (an overlay over the library): the picture of its top, then of each part below it, as a hand scrolling it
 * would see them. `inside` is something in the page; the scrolling box around it is found from there.
 */
export async function snapScrolled(page, inside, device, name, { max = 4, settle = 500 } = {}) {
  mkdirSync(`${out}/${device}`, { recursive: true });
  await quiet(page);
  // (what is under the middle of the screen is what a hand would scroll)
  const box = inside ? await page.locator(inside).first().elementHandle() : await page.evaluateHandle(() => document.elementFromPoint(innerWidth / 2, innerHeight / 2));
  const sizes = await box.evaluate((element) => {
    const scrolls = (node) => /(auto|scroll)/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 4;
    // the box itself, else the ones around it, else (for a box that was named) the largest inside it
    let node = element;
    while (node && node !== document.documentElement && !scrolls(node)) node = node.parentElement;
    if ((!node || node === document.documentElement) && element.querySelectorAll) node = [...element.querySelectorAll("*")].filter(scrolls).sort((a, b) => b.clientHeight - a.clientHeight)[0] ?? null;
    if (!node || node === document.documentElement) return null;
    node.setAttribute("data-l-scroll", "1");
    return { height: node.clientHeight, total: node.scrollHeight };
  });
  const parts = sizes ? Math.min(max, Math.ceil(sizes.total / Math.max(1, sizes.height - 80))) : 1;
  for (let part = 0; part < parts; part++) {
    if (sizes) await page.evaluate(([n, step]) => { document.querySelector("[data-l-scroll]").scrollTop = n * step; }, [part, sizes.height - 80]);
    await wait(part === 0 ? settle : 350);
    const suffix = parts > 1 ? `-${part + 1}of${parts}` : "";
    await tasted(page);
    await steady(page, false);
    await page.screenshot({ path: `${out}/${device}/${name}${suffix}.png`, animations: "disabled" });
    if (scanning) await saveScan(page, `${scanOut}/${device}`, `${name}${suffix}`);
    await unsteady(page);
  }
  if (sizes) await page.evaluate(() => { const node = document.querySelector("[data-l-scroll]"); node.scrollTop = 0; node.removeAttribute("data-l-scroll"); });
}

/** Keeps the pointer where it hovers over nothing, so no tile or corner shows what a pointer at rest would. */
export const pointerAway = (page, viewport) => page.mouse.move(viewport.width - 2, viewport.height - 2);
