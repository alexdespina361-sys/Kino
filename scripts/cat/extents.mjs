// How far the drawn solid cat reaches from its feet in each posture, measured from the pixels of pictures of it (src/client/cat/lab/gl.ts, glExtents):
// per band of a tenth of a body length from the feet up, the furthest back and forward any picture of the clip is drawn (not the faint pixels: the fur's
// fringe and a whisker are not what covers a word), in body lengths, facing right. The engine's table (src/client/cat/engine/shape-table.ts) is made from
// this, and the cat is kept off the words by it; when the model or an animation changes, the table is made again.
//
//   node scripts/cat/extents.mjs                        what was measured, per clip (the most of any picture), and --profile=sit,loaf per band
//   node scripts/cat/extents.mjs --write                make src/client/cat/engine/shape-table.ts from it
//   node scripts/cat/extents.mjs --check                measure again and say (exit 1) if any picture reaches further than the table says
//   options: --coat=ginger --alpha=80 --gpu=real|soft --json
//
// Development tooling (the cat lab): nothing it makes, but the table, is part of the app.
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "./bundle.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const rest = process.argv.slice(2);
const flag = (name, fallback) => rest.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const coat = flag("coat", "ginger");
const alpha = Number(flag("alpha", 80));
const mesh = readFileSync(resolve(root, flag("mesh", "src/client/cat/render/gl/cat.mesh"))).toString("base64");
const tablePath = resolve(root, "src/client/cat/engine/shape-table.ts");
const code = await bundle(resolve(root, "src/client/cat/lab/gl.ts"), "CatLabGl");
const checking = rest.includes("--check");
const tableCode = checking ? await bundle(tablePath, "CatShapeTable") : "";
const browser = await chromium.launch(
  flag("gpu", "soft") === "real" ? { channel: "chromium", args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] } : { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
);
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
await page.setContent("<!doctype html><body></body>");
await page.addScriptTag({ content: code });
if (checking) await page.addScriptTag({ content: tableCode });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const rows = await page.evaluate(([m, c, a]) => window.CatLabGl.glExtents(m, window.CatLabGl.EXTENT_CELLS, c, 7, a), [mesh, coat, alpha]);
let tooFar = [];
if (checking) {
  // (in the page, where the table can be loaded as it is: every band of every picture is inside the table's)
  tooFar = await page.evaluate((measured) => {
    const { BANDS } = window.CatShapeTable;
    const out = [];
    for (const row of measured) {
      const bands = BANDS[row.clip];
      if (!bands) {
        out.push(`${row.label}: the table has no clip ${row.clip}`);
        continue;
      }
      row.profile.forEach(([behind, ahead], b) => {
        if (behind === 0 && ahead === 0) return;
        const have = bands[b];
        if (!have || have[0] + have[1] <= 0) out.push(`${row.label}: band ${b} is drawn (${behind.toFixed(2)} back, ${ahead.toFixed(2)} forward) and the table has nothing there`);
        else if (behind > have[0] + 1e-6 || ahead > have[1] + 1e-6) out.push(`${row.label}: band ${b} reaches ${behind.toFixed(2)} back / ${ahead.toFixed(2)} forward, the table says ${have[0]} / ${have[1]}`);
      });
    }
    return out;
  }, rows);
}
await browser.close();
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
if (rest.includes("--json")) {
  console.log(JSON.stringify(rows));
  process.exit(0);
}

/* ------------------------------ the table ------------------------------ */

const PAD = 0.02; // (a hair of room on every side, and on the side of more)
const up = (n) => Math.ceil(n * 100 - 1e-9) / 100;
const byClip = new Map();
for (const row of rows) byClip.set(row.clip, [...(byClip.get(row.clip) ?? []), row]);
const CLIPS = ["stand", "walk", "run", "sit", "loaf", "curl", "crouch", "jump", "stretch", "yawn", "groom", "pet", "point", "scratch", "knead", "sniff", "stalk", "wiggle", "peek", "tap", "doze", "shift"];
const missing = CLIPS.filter((clip) => !byClip.has(clip));
if (missing.length > 0) {
  console.error(`no pictures of: ${missing.join(", ")}`);
  process.exit(1);
}
const bandsOf = (pictures) => {
  const bands = [];
  for (let b = 0; b < 16; b++) {
    let behind = -Infinity;
    let ahead = -Infinity;
    for (const picture of pictures) {
      const [back, front] = picture.profile[b];
      if (back === 0 && front === 0) continue; // (nothing drawn at this height)
      behind = Math.max(behind, back);
      ahead = Math.max(ahead, front);
    }
    bands.push(Number.isFinite(behind) ? [up(behind + PAD), up(ahead + PAD)] : [0, 0]);
  }
  while (bands.length > 0 && bands.at(-1)[0] === 0 && bands.at(-1)[1] === 0) bands.pop();
  return bands;
};
const coreOf = (pictures) => [up(Math.max(...pictures.map((p) => p.core.behind))), up(Math.max(...pictures.map((p) => p.core.ahead))), up(Math.max(...pictures.map((p) => p.core.up)))];

if (rest.includes("--write")) {
  const lines = [
    "import type { Clip } from \"../types\";",
    "",
    "/*",
    " * Generated by `node scripts/cat/extents.mjs --write` from pictures of the drawn cat (the detailed cat, every clip, several moments of each, its head turned",
    ` * several ways; pixels drawn at ${alpha}/255 or more; ${PAD} of a body length added on every side). Do not edit by hand: when the cat's model or an animation changes,`,
    " * it is made again, and `--check` says whether it needs to be.",
    " */",
    "",
    "/** Per clip, per band of a tenth of a body length from the feet up: how far back and how far forward of its middle the cat reaches there (facing right), in body lengths. */",
    "export const BANDS: Record<Clip, ReadonlyArray<readonly [number, number]>> = {",
    ...CLIPS.map((clip) => `  ${clip}: [${bandsOf(byClip.get(clip)).map(([back, front]) => `[${back}, ${front}]`).join(", ")}],`),
    "};",
    "",
    "/** Per clip: how far back, how far forward and how high the body and the head reach, without the tail and the furthest of the rest: what a hand is on when it is on the cat. */",
    "export const CORES: Record<Clip, readonly [number, number, number]> = {",
    ...CLIPS.map((clip) => `  ${clip}: [${coreOf(byClip.get(clip)).join(", ")}],`),
    "};",
    "",
  ];
  writeFileSync(tablePath, lines.join("\n"));
  console.log(`wrote ${tablePath}`);
  process.exit(0);
}
if (checking) {
  if (tooFar.length > 0) {
    console.log(`${tooFar.length} bands reach further than the table says (made again with --write):`);
    for (const line of tooFar.slice(0, 40)) console.log(`  ${line}`);
    process.exit(1);
  }
  console.log(`every band of the ${rows.length} pictures is inside the table`);
  process.exit(0);
}

const f = (n) => n.toFixed(2).padStart(5);
const most = new Map();
for (const row of rows) {
  const had = most.get(row.clip) ?? { ahead: 0, behind: 0, up: 0, down: 0, n: 0 };
  most.set(row.clip, { ahead: Math.max(had.ahead, row.ahead), behind: Math.max(had.behind, row.behind), up: Math.max(had.up, row.up), down: Math.max(had.down, row.down), n: had.n + 1 });
}
for (const clip of flag("profile", "").split(",").filter(Boolean)) {
  const bands = bandsOf(byClip.get(clip) ?? []);
  console.log(`profile of ${clip} (${byClip.get(clip)?.length ?? 0} pictures, with the hair of room): band = height above the feet in tenths of a body length`);
  bands.forEach(([back, front], b) => console.log(`  ${String(b / 10).padStart(4)}-${String((b + 1) / 10).padEnd(4)} behind ${f(back)}  ahead ${f(front)}`));
}
console.log(`coat ${coat}, alpha >= ${alpha}/255, facing right; body lengths from the feet (ahead = the way it faces)`);
console.log("the most of any picture of each clip:   (core = the body and the head: all but the furthest 12 % of the pixels at each end)");
for (const [clip, e] of most) {
  const core = coreOf(byClip.get(clip));
  console.log(`  ${clip.padEnd(8)} ahead ${f(e.ahead)}  behind ${f(e.behind)}  up ${f(e.up)}  down ${f(e.down)}   core: behind ${f(core[0])} ahead ${f(core[1])} up ${f(core[2])}   (${e.n} pictures)`);
}
