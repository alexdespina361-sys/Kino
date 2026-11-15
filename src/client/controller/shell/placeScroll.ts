/** Where a place of the phone's bar was left: how far the window was scrolled, and where the place's top lay in the page at that moment. */
export interface Left {
  y: number;
  top: number;
}

/**
 * Where to put the window back for a place that was left at `left`, now that the place's top lies at `top`: as far into the place as its reader was.
 *
 * What comes and goes above the place is not the reader's doing. The line "Looking it up…" comes in above it the moment a title is played, and the browser
 * moves the window down with it to keep what was in view in view; when the film is stopped the line is gone, and the window put back where it had been
 * moved to was that line's height too far down. A place left at the very top is put back at the top, whatever came above it.
 */
export function backTo(left: Left, top: number): number {
  if (left.y <= 0) return 0;
  return Math.max(0, left.y + top - left.top);
}
