import { useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";

/** How far a line is dragged before it counts as swiped away: a third of its width, and never more than this. */
const FAR_PX = 110;
/** A finger that moves less than this has not started a swipe (it may be a tap, or the start of a scroll). */
const START_PX = 12;

interface SwipeProps {
  style?: CSSProperties | undefined;
  onPointerDown?: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove?: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp?: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel?: (event: PointerEvent<HTMLElement>) => void;
  onClickCapture?: (event: MouseEvent<HTMLElement>) => void;
}

/**
 * A line of a list that a finger can swipe away, to either side: it follows the finger, and past a third of its width letting go clears it (`onAway`);
 * short of that it goes back. Up-and-down movement stays the list's scrolling (the line needs `touch-action: pan-y`), and a mouse is left alone: its
 * way to clear a line is the cross. Spread what this returns on the line. With no `onAway` the line does nothing.
 */
export function useSwipeAway(onAway: (() => void) | undefined): SwipeProps {
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const swallowClick = useRef(false);
  const [dx, setDx] = useState(0);
  if (!onAway) return {};
  return {
    style: dx === 0 ? undefined : { transform: `translateX(${dx}px)`, opacity: Math.max(0.25, 1 - Math.abs(dx) / 260), transition: "none" },
    onPointerDown: (event) => {
      if (event.pointerType === "mouse") return;
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    },
    onPointerMove: (event) => {
      const from = drag.current;
      if (!from || from.id !== event.pointerId) return;
      const x = event.clientX - from.x;
      const y = event.clientY - from.y;
      if (!from.moved) {
        if (Math.abs(x) < START_PX || Math.abs(x) < Math.abs(y) * 1.5) return;
        from.moved = true;
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // (no such pointer any more: the line still follows while the finger is over it)
        }
      }
      setDx(x);
    },
    onPointerUp: (event) => {
      const from = drag.current;
      drag.current = null;
      if (!from?.moved) return;
      swallowClick.current = true; // (the tap that ends a swipe is not a press of what is under the finger)
      window.setTimeout(() => (swallowClick.current = false), 0);
      const far = Math.abs(event.clientX - from.x) >= Math.min(FAR_PX, event.currentTarget.offsetWidth / 3);
      setDx(0);
      if (far) onAway();
    },
    onPointerCancel: () => {
      drag.current = null;
      setDx(0);
    },
    onClickCapture: (event) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}
