// The phone work's before and after, in the same numbers phone-numbers.mjs prints, but only over the screens the two walks have in common (matched by name, without a
// "-1of3" part), so that a screen that exists only in the new layout cannot flatter it. Two scan folders, one before and one after:
//
//   node scripts/ui-walk/phone-compare.mjs <before scan root> <before folder> <after scan root> <after folder> [--all]
//   e.g.  node scripts/ui-walk/phone-compare.mjs .ui-polish/scan/before phone-390 .ui-polish/scan/final phone-390x844
//
// --all compares every screen of each walk instead. The bar's four words (12 px, the only text on the phone under 14 px) are told apart: a second "smallest text"
// is given without them. docs/phone-layout/QA.md has the tables this made.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const all = process.argv.includes("--all");
const [beforeRoot, beforeFolder, afterRoot, afterFolder] = args;
if (!afterFolder) {
  console.error("usage: node scripts/ui-walk/phone-compare.mjs <before scan root> <before folder> <after scan root> <after folder> [--all]");
  process.exit(2);
}
const base = (name) => name.replace(/-\d+of\d+$/, "").replace(/\.json$/, "");
const read = (root, folder) =>
  existsSync(join(root, folder))
    ? readdirSync(join(root, folder)).filter((f) => f.endsWith(".json")).map((f) => ({ name: f.replace(/\.json$/, ""), base: base(f), data: JSON.parse(readFileSync(join(root, folder, f), "utf8")) }))
    : [];
const before = read(beforeRoot, beforeFolder);
const after = read(afterRoot, afterFolder);
const common = new Set(before.map((s) => s.base).filter((b) => after.some((s) => s.base === b)));
const pick = (list) => (all ? list : list.filter((s) => common.has(s.base)));

function numbers(screens) {
  let text = { px: Infinity, what: "", where: "" };
  let textNoBar = { px: Infinity, what: "", where: "" };
  let under14 = 0;
  let under14NoBar = 0;
  let target = { px: Infinity, what: "", where: "" };
  let under44 = 0;
  let controls = 0;
  let cut = 0;
  let sideways = 0;
  let sheet = { pct: 0, where: "" };
  const describe = (e) => [e.tag, e.id ?? e.label ?? e.text ?? e.cls ?? ""].filter(Boolean).join(" ").slice(0, 34);
  for (const { name, data } of screens) {
    const { height: H } = data.page;
    const visible = data.elements.filter((e) => e.inView && !e.covered);
    if (data.page.sidewaysScroll) sideways++;
    const sh = data.elements.find((e) => e.inView && (e.cls ?? "").split(" ")[0] === "sheet");
    if (sh) {
      const pct = Math.round((Math.max(0, Math.min(sh.y + sh.h, H) - Math.max(sh.y, 0)) / H) * 100);
      if (pct > sheet.pct) sheet = { pct, where: name };
    }
    for (const e of visible) {
      const isText = e.fs && !(e.cls ?? "").split(" ").includes("cap-sample") && ((e.kinds.includes("text") && (e.text ?? "").trim().length > 0) || e.tag === "input" || e.tag === "textarea");
      if (isText) {
        const isBar = e.fs === 12 && e.y + e.h > H - 64;
        if (e.fs < text.px) text = { px: e.fs, what: `${describe(e)} "${(e.text ?? "").slice(0, 16)}"`, where: name };
        if (!isBar && e.fs < textNoBar.px) textNoBar = { px: e.fs, what: `${describe(e)} "${(e.text ?? "").slice(0, 16)}"`, where: name };
        if (e.fs < 14) {
          under14++;
          if (!isBar) under14NoBar++;
        }
      }
      if (e.kinds.includes("control")) {
        controls++;
        const [w, h] = e.hit ?? [e.w, e.h];
        const size = Math.min(Math.max(w, e.w), Math.max(h, e.h));
        if (size < target.px) target = { px: Math.round(size * 10) / 10, what: describe(e), where: name };
        if (size < 44) under44++;
      }
      if ((e.clipped || e.clippedTall) && e.w > 2 && e.h > 2) cut++;
    }
  }
  return { screens: screens.length, text, textNoBar, under14, under14NoBar, target, under44, controls, cut, sideways, sheet };
}

const line = (label, n) =>
  `${label} (${n.screens} screens): smallest text ${n.text.px} px [${n.text.where}: ${n.text.what}]; without the bar's four words ${n.textNoBar.px} px [${n.textNoBar.where}: ${n.textNoBar.what}]; text boxes under 14 px ${n.under14} (${n.under14NoBar} not on the bar); ` +
  `smallest target ${n.target.px} px [${n.target.where}: ${n.target.what}]; targets under 44 px ${n.under44} of ${n.controls}; tallest sheet ${n.sheet.pct}% [${n.sheet.where}]; cut off ${n.cut}; sideways on ${n.sideways}`;
console.log(`\n### ${beforeFolder}  ->  ${afterFolder}  ${all ? "(all screens of each)" : `(${common.size} screens in common)`}`);
console.log(line("before", numbers(pick(before))));
console.log(line("after ", numbers(pick(after))));
