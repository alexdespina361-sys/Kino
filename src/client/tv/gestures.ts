import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/**
 * What a hand does to the picture of a playing video: a tap, two taps in a row on one side of it, or a finger held down on it.
 * They are told apart from the pointer's own events, so that a tap is only acted on once it is known not to be the first of two.
 */

/** A second tap that comes this soon after the first makes the two a double tap. */
export const DOUBLE_TAP_MS = 260;
/** After a double tap, one more tap on the same side this soon skips again (as on YouTube), without having to be a double itself. */
export const CHAIN_MS = 800;
/** A finger that rests on the picture this long without moving is a hold. */
export const HOLD_MS = 450;
/** A pointer that moves further than this many pixels between pressing and lifting was dragging, not tapping. */
export const MOVE_PX = 14;
/** The share of the picture's width, at each side, that skips; the middle is left to the double tap that goes full screen. */
export const SIDE_SHARE = 0.4;
/** How fast a hold plays. */
export const HOLD_SPEED = 2;

export type Side = "back" | "forward" | "middle";
/** A finger (or a pen), or a mouse (a remote that points is one). */
export type PointerKind = "touch" | "mouse";
/**
 * Where a press landed: on the picture itself, or on the bars laid over it (the title, and the progress and buttons) away from anything
 * that is pressed there. A finger on either is a finger on the picture, since on a phone the bars take much of it and a tap there
 * must still put them away; a mouse is not (a click a button's width beside it would pause the film), and a hold only means something on the picture.
 */
export type Zone = "picture" | "bar";

/** Which part of the picture a tap at `x` (of a picture `width` wide) is in. */
export function sideOf(x: number, width: number): Side {
  if (!(width > 0)) return "middle";
  const share = x / width;
  return share < SIDE_SHARE ? "back" : share > 1 - SIDE_SHARE ? "forward" : "middle";
}

export const kindOf = (pointerType: string): PointerKind => (pointerType === "mouse" ? "mouse" : "touch");

export interface PictureActions {
  /**
   * One tap or click. `wasVisible` is whether the controls were up when the pointer came down: a tap is acted on after a short wait
   * (to see whether a second follows), and the controls may have faded in that time, which is no reason to bring them back.
   */
  tap(kind: PointerKind, wasVisible: boolean): void;
  /** Two taps in a row on one side (skip that way), or in the middle (full screen); and each further tap in a run of skips. */
  doubleTap(side: Side): void;
  /** A finger has been held on the picture. Says whether that took: it only means something while the picture plays. */
  hold(): boolean;
  /** The held finger let go, or the hold was cut short. */
  release(): void;
}

export interface PressStart {
  id: number;
  x: number;
  y: number;
  /** How wide the picture is. */
  width: number;
  kind: PointerKind;
  wasVisible: boolean;
  /** Where it landed; on the picture when not said. */
  zone?: Zone;
}

interface Press extends PressStart {
  moved: boolean;
  held: boolean;
  holdTimer: ReturnType<typeof setTimeout> | undefined;
}

interface Pending {
  side: Side;
  wasVisible: boolean;
  /** Undefined while a second press is down, which decides what the first one was. */
  timer: ReturnType<typeof setTimeout> | undefined;
}

/** Follows the pointers on the picture and says what they did, through `actions`. Knows nothing of the page, so it can be tried on its own. */
export class PictureGestures {
  private press: Press | undefined;
  private pending: Pending | undefined;
  private chain: { side: Side; until: number } | undefined;
  /** The pointers that are down: a second finger turns a tap into something else (a pinch), which is none of ours. */
  private readonly down = new Set<number>();
  private spoiled = false;

  constructor(private readonly actions: PictureActions) {}

  start(start: PressStart): void {
    this.down.add(start.id);
    if (this.down.size > 1) return this.spoil();
    this.spoiled = false;
    if (start.kind === "mouse") this.flush(); // (a click is acted on at once: whatever a finger left waiting is over)
    else if (this.pending?.timer) {
      // A second press has begun: the first tap waits for it, and is not acted on while it is down.
      clearTimeout(this.pending.timer);
      this.pending.timer = undefined;
    }
    const press: Press = { ...start, moved: false, held: false, holdTimer: undefined };
    // A mouse does not hold: a click that is slow is still a click, and a button held down on the picture is not asking for anything.
    // Nor does a finger on the bars: resting it by a button on the way to it is no wish to play faster.
    if (start.kind === "touch" && start.zone !== "bar") press.holdTimer = setTimeout(() => this.holdNow(press), HOLD_MS);
    this.press = press;
  }

  move(id: number, x: number, y: number): void {
    const press = this.press;
    if (!press || press.id !== id || press.moved) return;
    if (Math.hypot(x - press.x, y - press.y) <= MOVE_PX) return;
    press.moved = true;
    if (press.held) return; // a hold goes on while the finger drifts
    // Dragging: not a hold, and not a tap at the end. (A tap that was waiting for this press to be its second stands by itself.)
    this.endPress();
    this.flush();
  }

  /** The pointer was lifted. */
  end(id: number): void {
    this.down.delete(id);
    if (this.spoiled) {
      if (this.down.size === 0) this.spoiled = false;
      return;
    }
    const press = this.press;
    if (!press || press.id !== id) return;
    this.press = undefined;
    if (press.holdTimer) clearTimeout(press.holdTimer);
    if (press.held) return void this.actions.release();
    this.tapped(press);
  }

  /** The pointer was taken away (the browser started something else with it). */
  cancel(id: number): void {
    this.down.delete(id);
    if (this.down.size === 0) this.spoiled = false;
    if (this.press?.id !== id) return;
    this.endPress();
    this.flush();
  }

  /** Forget everything under way (a menu opened, the picture went away). */
  reset(): void {
    this.down.clear();
    this.spoiled = false;
    this.endPress();
    this.dropPending();
    this.chain = undefined;
  }

  private holdNow(press: Press): void {
    press.holdTimer = undefined;
    if (this.press !== press || press.moved) return;
    this.dropPending(); // a tap, then a hold: the tap does not count
    this.chain = undefined; // (nor does a run of skips go on past it)
    press.held = this.actions.hold();
  }

  /** A press that will not be a tap (it dragged, was cancelled, or a second finger came): a hold in progress ends, the rest is dropped, and a run of skips is over. */
  private endPress(): void {
    const press = this.press;
    this.press = undefined;
    if (!press) return;
    this.chain = undefined;
    if (press.holdTimer) clearTimeout(press.holdTimer);
    if (press.held) this.actions.release();
  }

  private spoil(): void {
    this.spoiled = true;
    this.endPress();
    this.dropPending();
  }

  private dropPending(): void {
    if (this.pending?.timer) clearTimeout(this.pending.timer);
    this.pending = undefined;
  }

  /** The first tap of a pair turned out to be a tap by itself: act on it now. */
  private flush(): void {
    const pending = this.pending;
    if (!pending) return;
    this.dropPending();
    this.actions.tap("touch", pending.wasVisible);
  }

  private tapped(press: Press): void {
    if (press.kind === "mouse") {
      this.chain = undefined; // (a click is not one more tap of a finger's run)
      this.actions.tap("mouse", press.wasVisible);
      return;
    }
    const now = Date.now();
    const side = sideOf(press.x, press.width);
    if (this.chain && now < this.chain.until && this.chain.side === side) {
      this.chain.until = now + CHAIN_MS;
      this.dropPending();
      this.actions.doubleTap(side);
      return;
    }
    this.chain = undefined;
    const first = this.pending;
    if (first && first.side === side) {
      this.dropPending();
      if (side !== "middle") this.chain = { side, until: now + CHAIN_MS };
      this.actions.doubleTap(side);
      return;
    }
    if (first) this.flush(); // a tap on the other side: the first one stands by itself
    const pending: Pending = { side, wasVisible: press.wasVisible, timer: undefined };
    pending.timer = setTimeout(() => {
      this.pending = undefined;
      this.actions.tap("touch", pending.wasVisible);
    }, DOUBLE_TAP_MS);
    this.pending = pending;
  }
}

/** What is pressed, and does something of its own: a press on it is not on the picture. */
const CONTROLS = 'button, a, input, select, textarea, [role="slider"], [role="button"]';

/**
 * Where an event landed, as far as the picture goes: on the video or the empty part of what is laid over it (`data-picture`), or on
 * the text and the empty space of the bars (`data-picture="bar"`), and not on a control, nor on a card or menu of the page's own.
 */
export function zoneOf(target: EventTarget | null): Zone | null {
  if (!(target instanceof HTMLElement) || target.closest(CONTROLS)) return null;
  const zone = target.closest<HTMLElement>("[data-picture]");
  return zone ? (zone.dataset.picture === "bar" ? "bar" : "picture") : null;
}

/** Whether an event landed on the picture or its bars, and not on a control or a card. */
export const isPicture = (target: EventTarget | null): boolean => zoneOf(target) !== null;

interface PictureOptions {
  actions: PictureActions;
  /** Whether the picture takes taps now: a video is on, and no card or menu of the page's own is over it. */
  enabled: boolean;
  /** Which video is on: a hand that is busy with one is not busy with the next that takes its place. */
  source: string;
  /** Whether the controls are up at this moment. */
  controlsUp: () => boolean;
}

/**
 * Taps, double taps and holds on the picture. `onPointerDown` goes on the element that holds the picture and everything over it; the
 * rest is listened to on the window, so a press that ends elsewhere still ends. `kindRef` is what the last press was, for the
 * browser's own double click (which a mouse still means full screen by), and `echoOfTouch` tells a mouse move that is only the
 * browser's imitation of a finger from a real one.
 */
export function usePictureGestures({ actions, enabled, source, controlsUp }: PictureOptions) {
  const latest = useRef({ actions, enabled, controlsUp });
  latest.current = { actions, enabled, controlsUp };
  const [gestures] = useState(
    () =>
      new PictureGestures({
        tap: (kind, wasVisible) => latest.current.actions.tap(kind, wasVisible),
        doubleTap: (side) => latest.current.actions.doubleTap(side),
        hold: () => latest.current.actions.hold(),
        release: () => latest.current.actions.release(),
      }),
  );
  const kindRef = useRef<PointerKind>("mouse");
  const touchedAtRef = useRef(0);

  // What is under way belongs to the picture it began on: it is forgotten when that stops taking taps, or another video takes its place.
  useEffect(() => {
    gestures.reset();
  }, [enabled, source, gestures]);

  useEffect(() => {
    const move = (event: PointerEvent) => gestures.move(event.pointerId, event.clientX, event.clientY);
    const end = (event: PointerEvent) => gestures.end(event.pointerId);
    const cancel = (event: PointerEvent) => gestures.cancel(event.pointerId);
    const lose = () => gestures.reset();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", lose);
    document.addEventListener("visibilitychange", lose);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", lose);
      document.removeEventListener("visibilitychange", lose);
      gestures.reset();
    };
  }, [gestures]);

  return {
    kindRef,
    echoOfTouch: () => Date.now() - touchedAtRef.current < 800,
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      const kind = kindOf(event.pointerType);
      kindRef.current = kind;
      if (kind === "touch") touchedAtRef.current = Date.now();
      const { enabled: on, controlsUp: up } = latest.current;
      const zone = zoneOf(event.target);
      if (!on || !zone || (kind === "mouse" && (event.button !== 0 || zone === "bar"))) return gestures.reset();
      if (kind === "touch") event.preventDefault(); // the browser's mouse events that follow a touch are not wanted: the touch was handled here
      gestures.start({ id: event.pointerId, x: event.clientX, y: event.clientY, width: event.currentTarget.clientWidth, kind, wasVisible: up(), zone });
    },
  };
}

/**
 * Whether the last thing that touched the page was a finger, and not a mouse or a key: a finger has no hover and no keys, so the
 * controls that only it needs (the big pause button while the picture plays) are put up for it. A remote's keys, or a mouse, take them
 * away, except a mouse that presses one of those controls (marked `data-for-touch`): it is not pulled from under the click.
 */
export function useTouchUi(): boolean {
  const [touch, setTouch] = useState(() => matchMedia("(pointer: coarse)").matches && navigator.maxTouchPoints > 0);
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.target instanceof Element && event.target.closest("[data-for-touch]")) return;
      setTouch(event.pointerType !== "mouse");
    };
    const onKey = () => setTouch(false);
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);
  return touch;
}
