// One line per screen size and look from the walk's live-DOM scans: does anything scroll sideways, how small is the smallest text, how many controls are
// under 44 px (phone) or 24 px, how much text has too little contrast or is cut, and how much text runs past the right edge. The same numbers for both
// looks side by side, so "the refined look at 360x800 and the classic look at 360x800" is a measurement. (drift.mjs adds everything up per look; this
// splits it per size.)
//
//   node scripts/ui-walk/responsive.mjs [--looks=classic,polish] [--scan=.ui-polish/scan]
//
// Needs the scans of the walk (run.mjs --scan, once per look and size). A size that was not walked for a look shows "-".
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const option = (name, fallback) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const looks = option("looks", "classic,polish").split(",");
const scanRoot = option("scan", ".ui-polish/scan");

/** phone-390-signed-in and phone-390 are one size (two accounts); tv-1280-keys is the same screen again with the remote somewhere else. */
const sizeOf = (dir) => dir.replace(/-signed-in$/, "").replace(/-keys$/, "");
const area = (size) => {
  const m = /(\d+)x?(\d+)?$/.exec(size);
  return m ? Number(m[1]) * (m[2] ? Number(m[2]) : 1) : 0;
};

function measure(look, size) {
  const root = join(scanRoot, look);
  if (!existsSync(root)) return null;
  const dirs = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && (sizeOf(entry.name) === size) && !entry.name.endsWith("-keys"));
  if (dirs.length === 0) return null;
  const tv = size.startsWith("tv-");
  const row = { pictures: 0, sideways: 0, smallest: Infinity, under44: 0, under24: 0, contrast: 0, cut: 0, past: 0, width: 0, height: 0 };
  for (const dir of dirs) {
    for (const file of readdirSync(join(root, dir.name)).filter((name) => name.endsWith(".json"))) {
      const data = JSON.parse(readFileSync(join(root, dir.name, file), "utf8"));
      const { width, height, sidewaysScroll } = data.page;
      row.pictures++;
      row.width = width;
      row.height = height;
      if (sidewaysScroll) row.sideways++;
      for (const e of data.elements) {
        if (!e.inView) continue;
        const text = e.kinds.includes("text");
        const control = e.kinds.includes("control");
        if (text && e.fs) row.smallest = Math.min(row.smallest, tv ? (e.fs / width) * 100 : e.fs);
        if (text && e.contrast != null && !e.textStroke) {
          const large = e.fs >= 24 || (e.fs >= 18.66 && Number(e.fw) >= 700);
          if (e.contrast < (large ? 3 : 4.5)) row.contrast++;
        }
        if (text && ((e.clipped && !e.ellipsis) || e.clippedTall)) row.cut++;
        // (a row of pictures that scrolls past the edge on purpose is not text running off)
        if (text && e.x + e.w > width + 1 && !/scroller|lib-card|tile|row/.test(`${e.cls ?? ""} ${e.in ?? ""}`)) row.past++;
        if (control) {
          const side = Math.min(...(e.hit ?? [e.w, e.h]));
          if (side < 24) row.under24++;
          else if (!tv && side < 44 && e.tag !== "a") row.under44++;
        }
      }
    }
  }
  return row;
}

const sizes = new Set();
for (const look of looks) {
  const root = join(scanRoot, look);
  if (!existsSync(root)) continue;
  for (const entry of readdirSync(root, { withFileTypes: true })) if (entry.isDirectory() && !entry.name.endsWith("-keys")) sizes.add(sizeOf(entry.name));
}
const order = [...sizes].sort((a, b) => a.split("-")[0].localeCompare(b.split("-")[0]) || area(a) - area(b));

const cell = (row, key, tv) => {
  if (!row) return "-";
  if (key === "smallest") return row.smallest === Infinity ? "-" : tv ? `${row.smallest.toFixed(2)}% of width` : `${row.smallest} px`;
  return String(row[key]);
};
const heads = ["size", "look", "pictures", "scroll sideways", "smallest text", "targets < 44 px", "targets < 24 px", "low contrast", "text cut", "text past the edge"];
const lines = [`| ${heads.join(" | ")} |`, `|${heads.map(() => "---").join("|")}|`];
for (const size of order) {
  const tv = size.startsWith("tv-");
  for (const look of looks) {
    const row = measure(look, size);
    lines.push(`| ${size} | ${look} | ${[cell(row, "pictures"), cell(row, "sideways"), cell(row, "smallest", tv), tv ? "n/a" : cell(row, "under44"), cell(row, "under24"), cell(row, "contrast"), cell(row, "cut"), cell(row, "past")].join(" | ")} |`);
  }
}
console.log(lines.join("\n"));
