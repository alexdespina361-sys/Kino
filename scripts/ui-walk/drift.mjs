// Adds up the live-DOM scans of the walk (scan.mjs) into the design-drift report: what the pages really use (type sizes, weights, radii, colours,
// shadows, motion) and where they break the rules written in docs/ui-polish/REFERENCE_PRINCIPLES.md (small text, small targets, low contrast,
// controls without a name, content outside the TV's safe margin, sideways scroll, text cut without an ellipsis).
//
//   node scripts/ui-walk/drift.mjs [--look=classic|polish] [--scan=.ui-polish/scan] [--out=docs/ui-polish/drift] [--examples=6]
//
// Writes <out>/<look>.json and <out>/<look>.md; the newest one is copied to latest.json / latest.md. Exit code is 0: this reports, the tests judge.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const option = (name, fallback) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const look = option("look", "classic");
const scanDir = join(option("scan", ".ui-polish/scan"), look);
const outDir = option("out", "docs/ui-polish/drift");
const examples = Number(option("examples", "6"));

/* ------------------------------ load ------------------------------ */

const pages = [];
for (const device of readdirSync(scanDir, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
  for (const file of readdirSync(join(scanDir, device.name)).filter((name) => name.endsWith(".json"))) {
    const data = JSON.parse(readFileSync(join(scanDir, device.name, file), "utf8"));
    pages.push({ device: device.name, name: file.replace(/\.json$/, ""), ...data });
  }
}
if (pages.length === 0) {
  console.error(`no scans in ${scanDir} (run the walk with --scan first)`);
  process.exit(2);
}
const isTv = (page) => page.device.startsWith("tv-");
const isPhone = (page) => page.device.startsWith("phone-");

/* ------------------------------ helpers ------------------------------ */

const tally = () => new Map();
const add = (map, key, page, element) => {
  const row = map.get(key) ?? { count: 0, pages: new Set(), sample: undefined };
  row.count++;
  row.pages.add(`${page.device}/${page.name}`);
  row.sample ??= describe(element);
  map.set(key, row);
};
const describe = (element) => `${element.tag}${element.id ? `[${element.id}]` : element.cls ? `.${element.cls.split(" ")[0]}` : ""}${element.text ? ` "${element.text}"` : element.label ? ` (${element.label})` : ""}`;
const table = (map, { sortBy = "count", numeric = false, limit = 25 } = {}) =>
  [...map.entries()]
    .sort((a, b) => (numeric ? parseFloat(a[0]) - parseFloat(b[0]) : b[1][sortBy] - a[1][sortBy]))
    .slice(0, limit)
    .map(([key, row]) => ({ value: key, count: row.count, pages: row.pages.size, sample: row.sample }));
const md = (rows, heads) => [`| ${heads.join(" | ")} |`, `|${heads.map(() => "---").join("|")}|`, ...rows.map((row) => `| ${heads.map((head) => String(row[head] ?? "").replace(/\|/g, "\\|")).join(" | ")} |`)].join("\n");

/* ------------------------------ the census ------------------------------ */

const census = { tv: {}, phone: {} };
for (const kind of ["tv", "phone"]) {
  census[kind] = { fontSize: tally(), fontWeight: tally(), lineHeight: tally(), radius: tally(), textColour: tally(), fill: tally(), border: tally(), shadow: tally(), transition: tally(), animation: tally(), padding: tally(), gap: tally(), iconSize: tally(), fontFamily: tally() };
}
const problems = {
  smallText: [],
  smallTarget: [],
  tinyTarget: [],
  unnamed: [],
  contrast: [],
  safeMargin: [],
  sideways: [],
  cutText: [],
  noFocus: [],
  fewTargets: [],
};
let elementCount = 0;

for (const page of pages) {
  const kind = isTv(page) ? "tv" : "phone";
  const c = census[kind];
  const { width, height, em } = page.page;
  // On the TV everything is in ems of the screen, so sizes are told in em (what the CSS wrote), on the phone in px.
  const unit = (px) => (kind === "tv" && em ? `${Math.round((px / em) * 20) / 20}em` : `${px}px`);
  if (isTv(page) && !page.page.focused) problems.noFocus.push(`${page.device}/${page.name}`);
  if (page.page.sidewaysScroll) problems.sideways.push({ picture: `${page.device}/${page.name}`, scrollWidth: page.page.scrollWidth, width });

  for (const element of page.elements) {
    elementCount++;
    const where = `${page.device}/${page.name}`;
    const kinds = element.kinds;
    const visible = element.inView;

    if (visible && (kinds.includes("text") || kinds.includes("control")) && element.fs) {
      add(c.fontSize, unit(element.fs), page, element);
      add(c.fontWeight, element.fw, page, element);
      add(c.lineHeight, element.lh === "normal" ? "normal" : unit(element.lh), page, element);
      add(c.fontFamily, element.ff, page, element);
      if (element.fg) add(c.textColour, element.fg, page, element);
    }
    if (visible && kinds.includes("icon") && element.fs) add(c.iconSize, unit(Math.round(Math.max(element.w, element.h))), page, element);
    if (visible && kinds.includes("surface")) {
      // (a radius of half the shorter side or more is a pill/circle, whatever number the CSS wrote: 999px, 50%, 9em)
      if (element.radius) add(c.radius, element.radius >= Math.min(element.w, element.h) / 2 - 0.5 ? "pill / circle" : unit(element.radius), page, element);
      if (element.fill) add(c.fill, element.fill, page, element);
      if (element.border) add(c.border, element.border, page, element);
      if (element.shadow) add(c.shadow, element.shadow, page, element);
    }
    if (visible && element.pad) add(c.padding, element.pad, page, element);
    if (visible && element.gap) add(c.gap, unit(element.gap), page, element);
    if (element.transition) add(c.transition, element.transition, page, element);
    if (element.animation) add(c.animation, element.animation, page, element);

    if (!visible) continue;
    const text = kinds.includes("text");
    const control = kinds.includes("control");

    // text size: on the TV the rule is the test suite's (smallest visible text >= 1.15% of the width); on the phone 12 px
    if (text && element.fs) {
      const floor = kind === "tv" ? width * 0.0115 : 12;
      if (element.fs < floor - 0.01) problems.smallText.push({ picture: where, element: describe(element), size: element.fs, floor: Math.round(floor * 10) / 10 });
    }
    // contrast: 4.5 (3 for large text: 24 px, or 18.66 px bold)
    if (text && element.contrast != null) {
      const large = element.fs >= 24 || (element.fs >= 18.66 && Number(element.fw) >= 700);
      const need = large ? 3 : 4.5;
      if (element.contrast < need) problems.contrast.push({ picture: where, element: describe(element), ratio: element.contrast, need, fg: element.fg, bg: element.bg });
    }
    if (control) {
      const side = Math.min(element.w, element.h);
      if (element.named === false) problems.unnamed.push({ picture: where, element: describe(element), size: `${element.w}x${element.h}` });
      if (side < 24) problems.tinyTarget.push({ picture: where, element: describe(element), size: `${element.w}x${element.h}` });
      else if (kind === "phone" && side < 44 && element.tag !== "a") problems.smallTarget.push({ picture: where, element: describe(element), size: `${element.w}x${element.h}` });
    }
    // the TV's safe margin: text and controls inside 2.5% left/right and 5% top/bottom (backgrounds and pictures may run to the edge)
    if (kind === "tv" && (text || control) && element.position !== "fixed-background") {
      const left = element.x / width;
      const right = (element.x + element.w) / width;
      const top = element.y / height;
      const bottom = (element.y + element.h) / height;
      if (left < 0.025 || right > 0.975 || top < 0.05 || bottom > 0.95) {
        // an element wider than the screen (a row that scrolls) is not about the margin
        if (element.w < width * 0.95) problems.safeMargin.push({ picture: where, element: describe(element), edges: `${(left * 100).toFixed(1)}% .. ${(right * 100).toFixed(1)}% / ${(top * 100).toFixed(1)}% .. ${(bottom * 100).toFixed(1)}%` });
      }
    }
    if (text && element.clipped && !element.ellipsis) problems.cutText.push({ picture: where, element: describe(element), size: `${element.w}x${element.h}` });
  }
  const targets = page.elements.filter((element) => element.inView && element.kinds.includes("control") && element.tabbable).length;
  if (targets === 0 && !page.device.includes("player")) problems.fewTargets.push(`${page.device}/${page.name}`);
}

/* ------------------------------ report ------------------------------ */

const unique = (list, key) => {
  const seen = new Map();
  for (const item of list) {
    const id = key(item);
    const row = seen.get(id) ?? { ...item, count: 0, pictures: new Set() };
    row.count++;
    row.pictures.add(item.picture);
    seen.set(id, row);
  }
  return [...seen.values()].map(({ pictures, ...rest }) => ({ ...rest, pictures: pictures.size }));
};
const grouped = {
  smallText: unique(problems.smallText, (p) => `${p.element}|${p.size}`).sort((a, b) => a.size - b.size),
  contrast: unique(problems.contrast, (p) => `${p.element}|${p.fg}|${p.bg}`).sort((a, b) => a.ratio - b.ratio),
  smallTarget: unique(problems.smallTarget, (p) => `${p.element}|${p.size}`),
  tinyTarget: unique(problems.tinyTarget, (p) => `${p.element}|${p.size}`),
  unnamed: unique(problems.unnamed, (p) => `${p.element}|${p.size}`),
  safeMargin: unique(problems.safeMargin, (p) => `${p.element}|${p.edges}`),
  cutText: unique(problems.cutText, (p) => `${p.element}|${p.size}`),
};

const json = {
  look,
  generated: new Date().toISOString(),
  pages: pages.length,
  elements: elementCount,
  census: Object.fromEntries(Object.entries(census).map(([kind, maps]) => [kind, Object.fromEntries(Object.entries(maps).map(([name, map]) => [name, table(map, { limit: 60 })]))])),
  problems: { ...grouped, sideways: problems.sideways, noFocus: problems.noFocus, fewTargets: problems.fewTargets },
};
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `${look}.json`), JSON.stringify(json, null, 2));

const lines = [`# Design drift: the ${look} look`, "", `${pages.length} screens scanned, ${elementCount} elements measured (${json.generated.slice(0, 10)}). Made by \`scripts/ui-walk/drift.mjs\` from the walk's live-DOM scans.`, ""];
lines.push("## What the pages use", "", "TV sizes are in em (what the CSS wrote; 1em = the TV's own scale), the phone's in px. 'screens' = how many of the walk's pictures have it.", "");
for (const kind of ["tv", "phone"]) {
  lines.push(`### ${kind === "tv" ? "TV / desktop screen" : "Phone"}`, "");
  const c = json.census[kind];
  const distinct = (name) => c[name].length;
  lines.push(`${distinct("fontSize")} distinct type sizes, ${distinct("fontWeight")} weights, ${distinct("radius")} radii, ${distinct("fill")} surface colours, ${distinct("textColour")} text colours, ${distinct("shadow")} shadows, ${distinct("transition")} transitions.`, "");
  for (const [name, title, limit] of [
    ["fontSize", "Type sizes", 40],
    ["fontWeight", "Weights", 10],
    ["lineHeight", "Line heights", 12],
    ["radius", "Radii", 20],
    ["iconSize", "Icon sizes", 15],
    ["gap", "Gaps", 15],
    ["textColour", "Text colours", 15],
    ["fill", "Surface colours", 20],
    ["border", "Borders", 10],
    ["shadow", "Shadows", 8],
    ["transition", "Transitions", 15],
    ["animation", "Animations", 10],
  ]) {
    if (c[name].length === 0) continue;
    lines.push(`**${title}**`, "", md(c[name].slice(0, limit), ["value", "count", "pages", "sample"]), "");
  }
}
const section = (title, list, heads, note) => {
  lines.push(`## ${title} (${list.length})`, "");
  if (note) lines.push(note, "");
  if (list.length === 0) lines.push("None.", "");
  else lines.push(md(list.slice(0, 40), heads), "", list.length > 40 ? `...and ${list.length - 40} more in the json.` : "", "");
};
lines.push("# Rule breaks", "");
section("Text smaller than the floor", grouped.smallText, ["element", "size", "floor", "count", "pictures"], "TV: 1.15% of the screen width (the test suite's rule). Phone: 12 px.");
section("Text with too little contrast", grouped.contrast, ["element", "ratio", "need", "fg", "bg", "count", "pictures"], "4.5:1 (3:1 for large text). Text over a picture is not measured.");
section("Controls with no name", grouped.unnamed, ["element", "size", "count", "pictures"], "A control with no text, aria-label or title cannot be told apart by a screen reader.");
section("Controls under 24 px", grouped.tinyTarget, ["element", "size", "count", "pictures"], "WCAG 2.2 target size (minimum), AA.");
section("Phone controls under 44 px", grouped.smallTarget, ["element", "size", "count", "pictures"], "The comfortable thumb target. Links inside running text are left out.");
section("Text or controls outside the TV's safe margin", grouped.safeMargin, ["element", "edges", "count", "pictures"], "Inside 2.5% of the left/right edge or 5% of the top/bottom. Rows that scroll past the edge are not counted.");
section("Text that is cut without an ellipsis", grouped.cutText, ["element", "size", "count", "pictures"]);
lines.push(`## Screens that scroll sideways (${problems.sideways.length})`, "", problems.sideways.length ? md(problems.sideways, ["picture", "scrollWidth", "width"]) : "None.", "");
lines.push(`## TV screens with nothing focused (${problems.noFocus.length})`, "", problems.noFocus.length ? problems.noFocus.map((one) => `- ${one}`).join("\n") : "None.", "");
lines.push(`## Screens with no keyboard-reachable control (${problems.fewTargets.length})`, "", problems.fewTargets.length ? problems.fewTargets.map((one) => `- ${one}`).join("\n") : "None.", "");
writeFileSync(join(outDir, `${look}.md`), lines.join("\n"));
copyFileSync(join(outDir, `${look}.json`), join(outDir, "latest.json"));
copyFileSync(join(outDir, `${look}.md`), join(outDir, "latest.md"));

const total = (list) => list.reduce((sum, row) => sum + row.count, 0);
console.log(`${look}: ${pages.length} screens, ${elementCount} elements`);
console.log(`  type sizes: tv ${json.census.tv.fontSize.length}, phone ${json.census.phone.fontSize.length}; radii: tv ${json.census.tv.radius.length}, phone ${json.census.phone.radius.length}; surface colours: tv ${json.census.tv.fill.length}, phone ${json.census.phone.fill.length}`);
console.log(`  rule breaks: small text ${grouped.smallText.length} kinds (${total(grouped.smallText)}), contrast ${grouped.contrast.length} (${total(grouped.contrast)}), unnamed ${grouped.unnamed.length}, <24px ${grouped.tinyTarget.length}, phone <44px ${grouped.smallTarget.length}, outside safe margin ${grouped.safeMargin.length}, cut text ${grouped.cutText.length}, sideways ${problems.sideways.length}, no focus ${problems.noFocus.length}`);
console.log(`report: ${join(outDir, `${look}.md`)}`);
void examples;
