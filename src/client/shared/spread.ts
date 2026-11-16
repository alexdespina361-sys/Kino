import type { LibraryRow } from "../../shared";

/**
 * The library's first rows are lists by popularity (trending, popular, each genre), so a film of three genres is near the start of four of
 * them, and the same few films opened almost every row of a page (the owner, 15 Nov: "every row starts with the most popular titles").
 * Down a page, a row puts first the titles no row above it has, in their own order; then the ones shown once above, then twice, and so on.
 * One already in `DROP_AFTER` rows above is left out, as long as the row keeps `MIN_KEEP` titles. The first row is the page's ranking and
 * keeps its order. Only a row's own titles are looked at, not the further pages scrolled to sideways, so scrolling one row never moves
 * the titles of another.
 */
export const DROP_AFTER = 2;
export const MIN_KEEP = 12;

export function spreadRows(rows: readonly LibraryRow[], keepFirst = 1): LibraryRow[] {
  const shown = new Map<string, number>();
  return rows.map((row, at) => {
    let items = row.items;
    if (at >= keepFirst) {
      const ranked = items.map((item, index) => ({ item, index, times: shown.get(item.id) ?? 0 })).sort((a, b) => a.times - b.times || a.index - b.index);
      // (The ones shown most are last, so leaving out from the end leaves out those first.)
      const spare = Math.max(0, ranked.length - MIN_KEEP);
      const tired = ranked.filter((one) => one.times >= DROP_AFTER).length;
      const kept = ranked.slice(0, ranked.length - Math.min(spare, tired));
      items = kept.every((one, index) => one.index === index) && kept.length === items.length ? items : kept.map((one) => one.item);
    }
    for (const item of items) shown.set(item.id, (shown.get(item.id) ?? 0) + 1);
    return items === row.items ? row : { ...row, items };
  });
}

/** The spread of a list of rows, worked out once for each list (the library's first rows change only when the server lists them again). */
const spreadOnce = new WeakMap<readonly LibraryRow[], LibraryRow[]>();
export function spreadOf(rows: readonly LibraryRow[]): LibraryRow[] {
  let out = spreadOnce.get(rows);
  if (!out) {
    out = spreadRows(rows);
    spreadOnce.set(rows, out);
  }
  return out;
}
