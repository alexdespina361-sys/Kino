// Pictures of the solid cat for looking at it: bundles src/client/cat/lab/gl.ts for the browser, runs it in Chromium (with the card's own driver
// if there is one, else the software one) and saves a PNG.
//
//   node scripts/cat/glsheet.mjs views|poses <out.png> [--scale=2] [--mesh=src/client/cat/render/gl/cat.mesh] [--cols=4] [--pick=0,3]
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
const cols = Number(flag("cols", 4));
const pick = flag("pick", "").split(",").filter(Boolean).map(Number);

const code = await bundle(resolve(root, "src/client/cat/lab/gl.ts"), "CatLabGl");
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.setContent('<!doctype html><body style="margin:0;background:#000"><canvas id="c"></canvas></body>');
await page.addScriptTag({ content: code });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => {
  if (message.type() === "error" || message.type() === "warning") errors.push(message.text());
});
await page.evaluate(
  ([which, data, s, c, chosen]) => {
    const canvas = document.getElementById("c");
    const lab = window.CatLabGl;
    const sel = (list) => (chosen.length ? chosen.map((i) => list[i]) : list);
    if (which === "views") lab.glSheet(canvas, data, sel(lab.VIEWS), c, s, 7, 300, 260);
    else if (which === "poses") lab.glSheet(canvas, data, sel(lab.GL_POSES), c, s);
    else if (which === "faces2") lab.glSheet(canvas, data, sel(lab.FACES2), c, s, 7, 400, 340);
    else if (which === "faces") lab.glSheet(canvas, data, sel(lab.FACES), c, s, 7, 400, 340);
    else if (which === "faces3") lab.glSheet(canvas, data, sel(lab.FACES3), c, s, 7, 400, 340);
  },
  [kind, mesh, scale, cols, pick],
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


