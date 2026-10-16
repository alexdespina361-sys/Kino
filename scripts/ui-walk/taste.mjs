// Taste calibration pictures: for each question in taste/questions.json, the refined look as it is (A) and with one thing changed (B, taste/<id>.css added
// to the page), on the same screens, side by side. The owner chooses; the answers go to docs/ui-polish/DECISIONS.md.
//
//   node scripts/ui-walk/taste.mjs [--only=A1,B2] [--no-build] [--compose-only]       pictures: .ui-polish/taste/<id>-tv.png, <id>-phone.png
// (--compose-only: the walks are done, only put the pictures together again, e.g. after changing a crop in taste/questions.json.
// A shot may carry crop [x, y, width, height] in picture pixels and scale: the part that matters, bigger, instead of the whole screen. A is above B.
// A name in names may be { name, crop } for a crop of its own.)
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const args = process.argv.slice(2);
const option = (name, fallback) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const here = (name) => fileURLToPath(new URL(name, import.meta.url));
const only = option("only", "").split(",").filter(Boolean);
const outRoot = ".ui-polish/taste";
const questions = JSON.parse(readFileSync(here("taste/questions.json"), "utf8")).filter((q) => only.length === 0 || only.includes(q.id));

const composeOnly = args.includes("--compose-only");
if (!args.includes("--no-build") && !composeOnly) {
  const built = spawnSync(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--outDir", ".ui-polish/dist-iter", "--emptyOutDir"], { stdio: "ignore" });
  if (built.status !== 0) throw new Error("the build failed");
}

let port = 9300 + Math.floor(Math.random() * 400);
function walk(question, variant, shot) {
  const env = { ...process.env, CLIENT_DIR: ".ui-polish/dist-iter", PHONE_PARTS: "guest" };
  if (variant === "B") env.TASTE_CSS = here(`taste/${question.id}.css`);
  if (question.attr) env.TASTE_ATTR = question.attr;
  const run = spawnSync(
    process.execPath,
    [here("run.mjs"), "--no-build", `--only=${shot.part}`, `--steps=${shot.steps.join(",")}`, `--out=${outRoot}/${question.id}/${variant}`, `--port=${port++}`],
    { env, encoding: "utf8" },
  );
  const failed = (run.stdout ?? "").split("\n").filter((line) => line.startsWith("FAIL"));
  if (run.status !== 0 || failed.length > 0) console.log(`${question.id}/${variant}/${shot.part}: ${failed.join(" | ") || "exit " + run.status}`);
}

/* ------------------------------ pictures ------------------------------ */

const read = (path) => PNG.sync.read(readFileSync(path));
function crop(png, [x, y, w, h]) {
  const out = new PNG({ width: w, height: h });
  PNG.bitblt(png, out, x, y, w, h, 0, 0);
  return out;
}
/** Smaller by an area average (a picture shrunk by dropping pixels would shimmer). */
function scale(png, factor) {
  const w = Math.round(png.width * factor);
  const h = Math.round(png.height * factor);
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x / factor);
      const x1 = Math.max(x0 + 1, Math.min(png.width, Math.ceil((x + 1) / factor)));
      const y0 = Math.floor(y / factor);
      const y1 = Math.max(y0 + 1, Math.min(png.height, Math.ceil((y + 1) / factor)));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const i = (yy * png.width + xx) * 4;
        r += png.data[i]; g += png.data[i + 1]; b += png.data[i + 2]; n++;
      }
      const o = (y * w + x) * 4;
      out.data[o] = r / n; out.data[o + 1] = g / n; out.data[o + 2] = b / n; out.data[o + 3] = 255;
    }
  }
  return out;
}
const GLYPH = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
};
const BAR = 46;
const GAP = 14;
const BACK = [24, 24, 28];

function canvas(w, h) {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) { png.data[i * 4] = BACK[0]; png.data[i * 4 + 1] = BACK[1]; png.data[i * 4 + 2] = BACK[2]; png.data[i * 4 + 3] = 255; }
  return png;
}
function paste(into, from, x, y) {
  for (let yy = 0; yy < from.height; yy++) for (let xx = 0; xx < from.width; xx++) {
    const i = (yy * from.width + xx) * 4;
    const o = ((y + yy) * into.width + (x + xx)) * 4;
    into.data[o] = from.data[i]; into.data[o + 1] = from.data[i + 1]; into.data[o + 2] = from.data[i + 2]; into.data[o + 3] = 255;
  }
}
function letter(into, ch, x, y, px = 5) {
  GLYPH[ch].forEach((row, r) => [...row].forEach((c, k) => {
    if (c !== "#") return;
    for (let yy = 0; yy < px; yy++) for (let xx = 0; xx < px; xx++) {
      const o = ((y + r * px + yy) * into.width + (x + k * px + xx)) * 4;
      into.data[o] = 245; into.data[o + 1] = 245; into.data[o + 2] = 247;
    }
  }));
}
/** A picture of every name, A above B (a phone shows a tall picture at its own width; two side by side would be half that), each marked with its letter. */
function compose(question, shot, factor) {
  const cell = (variant, { name, crop: box }) => {
    const whole = read(`${outRoot}/${question.id}/${variant}/${shot.device}/${name}.png`);
    return scale(box ? crop(whole, box) : whole, factor);
  };
  const named = shot.names.map((entry) => (typeof entry === "string" ? { name: entry, crop: shot.crop } : { crop: shot.crop, ...entry }));
  const blocks = named.flatMap((entry) => ["A", "B"].map((variant) => ({ variant, image: cell(variant, entry) })));
  const width = Math.max(...blocks.map((block) => block.image.width)) + GAP * 2;
  const height = blocks.reduce((sum, block) => sum + BAR + block.image.height + GAP, 0);
  const png = canvas(width, height);
  let y = 0;
  for (const { variant, image } of blocks) {
    letter(png, variant, GAP, y + 6);
    paste(png, image, GAP, y + BAR);
    y += BAR + image.height + GAP;
  }
  return png;
}

mkdirSync(outRoot, { recursive: true });
for (const question of questions) {
  if (!composeOnly) for (const variant of ["A", "B"]) for (const shot of question.shots) walk(question, variant, shot);
  for (const kind of ["tv", "phone"]) {
    const shot = question.shots.find((s) => s.kind === kind);
    if (!shot) continue;
    try {
      const png = compose(question, shot, shot.scale ?? 0.5);
      writeFileSync(`${outRoot}/${question.id}-${kind}.png`, PNG.sync.write(png));
      console.log(`${question.id}-${kind}.png  ${png.width}x${png.height}`);
    } catch (error) {
      console.log(`${question.id}-${kind}: ${String(error.message).split("\n")[0]}`);
    }
  }
}
if (!existsSync(outRoot)) process.exitCode = 1;
