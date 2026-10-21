/**
 * What the cat does to the page it stands on: a poster gives a little under its feet, the one it points at glows, and a poster far along its row
 * is brought into view the way the library does for its own focus. Nothing here is permanent: a poster is moved by an animation that puts it back
 * (the individual `translate` property, so the library's own grow of a focused poster is not in its way), and the glow is one attribute that is
 * taken off again.
 */

const canTranslate = (): boolean => typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("translate", "0 0");

/** A poster gives a little under the cat's feet (its landing, a paw on it). `depth` is in pixels. */
export function dip(el: HTMLElement, depth: number, reduced: boolean): void {
  if (reduced || !canTranslate() || typeof el.animate !== "function") return;
  const d = Math.max(1, Math.min(8, depth));
  el.animate(
    [
      { translate: "0 0", easing: "ease-out" },
      { translate: `0 ${d}px`, offset: 0.26, easing: "ease-in-out" },
      { translate: `0 ${-d * 0.3}px`, offset: 0.6, easing: "ease-in-out" },
      { translate: "0 0" },
    ],
    { duration: 440 },
  );
}

/** The poster the cat points at glows (an attribute the cat's stylesheet draws), and no other. */
export function markPointed(el: HTMLElement | null): void {
  clearPointed();
  if (el) el.setAttribute("data-cat-pointed", "");
}

export function clearPointed(): void {
  for (const each of document.querySelectorAll("[data-cat-pointed]")) each.removeAttribute("data-cat-pointed");
}

/** Brings a poster into view as the library does when the remote moves onto it: its row sideways to it, and the page up or down to its row. */
export function bringIntoView(tile: HTMLElement): void {
  const scroller = tile.closest<HTMLElement>(".tv-row-tiles");
  if (scroller) {
    const edge = tile.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    const room = edge.width * 0.7;
    if (edge.left < box.left + room) scroller.scrollBy({ left: edge.left - box.left - room, behavior: "smooth" });
    else if (edge.right > box.right - room) scroller.scrollBy({ left: edge.right - box.right + room, behavior: "smooth" });
  }
  const rows = tile.closest<HTMLElement>(".tv-rows");
  const row = tile.closest<HTMLElement>(".tv-row");
  if (rows && row) rows.scrollTo({ top: row.offsetTop, behavior: "smooth" });
  else tile.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
}
