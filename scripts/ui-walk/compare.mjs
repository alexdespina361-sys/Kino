// Compares two folders of walk pictures (the same names in both): how much of each one changed, and a picture of the change.
//
//   node scripts/ui-walk/compare.mjs <before> <after> [--out=.ui-polish/diff] [--min=0.0005] [--tolerance=0.1]
//
// For every picture in <before> that is in <after> too it counts the pixels that differ (pixelmatch, `tolerance` = how different a colour must
// be to count, 0..1). A picture that changed by more than `min` (a fraction of its pixels) gets a side-by-side (before | after | changes) in
// <out>/side/, and every picture a line in <out>/report.md and report.json. The exit code is 1 when anything changed by more than `min`
// or went missing: for the classic look against its baseline that is "something that must not change did".
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const args = process.argv.slice(2);
const positional = args.filter((arg) => !arg.startsWith("--"));
const option = (name, fallback) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const [beforeDir, afterDir] = positional;
if (!beforeDir || !afterDir) {
  console.error("usage: node scripts/ui-walk/compare.mjs <before> <after> [--out=dir] [--min=0.0005] [--tolerance=0.1]");
  process.exit(2);
}
const outDir = option("out", ".ui-polish/diff");
const min = Number(option("min", "0.0005"));
const tolerance = Number(option("tolerance", "0.1"));

function pictures(dir, at = dir) {
  return readdirSync(at).flatMap((name) => {
    const path = join(at, name);
    if (statSync(path).isDirectory()) return pictures(dir, path);
    // (a "-live" picture has a frame of a film in it, which is never the same twice: it is there to be looked at, not compared)
    return name.endsWith(".png") && !name.endsWith("-live.png") ? [relative(dir, path).replaceAll("\\", "/")] : [];
  });
}

/** Half the width and height (the average of each 2 x 2): a side-by-side of three full-size pictures is too wide to look at. */
function halve(png) {
  const w = png.width >> 1;
  const h = png.height >> 1;
  const half = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 4; c++) {
        const at = (px, py) => png.data[((py * png.width + px) << 2) + c];
        half.data[((y * w + x) << 2) + c] = (at(2 * x, 2 * y) + at(2 * x + 1, 2 * y) + at(2 * x, 2 * y + 1) + at(2 * x + 1, 2 * y + 1)) >> 2;
      }
    }
  }
  return half;
}

function sideBySide(before, after, changes) {
  let panels = [before, after, changes];
  if (before.width > 1500) panels = panels.map(halve);
  const gap = 6;
  const { width, height } = panels[0];
  const sheet = new PNG({ width: width * 3 + gap * 2, height });
  sheet.data.fill(255);
  panels.forEach((panel, n) => PNG.bitblt(panel, sheet, 0, 0, width, height, n * (width + gap), 0));
  return sheet;
}

const names = pictures(beforeDir).sort();
const known = new Set(pictures(afterDir));
const rows = [];
for (const name of names) {
  if (!known.has(name)) {
    rows.push({ name, status: "missing" });
    continue;
  }
  const before = PNG.sync.read(readFileSync(join(beforeDir, name)));
  const after = PNG.sync.read(readFileSync(join(afterDir, name)));
  if (before.width !== after.width || before.height !== after.height) {
    rows.push({ name, status: "size", before: `${before.width}x${before.height}`, after: `${after.width}x${after.height}` });
    continue;
  }
  const changes = new PNG({ width: before.width, height: before.height });
  const differing = pixelmatch(before.data, after.data, changes.data, before.width, before.height, { threshold: tolerance, includeAA: false, diffColor: [255, 0, 80], alpha: 0.35 });
  const share = differing / (before.width * before.height);
  const row = { name, status: share > min ? "changed" : "same", share };
  if (share > min) {
    const side = join(outDir, "side", name);
    mkdirSync(dirname(side), { recursive: true });
    writeFileSync(side, PNG.sync.write(sideBySide(before, after, changes)));
    row.side = side.replaceAll("\\", "/");
  }
  rows.push(row);
}
for (const name of [...known].sort()) if (!names.includes(name)) rows.push({ name, status: "new" });

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "report.json"), JSON.stringify({ before: beforeDir, after: afterDir, min, tolerance, rows }, null, 2));
const count = (status) => rows.filter((row) => row.status === status).length;
const md = [
  `# ${beforeDir} -> ${afterDir}`,
  "",
  `${rows.length} pictures: ${count("same")} the same, ${count("changed")} changed (more than ${(min * 100).toFixed(3)}% of the pixels), ${count("size")} of another size, ${count("missing")} missing, ${count("new")} new.`,
  "",
  "| picture | what happened | changed |",
  "|---|---|---|",
  ...rows
    .filter((row) => row.status !== "same")
    .sort((a, b) => (b.share ?? 1) - (a.share ?? 1))
    .map((row) => `| ${row.name} | ${row.status}${row.status === "size" ? ` (${row.before} -> ${row.after})` : ""} | ${row.share === undefined ? "" : `${(row.share * 100).toFixed(2)}%`} |`),
  "",
];
writeFileSync(join(outDir, "report.md"), md.join("\n"));
console.log(md.slice(0, 3).join("\n"));
for (const row of rows.filter((one) => one.status === "changed").sort((a, b) => b.share - a.share).slice(0, 15)) console.log(`  ${(row.share * 100).toFixed(2).padStart(6)}%  ${row.name}`);
console.log(`report: ${join(outDir, "report.md")}`);
process.exit(count("changed") + count("size") + count("missing") === 0 ? 0 : 1);
