import { useEffect, useState } from "react";
import { handHeld } from "../shared/backButton";

export const COMPACT_MAX_WIDTH = 599;
export const COMPACT_MIN_HEIGHT = 480;
export const UPRIGHT_MAX_WIDTH = 479;
const COMPACT = `(max-width: ${COMPACT_MAX_WIDTH}px) and (min-height: ${COMPACT_MIN_HEIGHT}px), (max-width: ${UPRIGHT_MAX_WIDTH}px)`;

export const isCompact = (): boolean => typeof matchMedia === "function" && matchMedia(COMPACT).matches;

export const FLAT_MAX_HEIGHT = 520;
const FLAT = `(max-height: ${FLAT_MAX_HEIGHT}px) and (orientation: landscape) and (min-width: ${UPRIGHT_MAX_WIDTH + 1}px)`;

export const isFlatHand = (): boolean => typeof matchMedia === "function" && matchMedia(FLAT).matches && handHeld();

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

export const useCompact = (): boolean => useScreen(isCompact);

export const useFlatHand = (): boolean => useScreen(isFlatHand);
