import { useEffect, useState } from "react";

/**
 * A phone held upright, or a window that narrow (docs/phone-layout/PLAN.md, "the TV page on a phone"): the TV's page is laid out for a thumb, with a bar of four
 * places at the bottom, the sections as chips, and titles as posters. polish/tv-phone.css asks the very same question (and polish/shell.css its opposite, for the
 * phone's own shell), so every size can be tried and a narrow window on a computer gets the same page. A phone on its side, or a tablet, has the TV's own menu down
 * the left, which fits there. CSS cannot share a number, so the two are named here for the code (and the tests) to say once.
 */
export const COMPACT_MAX_WIDTH = 599;
export const COMPACT_MIN_HEIGHT = 480;
const COMPACT = `(max-width: ${COMPACT_MAX_WIDTH}px) and (min-height: ${COMPACT_MIN_HEIGHT}px)`;

export const isCompact = (): boolean => typeof matchMedia === "function" && matchMedia(COMPACT).matches;

/** Whether the page is the compact one now, and again when the window is turned or resized (listened to as `resize`, which every browser a TV or a phone has has). */
export function useCompact(): boolean {
  const [compact, setCompact] = useState(isCompact);
  useEffect(() => {
    const update = () => setCompact(isCompact());
    update();
    addEventListener("resize", update);
    return () => removeEventListener("resize", update);
  }, []);
  return compact;
}
