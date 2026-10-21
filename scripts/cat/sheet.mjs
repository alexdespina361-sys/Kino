// Pictures of the cat for looking at it: bundles src/client/cat/lab/entry.ts for the browser, runs it in Chromium and saves a PNG.
//
//   node scripts/cat/sheet.mjs poses|carried|walk|run|jump <out.png> [--scale=2]
//
// Development tooling (the cat lab): nothing it makes is part of the app.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "./bundle.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const [kind = "poses", out = ".kino-cat/sheet.png", ...rest] = process.argv.slice(2);
const scale = Number(rest.find((arg) => arg.startsWith("--scale="))?.slice(8) ?? 1);

const code = await bundle(resolve(root, "src/client/cat/lab/entry.ts"), "CatLab");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.setContent('<!doctype html><body style="margin:0;background:#000"><canvas id="c"></canvas></body>');
await page.addScriptTag({ content: code });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
await page.evaluate(
  ([which, s]) => {
    const canvas = document.getElementById("c");
    const lab = window.CatLab;
    if (which === "poses") lab.sheet(canvas, lab.POSES, 4, s);
    else if (which === "carried") lab.sheet(canvas, lab.CARRIED, 3, s, 7, 110);
    else if (which === "walk") lab.walkStrip(canvas, 8, false, s);
    else if (which === "run") lab.walkStrip(canvas, 8, true, s);
    else if (which === "jump") lab.jumpStrip(canvas, 10, s);
  },
  [kind, scale],
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
