// Pictures of the solid cat for looking at it: bundles src/client/cat/lab/gl.ts for the browser, runs it in Chromium (with the software driver, or
// with the machine's graphics card with --gpu=real) and saves a PNG.
//
//   node scripts/cat/glsheet.mjs views|eyes|poses|carried|scenes|swat|faces|faces2|faces3|neck|detail|walk|run|extents <out.png> [--scale=2] [--mesh=src/client/cat/render/gl/cat.mesh] [--clips=src/client/cat/render/gl/cat.clips] [--cols=4] [--pick=0,3] [--gpu=real]
//   node scripts/cat/glsheet.mjs clip <out.png> --clip=<name of a clip of the file> [--n=8] [--cellw=260 --cellh=220] [--turn= --tilt=] [--blind=1]   (any clip, evenly through it, as the director plays it)
//   node scripts/cat/glsheet.mjs film <out.png> --session=<recording.json> [--mode=strip|onion] [--from=0] [--to=10] [--every=6] [--cols=4] [--scale=1]
//
// Development tooling (the cat lab): nothing it makes is part of the app.
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "./bundle.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const [kind = "views", out = ".kino-cat/gl.png", ...rest] = process.argv.slice(2);
const flag = (name, fallback) => rest.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const scale = Number(flag("scale", 1));
const mesh = readFileSync(resolve(root, flag("mesh", "src/client/cat/render/gl/cat.mesh"))).toString("base64");
const clips = readFileSync(resolve(root, flag("clips", "src/client/cat/render/gl/cat.clips"))).toString("base64");
const cols = Number(flag("cols", 4));
const pick = flag("pick", "").split(",").filter(Boolean).map(Number);

// (the film: a recording made by scripts/cat/record.mts, and which part of it: --session=<file.json> --from=<s> --to=<s> --every=<frames> --mode=strip|onion)
const session = flag("session", "");
const film = session ? JSON.parse(readFileSync(resolve(root, session), "utf8")) : null;
const filmOptions = { mode: flag("mode", "strip"), cols, scale, from: Number(flag("from", 0)), to: Number(flag("to", 10)), every: Number(flag("every", 6)), cellW: Number(flag("cellw", 260)), cellH: Number(flag("cellh", 220)), coat: flag("coat", "ragdoll") };
// (one clip of the file, evenly through it: `clip <out.png> --clip=sit --n=8`; --turn and --tilt turn the camera as for a film)
filmOptions.clip = flag("clip", "walk");
// (the pictures the table of the cat's reach is made from, as `extents <out.png> --label=sit` draws those whose label starts with that)
filmOptions.label = flag("label", "");
filmOptions.n = Number(flag("n", 8));
// (--blind=1: the pictures are numbered, not named, for a reviewer who is not to be told what the clip is)
filmOptions.blind = flag("blind", "") !== "";
// (--plain=1: the clips by themselves, with nothing following them: the tail, the back and the breath as the clip has them)
filmOptions.plain = flag("plain", "") !== "";
// (--follow=1: the camera goes with the cat, for one that is carried about)
filmOptions.follow = flag("follow", "") !== "";
// (--raise=<body lengths>: for a clip sheet, the floor line higher in the cell, for a clip whose cat goes below it, as a climb does)
filmOptions.raise = Number(flag("raise", 0));
// (--ref=<s>: the moment of the recording whose feet are on the floor line, for a strip that starts with the cat in the air)
if (flag("ref", "") !== "") filmOptions.refAt = Number(flag("ref", 0));
// (a closer look at a strip: --zoom=2.4 --at=0.3,0.55 [the place, in body lengths forward and up from the feet], and the camera: --turn=-0.5 --tilt=0.1)
if (flag("zoom", "")) {
  filmOptions.zoom = Number(flag("zoom", 1));
  filmOptions.at = flag("at", "0,0.4").split(",").map(Number);
}
// (--headzoom=<times the size> [--headat=<ahead>,<up>: where to look, from the head's centre in body lengths]: a clip sheet with every picture of the head, close)
if (flag("headzoom", "")) {
  filmOptions.headZoom = Number(flag("headzoom", 3));
  filmOptions.headAt = flag("headat", "0.05,-0.02").split(",").map(Number);
}
if (flag("turn", "") || flag("tilt", "") || flag("debug", "") || flag("linear", "")) filmOptions.view = { ...(flag("turn", "") ? { turn: Number(flag("turn", 0)) } : {}), ...(flag("tilt", "") ? { tilt: Number(flag("tilt", 0)) } : {}), ...(flag("debug", "") ? { debug: Number(flag("debug", 0)) } : {}), ...(flag("linear", "") ? { linear: Number(flag("linear", 1)) } : {}) };
// (--linear=<0 to 1>: how much of the skin is matrices averaged and how much dual quaternions, to see what the one saves over the other (0: all quaternions, 1: all matrices; the player
// has SKIN_LINEAR of pose.ts); every kind of sheet takes it)
filmOptions.over = flag("linear", "") ? { linear: Number(flag("linear", 1)) } : {};
const code = await bundle(resolve(root, "src/client/cat/lab/gl.ts"), "CatLabGl");
// (the software driver by default, so a sheet looks the same on every machine; --gpu=real is the machine's own graphics card, as a viewer's screen would draw it)
const browser = await chromium.launch(
  flag("gpu", "soft") === "real" ? { channel: "chromium", args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] } : { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
);
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.setContent('<!doctype html><body style="margin:0;background:#000"><canvas id="c"></canvas></body>');
await page.addScriptTag({ content: code });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => {
  if (message.type() === "error" || message.type() === "warning") errors.push(message.text());
});
await page.evaluate(
  ([which, data, clipData, s, c, chosen, recording, options]) => {
    const canvas = document.getElementById("c");
    const lab = window.CatLabGl;
    const sel = (list) => (chosen.length ? chosen.map((i) => list[i]) : list);
    if (which === "film") lab.glFilm(canvas, data, clipData, recording, options);
    else if (which === "views") lab.glSheet(canvas, data, clipData, sel(lab.VIEWS), c, s, 7, 300, 260, options.coat, options.over);
    else if (which === "poses") lab.glSheet(canvas, data, clipData, sel(lab.GL_POSES), c, s, 7, options.cellW, options.cellH, options.coat, options.over);
    else if (which === "carried") lab.glSheet(canvas, data, clipData, sel(lab.CARRIED), c, s, 7, options.cellW, options.cellH, options.coat, options.over);
    else if (which === "eyes") lab.glSheet(canvas, data, clipData, sel(lab.EYES), c, s, 7, 500, 380, options.coat, options.over);
    else if (which === "faces2") lab.glSheet(canvas, data, clipData, sel(lab.FACES2), c, s, 7, 400, 340, options.coat, options.over);
    else if (which === "faces") lab.glSheet(canvas, data, clipData, sel(lab.FACES), c, s, 7, 400, 340, options.coat, options.over);
    else if (which === "faces3") lab.glSheet(canvas, data, clipData, sel(lab.FACES3), c, s, 7, 400, 340, options.coat, options.over);
    else if (which === "neck") lab.glSheet(canvas, data, clipData, sel(lab.NECK), c, s, 7, 400, 340, options.coat, options.over);
    else if (which === "detail") lab.glSheet(canvas, data, clipData, sel(lab.DETAIL), c, s, 7, 400, 340, options.coat, options.over);
    else if (which === "scenes") lab.glSheet(canvas, data, clipData, sel(lab.SCENES), c, s, 7, options.cellW, options.cellH, options.coat, options.over);
    else if (which === "swat") lab.glSheet(canvas, data, clipData, sel(lab.SWAT), c, s, 7, options.cellW, options.cellH, options.coat, options.over);
    else if (which === "extents") lab.glSheet(canvas, data, clipData, sel(lab.EXTENT_CELLS.filter((cell) => cell.label.startsWith(options.label))), c, s, 7, options.cellW, options.cellH, options.coat, options.over);
    else if (which === "walk") lab.glSheet(canvas, data, clipData, sel(lab.WALK), c, s, 7, 300, 230, options.coat, options.over);
    else if (which === "run") lab.glSheet(canvas, data, clipData, sel(lab.RUN), c, s, 7, 300, 230, options.coat, options.over);
    else if (which === "clip") lab.glSheet(canvas, data, clipData, sel(lab.clipCells(data, clipData, options.clip, options.n, options.view, options.blind, options.raise)).map((cell) => (options.headZoom ? { ...cell, zoom: { head: options.headAt, by: options.headZoom } } : cell)), c, s, 7, options.cellW, options.cellH, options.coat, options.over);
  },
  [kind, mesh, clips, scale, cols, pick, film, filmOptions],
);
const data = await page.evaluate(() => document.getElementById("c").toDataURL("image/png"));
mkdirSync(dirname(resolve(out)), { recursive: true });
writeFileSync(resolve(out), Buffer.from(data.split(",")[1], "base64"));
await browser.close();
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`wrote ${out}`);


