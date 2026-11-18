import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";

const FAR_PX = 110;
const START_PX = 12;
export const FLY_MS = 180;
export const BACK_MS = 2500;

interface SwipeProps {
  style?: CSSProperties | undefined;
  onPointerDown?: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove?: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp?: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel?: (event: PointerEvent<HTMLElement>) => void;
  onClickCapture?: (event: MouseEvent<HTMLElement>) => void;
}

export const stillScreen = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function useSwipeAway(onAway: (() => void) | undefined): SwipeProps {
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const swallowClick = useRef(false);
  const [dx, setDx] = useState(0);
  const [gone, setGone] = useState(0);
  const away = useRef(onAway);
  away.current = onAway;
  useEffect(() => {
    if (gone === 0) return;
    const timer = window.setTimeout(() => away.current?.(), FLY_MS);
    const back = window.setTimeout(() => setGone(0), FLY_MS + BACK_MS);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(back);
    };
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
        }
      }
      setDx(x);
    },
    onPointerUp: (event) => {
      const from = drag.current;
      drag.current = null;
      if (!from?.moved) return;
      swallowClick.current = true;
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
