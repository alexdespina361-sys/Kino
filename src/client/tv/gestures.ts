import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export const DOUBLE_TAP_MS = 260;
export const CHAIN_MS = 800;
export const HOLD_MS = 450;
export const MOVE_PX = 14;
export const SIDE_SHARE = 0.4;
export const HOLD_SPEED = 2;

export type Side = "back" | "forward" | "middle";
export type PointerKind = "touch" | "mouse";
export type Zone = "picture" | "bar";

export function sideOf(x: number, width: number): Side {
  if (!(width > 0)) return "middle";
  const share = x / width;
  return share < SIDE_SHARE ? "back" : share > 1 - SIDE_SHARE ? "forward" : "middle";
}

export const kindOf = (pointerType: string): PointerKind => (pointerType === "mouse" ? "mouse" : "touch");

export interface PictureActions {
  tap(kind: PointerKind, wasVisible: boolean): void;
  doubleTap(side: Side): void;
  hold(): boolean;
  release(): void;
}

export interface PressStart {
  id: number;
  x: number;
  y: number;
  width: number;
  kind: PointerKind;
  wasVisible: boolean;
  zone?: Zone;
}

interface Press extends PressStart {
  moved: boolean;
  held: boolean;
  holdTimer: ReturnType<typeof setTimeout> | undefined;
}

interface Pending {
  kind: PointerKind;
  side: Side;
  wasVisible: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export class PictureGestures {
  private press: Press | undefined;
  private pending: Pending | undefined;
  private chain: { kind: PointerKind; side: Side; until: number } | undefined;
  private readonly down = new Set<number>();
  private spoiled = false;

  constructor(private readonly actions: PictureActions) {}

  start(start: PressStart): void {
    this.down.add(start.id);
    if (this.down.size > 1) return this.spoil();
    this.spoiled = false;
    const waiting = this.pending;
    if (waiting && waiting.kind !== start.kind) this.flush();
    else if (waiting?.timer) {
      clearTimeout(waiting.timer);
      waiting.timer = undefined;
    }
    const press: Press = { ...start, moved: false, held: false, holdTimer: undefined };
    if (start.zone !== "bar") press.holdTimer = setTimeout(() => this.holdNow(press), HOLD_MS);
    this.press = press;
  }

  move(id: number, x: number, y: number): void {
    const press = this.press;
    if (!press || press.id !== id || press.moved) return;
    if (Math.hypot(x - press.x, y - press.y) <= MOVE_PX) return;
    press.moved = true;
    if (press.held) return;
    this.endPress();
    this.flush();
  }

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

  cancel(id: number): void {
    this.down.delete(id);
    if (this.down.size === 0) this.spoiled = false;
    if (this.press?.id !== id) return;
    this.endPress();
    this.flush();
  }

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
    this.dropPending();
    this.chain = undefined;
    press.held = this.actions.hold();
  }

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

  private flush(): void {
    const pending = this.pending;
    if (!pending) return;
    this.dropPending();
    this.actions.tap(pending.kind, pending.wasVisible);
  }

  private tapped(press: Press): void {
    const now = Date.now();
    const side = sideOf(press.x, press.width);
    if (this.chain && this.chain.kind !== press.kind) this.chain = undefined;
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
      if (side !== "middle") this.chain = { kind: press.kind, side, until: now + CHAIN_MS };
      this.actions.doubleTap(side);
      return;
    }
    if (first) this.flush();
    const pending: Pending = { kind: press.kind, side, wasVisible: press.wasVisible, timer: undefined };
    pending.timer = setTimeout(() => {
      this.pending = undefined;
      this.actions.tap(pending.kind, pending.wasVisible);
    }, DOUBLE_TAP_MS);
    this.pending = pending;
  }
}

const CONTROLS = 'button, a, input, select, textarea, [role="slider"], [role="button"]';

export function zoneOf(target: EventTarget | null): Zone | null {
  if (!(target instanceof HTMLElement) || target.closest(CONTROLS)) return null;
  const zone = target.closest<HTMLElement>("[data-picture]");
  return zone ? (zone.dataset.picture === "bar" ? "bar" : "picture") : null;
}

export const isPicture = (target: EventTarget | null): boolean => zoneOf(target) !== null;

interface PictureOptions {
  actions: PictureActions;
  enabled: boolean;
  source: string;
  controlsUp: () => boolean;
}

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
      if (kind === "touch") event.preventDefault();
      gestures.start({ id: event.pointerId, x: event.clientX, y: event.clientY, width: event.currentTarget.clientWidth, kind, wasVisible: up(), zone });
    },
  };
}

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
