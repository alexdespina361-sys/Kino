import { useEffect, useRef, type RefObject } from "react";

/**
 * A menu that shuts at a press anywhere beside it, and the press does what it does as well. (Its focus leaving shuts it too, but Safari on an iPhone does not
 * give a pressed button the focus: nothing left the menu, and it stayed open under a press beside it, the judge, 17 Nov.)
 */
export function useShutOnPressBeside(open: boolean, around: RefObject<HTMLElement | null>, shut: () => void): void {
  const latest = useRef(shut);
  latest.current = shut;
  useEffect(() => {
    if (!open) return;
    const press = (event: PointerEvent) => {
      if (event.target instanceof Node && around.current?.contains(event.target)) return;
      latest.current();
    };
    document.addEventListener("pointerdown", press, true);
    return () => document.removeEventListener("pointerdown", press, true);
  }, [open, around]);
}
