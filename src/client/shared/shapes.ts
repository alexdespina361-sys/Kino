import type { LibraryRow } from "../../shared";

export const LANDSCAPE_FIRST = 1;
export const LANDSCAPE_EVERY = 3;
const LOOKED_AT = 20;
const AT_LEAST = 6;
const WITH_STILLS = 0.9;

export function hasStills(row: LibraryRow): boolean {
  const first = row.items.slice(0, LOOKED_AT);
  return first.length >= AT_LEAST && first.filter((item) => item.backdrop).length >= first.length * WITH_STILLS;
}

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
