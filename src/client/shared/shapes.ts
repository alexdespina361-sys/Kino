import type { LibraryRow } from "../../shared";

/**
 * Which rows of the library are drawn as wide cards (a still of each film, 16 by 9) instead of posters: the owner, 15 Nov, "Mix the row shapes (posters, wide
 * cards, category rows) instead of one size everywhere, on the phone too". The second row of the library is the first of them (the first is the TV's top ten,
 * and the picture at the top of a phone's Home), then every third one after it, so that no two come one after the other. A row only gets the shape when its
 * titles have the stills for it: one that has too few takes its turn to the next row that has them (a poster cut to 16 by 9 is half a face).
 *
 * The TV and the phone ask the same question of the same rows, so a page has the same rhythm on both. A row keeps its shape as the page grows: it depends on the
 * rows above it (which do not change as rows come in under them) and on its own first titles (which do not change as more come at its end).
 */
export const LANDSCAPE_FIRST = 1;
export const LANDSCAPE_EVERY = 3;
/** How many of a row's first titles are looked at, how many there must be, and the share of them that must have a still. */
const LOOKED_AT = 20;
const AT_LEAST = 6;
const WITH_STILLS = 0.9;

/** Whether the titles a row opens with have the wide pictures a row of wide cards is made of. */
export function hasStills(row: LibraryRow): boolean {
  const first = row.items.slice(0, LOOKED_AT);
  return first.length >= AT_LEAST && first.filter((item) => item.backdrop).length >= first.length * WITH_STILLS;
}

/** The ids of the rows (the library's, in the order a page shows them) that are drawn as wide cards. */
export function landscapeRows(rows: readonly LibraryRow[]): Set<string> {
  const out = new Set<string>();
  let next = LANDSCAPE_FIRST;
  rows.forEach((row, index) => {
    if (index < next || !hasStills(row)) return;
    out.add(row.id);
    next = index + LANDSCAPE_EVERY;
  });
  return out;
}
