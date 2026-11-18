import { useEffect, useRef, type RefObject } from "react";

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
