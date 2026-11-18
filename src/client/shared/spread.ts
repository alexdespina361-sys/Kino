import type { LibraryRow } from "../../shared";

export const DROP_AFTER = 2;
export const MIN_KEEP = 12;

export function spreadRows(rows: readonly LibraryRow[], keepFirst = 1): LibraryRow[] {
  const shown = new Map<string, number>();
  return rows.map((row, at) => {
    let items = row.items;
    if (at >= keepFirst) {
      const ranked = items.map((item, index) => ({ item, index, times: shown.get(item.id) ?? 0 })).sort((a, b) => a.times - b.times || a.index - b.index);
      const spare = Math.max(0, ranked.length - MIN_KEEP);
      const tired = ranked.filter((one) => one.times >= DROP_AFTER).length;
      const kept = ranked.slice(0, ranked.length - Math.min(spare, tired));
      items = kept.every((one, index) => one.index === index) && kept.length === items.length ? items : kept.map((one) => one.item);
    }
    for (const item of items) shown.set(item.id, (shown.get(item.id) ?? 0) + 1);
    return items === row.items ? row : { ...row, items };
  });
}

const spreadOnce = new WeakMap<readonly LibraryRow[], LibraryRow[]>();
export function spreadOf(rows: readonly LibraryRow[]): LibraryRow[] {
  let out = spreadOnce.get(rows);
  if (!out) {
    out = spreadRows(rows);
    spreadOnce.set(rows, out);
  }
  return out;
}
