import { useRef, type MouseEvent, type PointerEvent } from "react";

const HOLD_MS = 480;
const DRIFT_PX = 10;

export function useHold(onHold: () => void) {
  const state = useRef<{ timer?: number; x: number; y: number; held: boolean }>({ x: 0, y: 0, held: false });

  const stop = () => window.clearTimeout(state.current.timer);

  return {
    props: {
      onPointerDown: (event: PointerEvent) => {
        if (event.button !== 0) return;
        stop();
        state.current = {
          x: event.clientX,
          y: event.clientY,
          held: false,
          timer: window.setTimeout(() => {
            state.current.held = true;
            try {
              navigator.vibrate?.(12);
            } catch {
            }
            onHold();
          }, HOLD_MS),
        };
      },
      onPointerMove: (event: PointerEvent) => {
        if (Math.hypot(event.clientX - state.current.x, event.clientY - state.current.y) > DRIFT_PX) stop();
      },
      onPointerUp: () => {
        stop();
        if (state.current.held) window.setTimeout(() => (state.current.held = false), 350);
      },
      onPointerCancel: stop,
      onPointerLeave: stop,
      onContextMenu: (event: MouseEvent) => event.preventDefault(),
    },
    tap:
      (action: () => void) =>
      (): void => {
        if (state.current.held) state.current.held = false;
        else action();
      },
  };
}
