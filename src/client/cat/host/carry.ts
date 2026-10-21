import type { Rect, World } from "../types";

/**
 * Which parts of a page that was read are on its scroller, and so move when it is scrolled (the rows of posters, their cards, the names under them, the words of a row, the card that has
 * the focus), and which stay where they are on the screen (the top bar, the banner, the foot of the screen, the cat's own card).
 */
export interface Rides {
  /** For each zone of `world.keepOut`, in order. */
  keepOut: readonly boolean[];
  /** The card with the focus (`world.focus`). */
  focus: boolean;
}

/**
 * The page as it is now, `shift` pixels (down positive) after it was read: what is on the scroller has moved with the scroll, and the rest has not. Reading a page costs, and a screen that
 * is slow to do it reads it a few times a second, while the scroll goes on at every frame; where the scroller is now costs nothing to ask. A cat that is handed this takes the page as it
 * would have if it had been read at this very frame: it rides its shelf a frame at a time, and not in steps of every third or fifth. (A new world, the read one untouched; `readAt` is when
 * it was.)
 */
export function carried(world: World, shift: number, rides: Rides, readAt: number): World {
  const lift = (rect: Rect): Rect => ({ x: rect.x, y: rect.y + shift, w: rect.w, h: rect.h });
  const out: World = {
    ...world,
    surfaces: world.surfaces.map((surface) => (surface.kind === "shelfTop" ? { ...surface, y: surface.y + shift } : surface)),
    keepOut: world.keepOut.map((zone, i) => (rides.keepOut[i] ? lift(zone) : zone)),
    targets: world.targets.map((target) => ({ ...target, rect: lift(target.rect) })),
    readAt,
  };
  if (world.soft) out.soft = world.soft.map(lift);
  if (world.focus && rides.focus) out.focus = lift(world.focus);
  return out;
}
