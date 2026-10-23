// Reads the scans a phone walk leaves (SCAN=1, see lib.mjs and scan.mjs) and prints, per screen and per device, the numbers the phone work is judged by:
//   the smallest text, the smallest thing a finger must hit, how much of the screen a sheet covers, whether the page scrolls sideways, text that is cut off, controls with no name.
//
//   node scripts/ui-walk/phone-numbers.mjs <scan root> <device folder> [<device folder> ...] [--from=<state>] [--detail]
//   e.g.  node scripts/ui-walk/phone-numbers.mjs .ui-polish/scan/before phone-390 phone-360x800
//
// What counts as "on screen": everything in view; when a sheet is open, only what is inside the sheet (what is behind its scrim cannot be touched).
// A control's size is the larger of its drawing and the reach of its ::before / ::after hit area (the scan records that as `hit`).
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const detail = process.argv.includes("--detail");
const [root, ...devices] = args;
if (!root || devices.length === 0) {
  console.error("usage: node scripts/ui-walk/phone-numbers.mjs <scan root> <device folder> [...] [--detail]");
  process.exit(2);
}

const round = (n) => Math.round(n * 10) / 10;
/** The test ids of what a finger picks a title with (the remote's tiles, cards and results). */
const TITLE_IDS = new Set(["library-tile", "continue-play", "list-play", "rating-play", "library-result", "title-episode"]);

/** The numbers of one scan file. */
function measure(file) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  const { width: W, height: H } = data.page;
  // what is in view and not under something else (the scan asks the browser what is on top: scan.mjs `covered`)
  const inView = data.elements.filter((e) => e.inView);
  const visible = inView.filter((e) => !e.covered);
  // a sheet: the box with the class "sheet" (not its backdrop or grip); a modal sheet's share of the screen is what it covers
  const sheet = inView.find((e) => (e.cls ?? "").split(" ")[0] === "sheet");
  const covered = sheet ? Math.max(0, Math.min(sheet.y + sheet.h, H) - Math.max(sheet.y, 0)) / H : 0;
  // (a field's own type counts as text: what is typed and its hint. The sample line of the subtitle style is a picture of what the TV shows, scaled to
  // the little screen it sits on: its size is the subtitle's, not the page's, so it is left out.)
  const texts = visible.filter(
    (e) => e.fs && !(e.cls ?? "").split(" ").includes("cap-sample") && ((e.kinds.includes("text") && (e.text ?? "").trim().length > 0) || e.tag === "input" || e.tag === "textarea"),
  );
  const smallest = texts.reduce((best, e) => (best === null || e.fs < best.fs ? e : best), null);
  const controls = visible.filter((e) => e.kinds.includes("control"));
  const sizeOf = (e) => {
    const [w, h] = e.hit ?? [e.w, e.h];
    return Math.min(Math.max(w, e.w), Math.max(h, e.h));
  };
  const hit = controls.map((e) => ({ e, size: sizeOf(e) }));
  const smallestControl = hit.reduce((best, c) => (best === null || c.size < best.size ? c : best), null);
  const describe = (e) => [e.tag, e.id ?? e.label ?? e.text ?? e.cls ?? ""].filter(Boolean).join(" ").slice(0, 38);
  // a title you could pick: a tile, a card, a search result, an episode (the TV page's tiles have the class tv-tile)
  const isTitle = (e) => TITLE_IDS.has(e.id) || (e.cls ?? "").split(" ").includes("tv-tile");
  const titles = visible.filter((e) => isTitle(e) && e.w > 40 && e.h > 40);
  const shown = titles.filter((e) => Math.min(e.y + e.h, H) - Math.max(e.y, 0) >= e.h * 0.5 && Math.min(e.x + e.w, W) - Math.max(e.x, 0) >= e.w * 0.5);
  const firstTitle = titles.reduce((best, e) => (best === null || e.y < best ? e.y : best), null);
  return {
    name: file.split(/[\\/]/).pop().replace(/\.json$/, ""),
    text: smallest ? { px: smallest.fs, what: `${describe(smallest)} "${(smallest.text ?? "").slice(0, 18)}"` } : null,
    textUnder14: texts.filter((e) => e.fs < 14).length,
    textUnder12: texts.filter((e) => e.fs < 12).length,
    target: smallestControl ? { px: round(smallestControl.size), what: describe(smallestControl.e) } : null,
    targetsUnder44: hit.filter((c) => c.size < 44).length,
    targetsUnder24: hit.filter((c) => c.size < 24).length,
    controls: controls.length,
    sheetCover: sheet ? Math.round(covered * 100) : null,
    sideways: data.page.sidewaysScroll ? `${data.page.scrollWidth - W}px` : "",
    cutOff: visible.filter((e) => e.clipped || e.clippedTall).length,
    // (a field is named by the label around it, which the scan does not look at: the fields are checked with axe instead)
    unnamed: controls.filter((e) => e.named === false && !["input", "textarea", "select"].includes(e.tag)).length,
    titlesShown: shown.length,
    firstTitleAt: firstTitle === null ? null : Math.round(Math.max(firstTitle, 0)),
    length: Math.round((data.page.scrollHeight / H) * 10) / 10,
    h: H,
    w: W,
  };
}

for (const device of devices) {
  const folder = join(root, device);
  if (!existsSync(folder)) {
    console.log(`\n### ${device}\n(no scans in ${folder})`);
    continue;
  }
  const rows = readdirSync(folder)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => measure(join(folder, f)));
  if (rows.length === 0) continue;
  const worst = (pick, dir) => rows.filter((r) => pick(r) !== null && pick(r) !== undefined).reduce((best, r) => (best === null || (dir === "min" ? pick(r) < pick(best) : pick(r) > pick(best)) ? r : best), null);
  const minText = worst((r) => r.text?.px ?? null, "min");
  const minTarget = worst((r) => r.target?.px ?? null, "min");
  const maxSheet = worst((r) => r.sheetCover, "max");
  console.log(`\n### ${device} (${rows[0].w}x${rows[0].h}, ${rows.length} screens)`);
  console.log(
    `smallest text **${minText?.text?.px ?? "-"} px** (${minText?.name}: ${minText?.text?.what}); smallest target **${minTarget?.target?.px ?? "-"} px** (${minTarget?.name}: ${minTarget?.target?.what}); ` +
      `tallest sheet **${maxSheet?.sheetCover ?? "-"}%** (${maxSheet?.name}); sideways scroll on **${rows.filter((r) => r.sideways).length}** screens; ` +
      `targets under 44 px: ${rows.reduce((n, r) => n + r.targetsUnder44, 0)}, under 24 px: ${rows.reduce((n, r) => n + r.targetsUnder24, 0)}; text under 14 px: ${rows.reduce((n, r) => n + r.textUnder14, 0)}, under 12 px: ${rows.reduce((n, r) => n + r.textUnder12, 0)}; ` +
      `cut-off text boxes: ${rows.reduce((n, r) => n + r.cutOff, 0)}; unnamed controls: ${rows.reduce((n, r) => n + r.unnamed, 0)}`,
  );
  if (detail) {
    console.log("\n| screen | smallest text | smallest target | <44 | sheet | titles in view | first title at | page length | sideways | cut | unnamed |\n|---|---|---|---|---|---|---|---|---|---|---|");
    for (const r of rows) {
      console.log(
        `| ${r.name} | ${r.text ? `${r.text.px} (${r.text.what})` : "-"} | ${r.target ? `${r.target.px} (${r.target.what})` : "-"} | ${r.targetsUnder44}/${r.controls} | ${r.sheetCover === null ? "" : r.sheetCover + "%"} | ${r.titlesShown || ""} | ${r.firstTitleAt === null ? "" : `${r.firstTitleAt} px (${Math.round((r.firstTitleAt / r.h) * 100)}%)`} | ${r.length}x | ${r.sideways} | ${r.cutOff || ""} | ${r.unnamed || ""} |`,
      );
    }
  }
}
