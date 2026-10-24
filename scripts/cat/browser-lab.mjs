// Real-Chromium measurements of the cat on the TV's library (development tooling, not part of the app). It starts the server itself (on its own port, from
// the build you point it at, so that the tracked dist/client is not touched), opens /tv with the cat on and `?cat=debug`, and reports what the cat does.
//
//   node scripts/cat/browser-lab.mjs scroll [--client=<dir>] [--port=8872] [--only=remote-step,wheel-spin] [--look=ginger] [--dump=<file.json>]
//       what the library's rows do for each kind of scroll (a step of the remote, wheel notches, a trackpad, a held key, a page key, a fling), how fast and how far, and
//       what the cat does while it sits on a shelf: whether it rode with the shelf (floated up), or was shaken off and fell.
//   node scripts/cat/browser-lab.mjs floor [--client=<dir>] [--port=8874] [--runs=4] [--seconds=180] [--long]
//       a cat that is called down to the foot of the screen and left to itself: how long before it is on a shelf again (with --long, it is followed for the whole time), and what it chose to do on the way.
//   node scripts/cat/browser-lab.mjs places [--client=<dir>] [--port=8873] [--seconds=240] [--runs=3] [--viewer] [--look=ginger] [--size=1280x720]
//       how an unattended cat spends its time on the real page (the share on each place, on the foot of the screen, in the air, in each act), in the page's own
//       clock (a fake one, run at many times the speed of the real one, so that minutes of cat take seconds). With --viewer a hand presses an arrow key of the remote
//       every few seconds, as somebody browsing the library would.
//
// Needs `pnpm build` (or `vite build --outDir <dir>`) to have been run for the client that is looked at.

import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const mode = process.argv[2] ?? "scroll";
const args = Object.fromEntries(
  process.argv.slice(3).map((arg) => {
    const found = arg.match(/^--([^=]+)(?:=(.*))?$/);
    return found ? [found[1], found[2] ?? "1"] : [arg, "1"];
  }),
);
const port = Number(args.port ?? (mode === "scroll" ? 8872 : mode === "floor" ? 8874 : 8873));
const clientDir = args.client ? path.resolve(args.client) : path.join(root, "dist/client");
const look = args.look ?? "ginger";
const [width, height] = (args.size ?? "1280x720").split("x").map(Number);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const film = (id, title) => ({ id, title, year: 2001, url: `/fixtures/sample.mp4?n=${id}` });
/** A library of more rows than a screen shows (so that the rows can be scrolled). */
const tall = { updatedAt: 1, rows: Array.from({ length: 12 }, (_, row) => ({ id: `row${row}`, title: `Row ${row + 1}`, source: "Test Source", items: Array.from({ length: 10 }, (_, index) => film(`r${row}c${index}`, `Film ${row + 1}-${index + 1}`)) })) };

async function startServer() {
  const child = spawn(process.execPath, [path.join(root, "node_modules/tsx/dist/cli.mjs"), "src/server/index.ts"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", ALLOW_PRIVATE_NETWORK: "1", LIBRARY: "off", DATA_DIR: "memory", CLIENT_DIR: clientDir },
    stdio: "ignore",
    windowsHide: true,
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 160; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return { child, base };
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  child.kill();
  throw new Error("the server did not come up");
}

/** A device with the cat on, the library as above, and the cat's own diagnostics (?cat=debug). With `fake`, the page's clock is a fake one (run by hand). */
async function openTv(browser, base, { fake = false, query = "cat=debug", size = [width, height], settings = {} } = {}) {
  const context = await browser.newContext({
    baseURL: base,
    viewport: { width: size[0], height: size[1] },
    storageState: { cookies: [], origins: [{ origin: base, localStorage: [{ name: "kino.fullscreen.left", value: "1" }, { name: "kino.linkbox", value: "1" }] }] },
  });
  await context.addInitScript((entries) => {
    for (const [key, value] of Object.entries(entries)) if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
  }, { "kino.cat": JSON.stringify({ on: true, quiet: false, films: true, look, ...settings }) });
  await context.route("**/api/features", (route) => route.fulfill({ json: { cat: true } }));
  await context.route("**/api/library", (route) => route.fulfill({ json: tall }));
  await context.route(/\/api\/library\/(search|rows|more)/, (route) => route.fulfill({ json: { items: [], rows: [], next: null } }));
  if (fake) await context.clock.install();
  const page = await context.newPage();
  await page.goto(`/tv?${query}`);
  await page.getByTestId("tv-browse").waitFor();
  return page;
}

const snap = (page) => page.evaluate(() => window.__kinoCat.snapshot());
const worldOf = (page) => page.evaluate(() => window.__kinoCat.world());
const tell = (page, event) => page.evaluate((e) => window.__kinoCat.send(e), event);

async function onTheShelves(page, tick) {
  for (let i = 0; i < 400; i++) {
    const seen = await snap(page);
    if (seen.engine.mode === "browse" && seen.engine.placed && seen.frame.appear > 0.95 && seen.frame.grounded) return seen;
    await tick(50);
  }
  throw new Error("the cat did not come onto the shelves");
}

/* ------------------------------ scroll ------------------------------ */

/**
 * The ways a page is scrolled: each is told, from a page that has the cat on a shelf, what to do; the scroller is `.tv-rows`. (The first step of the remote from the top of the library is
 * more than a step: the banner folds up, and the rows jump by a banner's half before they scroll. The gestures with `-2` in their names follow a first step, that is made before the cat is called.)
 */
const GESTURES = {
  "remote-step": async (page) => {
    await page.keyboard.press("ArrowDown");
  },
  "remote-step-2": async (page) => {
    await page.keyboard.press("ArrowDown");
  },
  "remote-x2-fast": async (page) => {
    await page.keyboard.press("ArrowDown");
    await sleep(150);
    await page.keyboard.press("ArrowDown");
  },
  "remote-x2-slow": async (page) => {
    await page.keyboard.press("ArrowDown");
    await sleep(700);
    await page.keyboard.press("ArrowDown");
  },
  "wheel-smooth-x5": async (page) => {
    // (what a browser with smooth wheel scrolling does with five notches: each is an animation of a few tenths of a second, and they run into each other)
    await page.evaluate(async () => {
      const rows = document.querySelector(".tv-rows");
      for (let i = 0; i < 5; i++) {
        rows.scrollBy({ top: 100, behavior: "smooth" });
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
    });
  },
  "remote-x3": async (page) => {
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("ArrowDown");
      await sleep(90);
    }
  },
  "remote-held": async (page) => {
    // (a key that is held down repeats about thirty times a second)
    for (let i = 0; i < 36; i++) {
      await page.keyboard.press("ArrowDown");
      await sleep(33);
    }
  },
  "wheel-notch": async (page) => {
    await page.mouse.move(width * 0.5, height * 0.55);
    await page.mouse.wheel(0, 100);
  },
  "wheel-x3": async (page) => {
    await page.mouse.move(width * 0.5, height * 0.55);
    for (let i = 0; i < 3; i++) {
      await page.mouse.wheel(0, 100);
      await sleep(60);
    }
  },
  "wheel-spin": async (page) => {
    await page.mouse.move(width * 0.5, height * 0.55);
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, 100);
      await sleep(30);
    }
  },
  "trackpad": async (page) => {
    await page.mouse.move(width * 0.5, height * 0.55);
    // (a flick of two fingers: many small wheel events that speed up, and then die away by themselves)
    for (let i = 0; i < 70; i++) {
      await page.mouse.wheel(0, Math.round(60 * Math.exp(-Math.abs(i - 14) / 14)));
      await sleep(8);
    }
  },
  "page-key": async (page) => {
    await page.keyboard.press("PageDown");
  },
  "scrollbar-drag": async (page) => {
    // (a thumb dragged down: the position follows the pointer at every frame, no smoothing, a screenful in a third of a second)
    await page.evaluate(async () => {
      const rows = document.querySelector(".tv-rows");
      const start = rows.scrollTop;
      const total = 1.4 * rows.clientHeight;
      const began = performance.now();
      await new Promise((resolve) => {
        const tick = (now) => {
          const f = Math.min(1, (now - began) / 340);
          rows.scrollTop = start + total * f;
          if (f < 1) requestAnimationFrame(tick);
          else resolve(null);
        };
        requestAnimationFrame(tick);
      });
    });
  },
  "fling": async (page) => {
    // (a body length a frame, sixty a second, as far as the rows go)
    await page.evaluate(async (step) => {
      const rows = document.querySelector(".tv-rows");
      for (let frame = 0; frame < 80; frame++) {
        rows.scrollTop += step;
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      }
    }, (await worldOf(page)).bodyLength);
  },
};

/** From now on, in the page, at every frame: where the rows are scrolled to, and what the cat is doing. */
const startRecording = (page) =>
  page.evaluate(() => {
    const rows = document.querySelector(".tv-rows");
    const rec = (window.__rec = { samples: [], stop: false });
    const tick = (now) => {
      const seen = window.__kinoCat.snapshot();
      rec.samples.push({ t: now, top: rows.scrollTop, y: seen.frame.y, grounded: seen.frame.grounded, act: seen.engine.act, flung: seen.engine.flung, surface: seen.engine.surfaceId, scroll: seen.engine.scroll, fast: seen.engine.fast, rise: seen.engine.rise ?? 0, clip: seen.frame.clip });
      if (!rec.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
const stopRecording = (page) =>
  page.evaluate(() => {
    window.__rec.stop = true;
    return window.__rec.samples;
  });

function analyse(samples, L) {
  // how fast the rows go (body lengths a second, down the page positive: the rows go up the screen), over the last 50 ms or so
  const speed = samples.map((s, i) => {
    let j = i;
    while (j > 0 && s.t - samples[j].t < 50) j--;
    return s.t > samples[j].t ? ((s.top - samples[j].top) / ((s.t - samples[j].t) / 1000)) / L : 0;
  });
  const first = samples.findIndex((s, i) => i > 0 && s.top !== samples[0].top);
  let last = first;
  samples.forEach((s, i) => {
    if (i > 0 && s.top !== samples[i - 1].top) last = i;
  });
  if (first < 0) return null;
  const peak = Math.max(...speed.slice(first, last + 1));
  const distance = (samples[last].top - samples[first - 1].top) / L;
  const span = (samples[last].t - samples[first - 1].t) / 1000;
  const above = (limit) => {
    let seconds = 0;
    for (let i = first; i <= last; i++) if (speed[i] >= limit) seconds += (samples[i].t - samples[i - 1].t) / 1000;
    return seconds;
  };
  const y0 = samples[Math.max(0, first - 1)].y;
  const lowest = Math.min(...samples.slice(first - 1).map((s) => s.y));
  const engineMost = Math.min(...samples.map((s) => s.scroll));
  return {
    peak,
    distance,
    span,
    over12: above(12),
    over20: above(20),
    over26: above(26),
    over40: above(40),
    fell: samples.some((s) => s.act === "fall" || s.flung),
    rose: (y0 - lowest) / L,
    engineMost: -engineMost,
    fast: Math.max(...samples.map((s) => s.fast)),
    // (the most the shelves went up in half a second, in steps of the rows' pitch: 1.25 shakes the cat off; and how long after the rows began to move the cat left its shelf, if it did)
    steps: Math.max(...samples.map((s) => s.rise)),
    after: (() => {
      const left = samples.findIndex((s, i) => i >= first && (s.act === "fall" || s.flung));
      return left < 0 ? null : (samples[left].t - samples[first - 1].t) / 1000;
    })(),
    // (how long it was in the air, from the first frame it fell in to the first in which it stood again, and what it stood on then)
    air: (() => {
      const left = samples.findIndex((s, i) => i >= first && (s.act === "fall" || s.flung));
      if (left < 0) return null;
      const down = samples.findIndex((s, i) => i > left && s.grounded && s.act !== "fall");
      return down < 0 ? null : { seconds: (samples[down].t - samples[left].t) / 1000, on: samples[down].surface };
    })(),
    frames: last - first + 1,
  };
}

async function scrollLab(browser, base) {
  const only = args.only ? args.only.split(",") : Object.keys(GESTURES);
  const rows = [];
  const series = {};
  for (const name of only) {
    const page = await openTv(browser, base);
    await onTheShelves(page, (ms) => sleep(ms));
    if (/-2$|^remote-x2/.test(name)) {
      // (the first step from the top of the library is made, and has settled, before the cat is called to the shelf it sits on)
      await page.keyboard.press("ArrowDown");
      await sleep(2500);
      await onTheShelves(page, (ms) => sleep(ms));
    }
    const world = await worldOf(page);
    const L = world.bodyLength;
    // (the cat is called to the second shelf from the top, with room above it, and told to sit there)
    const shelf = world.surfaces.filter((s) => s.kind === "shelfTop").sort((a, b) => a.y - b.y)[1] ?? world.surfaces.filter((s) => s.kind === "shelfTop")[0];
    await tell(page, { type: "cat.call", at: { x: (shelf.x0 + shelf.x1) / 2, y: shelf.y } });
    for (let i = 0; i < 300; i++) {
      const seen = await snap(page);
      if (seen.engine.surfaceId === shelf.id && seen.frame.grounded && !/jump|fall|walk/.test(seen.engine.act)) break;
      await sleep(100);
    }
    await tell(page, { type: "cat.command", command: "sit" });
    await sleep(1500);
    await startRecording(page);
    await sleep(300);
    await GESTURES[name](page);
    await sleep(2200);
    const samples = await stopRecording(page);
    const result = analyse(samples, L);
    rows.push({ name, L, ...(result ?? { peak: 0, distance: 0 }) });
    // (the frames themselves, for working out a rule offline: time in seconds from the first frame, the rows' scroll in body lengths, the cat's height in body lengths, what it is doing)
    if (args.dump) series[name] = { L, frames: samples.map((s) => [Number(((s.t - samples[0].t) / 1000).toFixed(4)), Number((s.top / L).toFixed(4)), Number((s.y / L).toFixed(4)), s.act, s.grounded ? 1 : 0, Number(s.rise.toFixed(3)), Number(s.scroll.toFixed(1))]) };
    await page.context().close();
  }
  if (args.dump) writeFileSync(path.resolve(String(args.dump)), JSON.stringify(series));
  const f = (n, d = 1) => (typeof n === "number" ? n.toFixed(d) : "-");
  console.log(`${"gesture".padEnd(15)} peak L/s  dist L  secs   >12   >20   >26   >40  engine  rose L  steps  after  fell  in the air, and where it came down`);
  for (const r of rows) console.log(`${r.name.padEnd(15)} ${f(r.peak).padStart(8)} ${f(r.distance).padStart(7)} ${f(r.span, 2).padStart(5)} ${f(r.over12, 2).padStart(5)} ${f(r.over20, 2).padStart(5)} ${f(r.over26, 2).padStart(5)} ${f(r.over40, 2).padStart(5)} ${f(r.engineMost).padStart(7)} ${f(r.rose, 2).padStart(7)} ${f(r.steps, 2).padStart(6)} ${(r.after === null || r.after === undefined ? "-" : `${r.after.toFixed(2)}s`).padStart(6)}  ${r.fell ? "FELL" : "rode"}  ${r.air ? `${r.air.seconds.toFixed(2)} s, on ${r.air.on}` : ""}`);
  if (args.json) console.log(JSON.stringify(rows));
}

/* ------------------------------ places ------------------------------ */

async function placesLab(browser, base) {
  const seconds = Number(args.seconds ?? 240);
  const runs = Number(args.runs ?? 3);
  const total = { kinds: {}, spots: {}, acts: {}, choices: {}, seconds: 0 };
  // (the stays on the foot of the screen: how long, and what the cat had last chosen to do when it came down to it; and the hops, and the places they went from and to)
  const stays = [];
  const hops = {};
  for (let run = 0; run < runs; run++) {
    const page = await openTv(browser, base, { fake: true, query: `cat=debug&catseed=${11 + run * 7}` });
    const tick = (ms) => page.clock.runFor(ms);
    await page.clock.pauseAt(Date.now() + 2000).catch(() => {});
    await onTheShelves(page, tick);
    const kindOf = (world) => Object.fromEntries(world.surfaces.map((s) => [s.id, s.kind]));
    let kinds = kindOf(await worldOf(page));
    let lastChoice = "";
    const keys = ["ArrowDown", "ArrowRight", "ArrowRight", "ArrowLeft", "ArrowUp", "ArrowRight"];
    let nextKey = 3000 + Math.random() * 3000;
    let elapsed = 0;
    const step = 100;
    let stay = null;
    let was = { kind: "", spot: "", act: "" };
    while (elapsed < seconds * 1000) {
      await tick(step);
      elapsed += step;
      if (args.viewer && elapsed >= nextKey) {
        await page.keyboard.press(keys[Math.floor(Math.random() * keys.length)]);
        nextKey = elapsed + 2500 + Math.random() * 4500;
      }
      if (elapsed % 1000 === 0) kinds = kindOf(await worldOf(page));
      const seen = await snap(page);
      if (!(seen.frame.appear > 0.5)) {
        total.kinds.unseen = (total.kinds.unseen ?? 0) + step / 1000;
      } else {
        const kind = seen.frame.grounded ? kinds[seen.engine.surfaceId] ?? "other" : "air";
        total.kinds[kind] = (total.kinds[kind] ?? 0) + step / 1000;
        if (seen.frame.grounded) total.spots[seen.engine.surfaceId ?? "-"] = (total.spots[seen.engine.surfaceId ?? "-"] ?? 0) + step / 1000;
        if (kind === "fallbackFloor") {
          if (!stay) stay = { secs: 0, came: `${was.kind || "?"} (${was.act})`, last: seen.engine.choice };
          stay.secs += step / 1000;
        } else if (kind !== "air" && stay) {
          stays.push(stay);
          stay = null;
        }
        if (kind !== "air" && was.kind && kind !== was.kind) hops[`${was.kind} -> ${kind}`] = (hops[`${was.kind} -> ${kind}`] ?? 0) + 1;
        if (kind !== "air") was = { kind, spot: seen.engine.surfaceId ?? "", act: seen.engine.act };
        else was = { ...was, act: seen.engine.act };
      }
      total.acts[seen.engine.act] = (total.acts[seen.engine.act] ?? 0) + step / 1000;
      if (seen.engine.choice !== lastChoice) {
        lastChoice = seen.engine.choice;
        total.choices[lastChoice] = (total.choices[lastChoice] ?? 0) + 1;
      }
      total.seconds += step / 1000;
    }
    if (stay) stays.push(stay);
    await page.context().close();
  }
  const pct = (n) => `${((100 * n) / total.seconds).toFixed(1).padStart(5)} %`;
  console.log(`${runs} runs of ${seconds} s${args.viewer ? " with a viewer pressing keys" : ", nobody there"} (${look}, ${width}x${height}) = ${total.seconds} s`);
  console.log("on a kind of place:");
  for (const [name, n] of Object.entries(total.kinds).sort((a, b) => b[1] - a[1])) console.log(`  ${name.padEnd(16)} ${pct(n)}`);
  console.log("on each place (by name):");
  for (const [name, n] of Object.entries(total.spots).sort((a, b) => b[1] - a[1])) console.log(`  ${name.padEnd(16)} ${pct(n)}`);
  console.log("by act:");
  for (const [name, n] of Object.entries(total.acts).sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(`  ${name.padEnd(16)} ${pct(n)}`);
  const minutes = total.seconds / 60;
  const secs = stays.map((s) => s.secs);
  console.log(`stays on the foot: ${stays.length} (${((stays.length * 60) / minutes).toFixed(1)} an hour), ${stays.length ? (secs.reduce((a, b) => a + b, 0) / stays.length).toFixed(0) : 0} s on average, ${secs.length ? Math.max(...secs).toFixed(0) : 0} s the longest; it came down from ${Object.entries(stays.reduce((o, s) => ((o[s.came] = (o[s.came] ?? 0) + 1), o), {})).map(([k, v]) => `${k} x${v}`).join(", ") || "nowhere"}`);
  console.log(`moves between kinds of place: ${Object.entries(hops).map(([k, v]) => `${k} x${v}`).join(", ")}`);
  console.log(`what it chose, per minute: ${Object.entries(total.choices).sort((a, b) => b[1] - a[1]).map(([name, n]) => `${name || "-"} ${(n / minutes).toFixed(2)}`).join(", ")}`);
  if (args.json) console.log(JSON.stringify(total));
}

/* ------------------------------ floor ------------------------------ */

/**
 * A cat that is called down to the foot of the screen and left to itself: how long it is before it is on a shelf again, and what it does on the way (the choices, with the time
 * they were made at). `--runs` cats of `--seconds` seconds each, in the page's own (fake) clock.
 */
async function floorLab(browser, base) {
  const seconds = Number(args.seconds ?? 180);
  const runs = Number(args.runs ?? 4);
  const lefts = [];
  for (let run = 0; run < runs; run++) {
    const page = await openTv(browser, base, { fake: true, query: `cat=debug&catseed=${5 + run * 11}` });
    const tick = (ms) => page.clock.runFor(ms);
    await page.clock.pauseAt(Date.now() + 2000).catch(() => {});
    await onTheShelves(page, tick);
    const world = await worldOf(page);
    const floor = world.surfaces.find((s) => s.kind === "fallbackFloor");
    await tell(page, { type: "cat.call", at: { x: world.viewport.w * (0.3 + 0.4 * ((run * 0.37) % 1)), y: floor.y } });
    let seen = await snap(page);
    for (let i = 0; i < 400 && !(seen.engine.surfaceId === floor.id && seen.frame.grounded); i++) {
      await tick(100);
      seen = await snap(page);
    }
    const line = [];
    let elapsed = 0;
    let lastChoice = "";
    let left = null;
    while (elapsed < seconds * 1000) {
      await tick(100);
      elapsed += 100;
      seen = await snap(page);
      if (seen.engine.choice !== lastChoice) {
        lastChoice = seen.engine.choice;
        line.push(`${(elapsed / 1000).toFixed(0)}s ${lastChoice}`);
      }
      if (left === null && seen.engine.surfaceId !== floor.id && seen.frame.grounded) {
        left = elapsed / 1000;
        if (!args.long) break;
      }
    }
    lefts.push(left);
    console.log(`cat ${run + 1}: ${left === null ? `still on the foot after ${seconds} s` : `on a shelf again after ${left.toFixed(1)} s`}; chose ${line.join(", ")}`);
    await page.context().close();
  }
  const got = lefts.filter((n) => n !== null);
  console.log(`${got.length} of ${runs} came up${got.length ? `, after ${(got.reduce((a, b) => a + b, 0) / got.length).toFixed(1)} s on average` : ""}`);
}

/* ------------------------------ world ------------------------------ */

/** What the cat reads of the page: the places it may stand on and what it keeps out of (to see why it is where it is). */
async function worldLab(browser, base) {
  const page = await openTv(browser, base);
  await onTheShelves(page, (ms) => sleep(ms));
  await sleep(1000);
  const world = await worldOf(page);
  const seen = await snap(page);
  console.log(`viewport ${JSON.stringify(world.viewport)} body ${world.bodyLength.toFixed(1)} places ${seen.places} posters ${seen.posters}`);
  for (const s of world.surfaces) console.log(`  surface ${s.id} ${s.kind} y=${s.y.toFixed(1)} x ${s.x0.toFixed(0)}..${s.x1.toFixed(0)} weight ${s.weight}`);
  console.log(`  keepOut ${world.keepOut.length}: ${world.keepOut.slice(0, 40).map((r) => `[${r.x.toFixed(0)},${r.y.toFixed(0)} ${r.w.toFixed(0)}x${r.h.toFixed(0)}]`).join(" ")}`);
  console.log(`  soft ${world.soft?.length ?? 0}, targets ${world.targets.length}, focus ${JSON.stringify(world.focus)}`);
}

/* ------------------------------ run ------------------------------ */

const { child, base } = await startServer();
let failed = false;
try {
  const browser = await chromium.launch();
  try {
    if (mode === "scroll") await scrollLab(browser, base);
    else if (mode === "places") await placesLab(browser, base);
    else if (mode === "world") await worldLab(browser, base);
    else if (mode === "floor") await floorLab(browser, base);
    else throw new Error(`unknown experiment: ${mode}`);
  } finally {
    await browser.close();
  }
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  child.kill();
}
process.exit(failed ? 1 : 0);
