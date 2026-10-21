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

const canRotate = (): boolean => typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("rotate", "0deg");

/**
 * A poster is swatted: it gives under the paw, rocks the way the paw was going (`dir`: the way the cat faces) and settles, over about half a second. `depth` is in pixels.
 * Like `dip` it only moves the poster by animations that put it back (the individual `translate` and `rotate` properties, apart from the library's own transform).
 */
export function swatPoster(el: HTMLElement, depth: number, dir: 1 | -1, reduced: boolean): void {
  if (reduced || typeof el.animate !== "function") return;
  const d = Math.max(2, Math.min(12, depth));
  if (canTranslate()) {
    el.animate(
      [
        { translate: "0 0", easing: "ease-out" },
        { translate: `${dir * d * 0.35}px ${d}px`, offset: 0.2, easing: "ease-in-out" },
        { translate: `${-dir * d * 0.2}px ${-d * 0.35}px`, offset: 0.52, easing: "ease-in-out" },
        { translate: "0 0" },
      ],
      { duration: 560 },
    );
  }
  if (canRotate()) {
    el.animate(
      [
        { rotate: "0deg", easing: "ease-out" },
        { rotate: `${dir * 2.6}deg`, offset: 0.2, easing: "ease-in-out" },
        { rotate: `${-dir * 1.4}deg`, offset: 0.48, easing: "ease-in-out" },
        { rotate: `${dir * 0.6}deg`, offset: 0.74, easing: "ease-in-out" },
        { rotate: "0deg" },
      ],
      { duration: 640 },
    );
  }
}

/** The poster the cat points at glows (an attribute the cat's stylesheet draws), and no other. */
export function markPointed(el: HTMLElement | null): void {
  clearPointed();
  if (el) el.setAttribute("data-cat-pointed", "");
}

export function clearPointed(): void {
  for (const each of document.querySelectorAll("[data-cat-pointed]")) each.removeAttribute("data-cat-pointed");
}

/**
 * Brings a poster into view as the library does when the remote moves onto it: its row sideways to it, and the page up or down to its row. The row goes to the top of the rows, but
 * not so high that the line along the tops of its posters is above `lowestShelf` (a number of pixels from the top of the screen: what is fixed over the top of the rows, and room for a
 * cat to stand under it): a cat sent to the poster has to be able to stand in front of it. The poster is kept whole on the screen, whatever that asks.
 */
export function bringIntoView(tile: HTMLElement, lowestShelf = 0): void {
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
  if (rows && row) {
    // (where the line along the tops of its posters will be with the row at the top of the rows; the cat's room is made by stopping short of that, and no lower than keeps the poster whole)
    const edge = tile.getBoundingClientRect();
    const after = edge.top - (row.offsetTop - rows.scrollTop);
    const lowest = Math.min(lowestShelf, rows.getBoundingClientRect().bottom - edge.height);
    rows.scrollTo({ top: Math.max(0, row.offsetTop - Math.max(0, lowest - after)), behavior: "smooth" });
  } else tile.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
}
