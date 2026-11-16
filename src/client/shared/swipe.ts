import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";

/** How far a line is dragged before it counts as swiped away: a third of its width, and never more than this. */
const FAR_PX = 110;
/** A finger that moves less than this has not started a swipe (it may be a tap, or the start of a scroll). */
const START_PX = 12;
/** How long a line that was swiped away takes to fly off its side before it is cleared. */
export const FLY_MS = 180;

interface SwipeProps {
  style?: CSSProperties | undefined;
  onPointerDown?: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove?: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp?: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel?: (event: PointerEvent<HTMLElement>) => void;
  onClickCapture?: (event: MouseEvent<HTMLElement>) => void;
}

/** Whether the screen asks for as little movement as can be (then a line is cleared at once, without flying off). */
export const stillScreen = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A line of a list that a finger can swipe away, to either side: it follows the finger, and past a third of its width letting go sends it off that side and
 * then clears it (`onAway`); short of that it goes back. Up-and-down movement stays the list's scrolling (the line needs `touch-action: pan-y`), and a mouse is
 * left alone: its way to clear a line is the cross. Spread what this returns on the line. With no `onAway` the line does nothing. Used by the phone's lists
 * (the bell, what friends sent) and by the bell of the TV's page on a touch screen (a phone that is the screen, a tablet).
 */
export function useSwipeAway(onAway: (() => void) | undefined): SwipeProps {
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const swallowClick = useRef(false);
  const [dx, setDx] = useState(0);
  /** The side it is flying off to, once let go far enough: -1 or 1. */
  const [gone, setGone] = useState(0);
  const away = useRef(onAway);
  away.current = onAway;
  useEffect(() => {
    if (gone === 0) return;
    const timer = window.setTimeout(() => {
      away.current?.();
      setGone(0); // (a line that is still there, cleared or not, comes back)
    }, FLY_MS);
    return () => window.clearTimeout(timer);
  }, [gone]);
  if (!onAway) return {};
  const style: CSSProperties | undefined =
    gone !== 0
      ? { transform: `translateX(${gone * 110}%)`, opacity: 0, transition: `transform ${FLY_MS}ms ease-in, opacity ${FLY_MS}ms ease-in` }
      : dx === 0
        ? undefined
        : { transform: `translateX(${dx}px)`, opacity: Math.max(0.25, 1 - Math.abs(dx) / 260), transition: "none" };
  return {
    style,
    onPointerDown: (event) => {
      if (event.pointerType === "mouse" || gone !== 0) return;
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
      const by = event.clientX - from.x;
      const far = Math.abs(by) >= Math.min(FAR_PX, event.currentTarget.offsetWidth / 3);
      setDx(0);
      if (!far) return;
      if (stillScreen()) return onAway();
      setGone(by < 0 ? -1 : 1);
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
