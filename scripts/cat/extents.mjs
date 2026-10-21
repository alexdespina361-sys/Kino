// How far the drawn solid cat reaches from its feet in each posture, measured from the pixels of pictures of it (src/client/cat/lab/gl.ts, glExtents):
// the box round every pixel that is drawn (not the faint ones), in body lengths, facing right. The engine's boxes (engine/ledges.ts) are kept to these.
//
//   node scripts/cat/extents.mjs [--coat=ginger] [--alpha=80] [--gpu=real] [--json]
//
// Development tooling (the cat lab): nothing it makes is part of the app.
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "./bundle.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const rest = process.argv.slice(2);
const flag = (name, fallback) => rest.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const coat = flag("coat", "ginger");
const alpha = Number(flag("alpha", 80));
const mesh = readFileSync(resolve(root, flag("mesh", "src/client/cat/render/gl/cat.mesh"))).toString("base64");
const code = await bundle(resolve(root, "src/client/cat/lab/gl.ts"), "CatLabGl");
const browser = await chromium.launch(
  flag("gpu", "soft") === "real" ? { channel: "chromium", args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] } : { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
);
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
await page.setContent("<!doctype html><body></body>");
await page.addScriptTag({ content: code });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const rows = await page.evaluate(([m, c, a]) => window.CatLabGl.glExtents(m, window.CatLabGl.EXTENT_CELLS, c, 7, a), [mesh, coat, alpha]);
await browser.close();
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
if (rest.includes("--json")) {
  console.log(JSON.stringify(rows));
  process.exit(0);
}
const f = (n) => n.toFixed(2).padStart(5);
const byClip = new Map();
for (const row of rows) {
  const clip = row.label.split("@")[0];
  const had = byClip.get(clip) ?? { ahead: 0, behind: 0, up: 0, down: 0, n: 0 };
  byClip.set(clip, { ahead: Math.max(had.ahead, row.ahead), behind: Math.max(had.behind, row.behind), up: Math.max(had.up, row.up), down: Math.max(had.down, row.down), n: had.n + 1 });
}
// (per height band of a tenth of a body length, the furthest back and forward of any picture of the clip: --profile=sit,loaf)
const wanted = flag("profile", "").split(",").filter(Boolean);
for (const clip of wanted) {
  const mine = rows.filter((row) => row.label.split("@")[0] === clip);
  if (mine.length === 0) continue;
  console.log(`profile of ${clip} (${mine.length} pictures): band = height above the feet in tenths of a body length; behind/ahead = furthest at that height`);
  for (let b = 0; b < 14; b++) {
    const behind = Math.max(...mine.map((row) => row.profile[b][0]));
    const ahead = Math.max(...mine.map((row) => row.profile[b][1]));
    console.log(`  ${String(b / 10).padStart(4)}-${String((b + 1) / 10).padEnd(4)} behind ${f(behind)}  ahead ${f(ahead)}`);
  }
}
console.log(`coat ${coat}, alpha >= ${alpha}/255, facing right; body lengths from the feet (ahead = the way it faces)`);
console.log("each picture:");
for (const row of rows) console.log(`  ${row.label.padEnd(14)} ahead ${f(row.ahead)}  behind ${f(row.behind)}  up ${f(row.up)}  down ${f(row.down)}`);
console.log("the most of any picture of each clip:");
for (const [clip, e] of byClip) console.log(`  ${clip.padEnd(14)} ahead ${f(e.ahead)}  behind ${f(e.behind)}  up ${f(e.up)}  down ${f(e.down)}   (${e.n})`);
