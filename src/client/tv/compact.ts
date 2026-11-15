import { useEffect, useState } from "react";
import { handHeld } from "../shared/backButton";

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

/**
 * A phone on its side (or a tablet as flat): a screen in the hand too low for the TV's ten lines down the left, which there came out a finger's width
 * apart, under half of what a thumb needs. It has the upright phone's four places (Home, Search, the categories, the lists), down the left, a thumb high
 * each; the sections are buttons over the titles and the party and the phone are on the profile's page, as on the upright phone. A TV, a computer or a
 * window as low keeps its menu: only a device held in the hand (see `handHeld`) is one of these. polish/tv.css answers it as the menu's `data-flat`.
 */
export const FLAT_MAX_HEIGHT = 520;
const FLAT = `(max-height: ${FLAT_MAX_HEIGHT}px) and (orientation: landscape)`;

export const isFlatHand = (): boolean => typeof matchMedia === "function" && matchMedia(FLAT).matches && handHeld();

/** Whether `test` holds now, and again when the window is turned or resized (listened to as `resize`, which every browser a TV or a phone has has). */
function useScreen(test: () => boolean): boolean {
  const [holds, setHolds] = useState(test);
  useEffect(() => {
    const update = () => setHolds(test());
    update();
    addEventListener("resize", update);
    return () => removeEventListener("resize", update);
  }, [test]);
  return holds;
}

/** Whether the page is the compact one now, and again when the window is turned or resized. */
export const useCompact = (): boolean => useScreen(isCompact);

/** Whether the page is on a phone on its side now (see `isFlatHand`), and again when it is turned. */
export const useFlatHand = (): boolean => useScreen(isFlatHand);
