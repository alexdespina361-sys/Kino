import { useRef, type MouseEvent, type PointerEvent } from "react";

/** How long a finger stays down, without moving, for it to be a hold and not a tap. */
const HOLD_MS = 480;
/** How far it may drift (a finger is never quite still) before it is a scroll instead. */
const DRIFT_PX = 10;

/**
 * Holding a title does something besides what a tap does (it goes in a list). `props` goes on the button that a tap is for, and
 * `tap` wraps what a tap does: the let-go that ends a hold is not a tap. A finger that moves is a scroll, and no hold.
 */
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
              navigator.vibrate?.(12); // a tick under the thumb, where the browser has a motor for it
            } catch {
              /* no vibration here */
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
        // The click that ends a hold comes at once; one that never comes must not swallow the next tap.
        if (state.current.held) window.setTimeout(() => (state.current.held = false), 350);
      },
      onPointerCancel: stop,
      onPointerLeave: stop,
      // A hold on a picture is also where a phone offers to save or open it: not here.
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
