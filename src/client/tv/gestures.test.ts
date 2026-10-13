import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHAIN_MS, DOUBLE_TAP_MS, HOLD_MS, MOVE_PX, PictureGestures, sideOf, type PictureActions, type PointerKind } from "./gestures";

const WIDTH = 1000;
const LEFT = 100;
const RIGHT = 900;
const MIDDLE = 500;

/** Records what the gestures asked the page to do, in order. */
function setup(holdTakes = true) {
  const calls: string[] = [];
  const actions: PictureActions = {
    tap: (kind, wasVisible) => void calls.push(`tap:${kind}:${wasVisible ? "up" : "away"}`),
    doubleTap: (side) => void calls.push(`double:${side}`),
    hold: () => {
      calls.push("hold");
      return holdTakes;
    },
    release: () => void calls.push("release"),
  };
  const gestures = new PictureGestures(actions);
  let id = 0;
  /** A finger (or a mouse) goes down and comes up again `after` ms later. */
  const tap = (x: number, { kind = "touch", after = 40, visible = false }: { kind?: PointerKind; after?: number; visible?: boolean } = {}) => {
    id += 1;
    gestures.start({ id, x, y: 300, width: WIDTH, kind, wasVisible: visible });
    vi.advanceTimersByTime(after);
    gestures.end(id);
  };
  const press = (x: number, kind: PointerKind = "touch") => {
    id += 1;
    gestures.start({ id, x, y: 300, width: WIDTH, kind, wasVisible: false });
    return id;
  };
  return { calls, gestures, tap, press };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("sideOf", () => {
  it("splits the picture into a side that goes back, one that goes forward, and the middle", () => {
    expect(sideOf(0, WIDTH)).toBe("back");
    expect(sideOf(399, WIDTH)).toBe("back");
    expect(sideOf(400, WIDTH)).toBe("middle");
    expect(sideOf(600, WIDTH)).toBe("middle");
    expect(sideOf(601, WIDTH)).toBe("forward");
    expect(sideOf(1000, WIDTH)).toBe("forward");
  });

  it("calls a picture with no width the middle", () => {
    expect(sideOf(10, 0)).toBe("middle");
    expect(sideOf(Number.NaN, 100)).toBe("middle");
  });
});

describe("a tap", () => {
  it("is acted on once it is known not to be the first of two", () => {
    const { calls, tap } = setup();
    tap(LEFT);
    vi.advanceTimersByTime(DOUBLE_TAP_MS - 1);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual(["tap:touch:away"]);
  });

  it("carries whether the controls were up when the finger came down", () => {
    const { calls, tap } = setup();
    tap(MIDDLE, { visible: true });
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(calls).toEqual(["tap:touch:up"]);
  });

  it("is one tap each when the second comes too late", () => {
    const { calls, tap } = setup();
    tap(LEFT);
    vi.advanceTimersByTime(DOUBLE_TAP_MS + 10);
    tap(LEFT);
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(calls).toEqual(["tap:touch:away", "tap:touch:away"]);
  });

  it("is a click at once for a mouse, with no wait and no double", () => {
    const { calls, tap } = setup();
    tap(LEFT, { kind: "mouse" });
    expect(calls).toEqual(["tap:mouse:away"]);
    tap(LEFT, { kind: "mouse" });
    expect(calls).toEqual(["tap:mouse:away", "tap:mouse:away"]);
  });

  it("does not hold for a mouse, however long the button is down", () => {
    const { calls, tap } = setup();
    tap(MIDDLE, { kind: "mouse", after: HOLD_MS * 4 });
    expect(calls).toEqual(["tap:mouse:away"]);
  });

  it("leaves nothing waiting behind a click that follows a tap", () => {
    const { calls, tap } = setup();
    tap(LEFT);
    tap(RIGHT, { kind: "mouse" });
    expect(calls).toEqual(["tap:touch:away", "tap:mouse:away"]);
    vi.advanceTimersByTime(DOUBLE_TAP_MS * 2);
    expect(calls).toHaveLength(2);
  });

  it("is not one when the pointer was dragged", () => {
    const { calls, gestures, press } = setup();
    const id = press(LEFT);
    gestures.move(id, LEFT + MOVE_PX + 1, 300);
    gestures.end(id);
    vi.advanceTimersByTime(DOUBLE_TAP_MS * 2);
    expect(calls).toEqual([]);
  });

  it("is one when the pointer only wobbled", () => {
    const { calls, gestures, press } = setup();
    const id = press(LEFT);
    gestures.move(id, LEFT + MOVE_PX - 1, 300);
    gestures.end(id);
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(calls).toEqual(["tap:touch:away"]);
  });
});

describe("two taps in a row", () => {
  it("on a side skip that way, and the first is not a tap of its own", () => {
    const { calls, tap } = setup();
    tap(LEFT);
    vi.advanceTimersByTime(DOUBLE_TAP_MS - 20);
    tap(LEFT, { after: 20 });
    vi.advanceTimersByTime(DOUBLE_TAP_MS * 2);
    expect(calls).toEqual(["double:back"]);
  });

  it("on the other side skip the other way", () => {
    const { calls, tap } = setup();
    tap(RIGHT);
    tap(RIGHT + 5);
    expect(calls).toEqual(["double:forward"]);
  });

  it("in the middle are a double tap of the middle, which is no skip", () => {
    const { calls, tap } = setup();
    tap(MIDDLE);
    tap(MIDDLE);
    expect(calls).toEqual(["double:middle"]);
    tap(MIDDLE);
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(calls).toEqual(["double:middle", "tap:touch:away"]); // (the middle does not run on: a third is the first of the next pair)
  });

  it("still count when the second finger is lifted after the wait would have run out", () => {
    const { calls, tap } = setup();
    tap(LEFT);
    vi.advanceTimersByTime(DOUBLE_TAP_MS - 30);
    tap(LEFT, { after: 200 }); // pressed in time, a slow tap
    expect(calls).toEqual(["double:back"]);
  });

  it("run on: each further tap on the same side skips again at once", () => {
    const { calls, tap } = setup();
    tap(LEFT);
    tap(LEFT);
    tap(LEFT);
    tap(LEFT);
    expect(calls).toEqual(["double:back", "double:back", "double:back"]);
  });

  it("run on only for as long as taps keep coming", () => {
    const { calls, tap } = setup();
    tap(RIGHT);
    tap(RIGHT);
    vi.advanceTimersByTime(CHAIN_MS + 10);
    tap(RIGHT);
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(calls).toEqual(["double:forward", "tap:touch:away"]);
  });

  it("run on for as long as each tap comes soon after the one before it, however long that goes on", () => {
    const { calls, tap } = setup();
    tap(RIGHT);
    tap(RIGHT);
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(CHAIN_MS - 100); // (more than the run's first window in all, less than one window since the last tap)
      tap(RIGHT);
    }
    expect(calls).toEqual(["double:forward", "double:forward", "double:forward", "double:forward"]);
  });

  it("are two taps when they are on different sides, the first one standing by itself", () => {
    const { calls, tap } = setup();
    tap(LEFT);
    tap(RIGHT);
    expect(calls).toEqual(["tap:touch:away"]);
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(calls).toEqual(["tap:touch:away", "tap:touch:away"]);
  });

  it("break a run of skips when a tap lands on the other side", () => {
    const { calls, tap } = setup();
    tap(LEFT);
    tap(LEFT);
    tap(RIGHT);
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(calls).toEqual(["double:back", "tap:touch:away"]);
  });

  it("let the first stand by itself when the second press is a drag", () => {
    const { calls, gestures, tap, press } = setup();
    tap(LEFT, { visible: true });
    const id = press(LEFT);
    gestures.move(id, LEFT, 300 + MOVE_PX + 5);
    expect(calls).toEqual(["tap:touch:up"]);
    gestures.end(id);
    vi.advanceTimersByTime(DOUBLE_TAP_MS * 2);
    expect(calls).toEqual(["tap:touch:up"]);
  });

  it("let the first stand by itself when the second press is taken away", () => {
    const { calls, gestures, tap, press } = setup();
    tap(LEFT);
    const id = press(LEFT);
    gestures.cancel(id);
    expect(calls).toEqual(["tap:touch:away"]);
    vi.advanceTimersByTime(DOUBLE_TAP_MS * 2);
    expect(calls).toHaveLength(1);
  });
});

describe("a hold", () => {
  it("starts when a finger has rested long enough, and ends when it lifts, with no tap", () => {
    const { calls, gestures, press } = setup();
    const id = press(MIDDLE);
    vi.advanceTimersByTime(HOLD_MS - 1);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual(["hold"]);
    gestures.end(id);
    vi.advanceTimersByTime(DOUBLE_TAP_MS * 2);
    expect(calls).toEqual(["hold", "release"]);
  });

  it("goes on while the finger drifts", () => {
    const { calls, gestures, press } = setup();
    const id = press(MIDDLE);
    vi.advanceTimersByTime(HOLD_MS);
    gestures.move(id, MIDDLE + 200, 400);
    expect(calls).toEqual(["hold"]);
    gestures.end(id);
    expect(calls).toEqual(["hold", "release"]);
  });

  it("does not start for a finger that moved first", () => {
    const { calls, gestures, press } = setup();
    const id = press(MIDDLE);
    gestures.move(id, MIDDLE + MOVE_PX + 1, 300);
    vi.advanceTimersByTime(HOLD_MS * 2);
    gestures.end(id);
    expect(calls).toEqual([]);
  });

  it("is an ordinary slow tap when the page says it means nothing now", () => {
    const { calls, tap } = setup(false);
    tap(MIDDLE, { after: HOLD_MS + 100 });
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(calls).toEqual(["hold", "tap:touch:away"]);
  });

  it("takes back a tap that was waiting for a second", () => {
    const { calls, gestures, tap, press } = setup();
    tap(LEFT);
    const id = press(LEFT);
    vi.advanceTimersByTime(HOLD_MS);
    gestures.end(id);
    vi.advanceTimersByTime(DOUBLE_TAP_MS * 2);
    expect(calls).toEqual(["hold", "release"]);
  });

  it("leaves nothing of the tap it took back: the next tap on that side is an ordinary one", () => {
    const { calls, gestures, tap, press } = setup();
    tap(LEFT);
    const id = press(LEFT);
    vi.advanceTimersByTime(HOLD_MS);
    gestures.end(id);
    vi.advanceTimersByTime(DOUBLE_TAP_MS * 2);
    tap(LEFT);
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(calls).toEqual(["hold", "release", "tap:touch:away"]);
  });

  it("ends when the browser takes the pointer away", () => {
    const { calls, gestures, press } = setup();
    const id = press(MIDDLE);
    vi.advanceTimersByTime(HOLD_MS);
    gestures.cancel(id);
    expect(calls).toEqual(["hold", "release"]);
    vi.advanceTimersByTime(DOUBLE_TAP_MS * 2);
    expect(calls).toHaveLength(2);
  });

  it("ends on a reset (the window lost the focus, a menu opened)", () => {
    const { calls, gestures, press } = setup();
    press(MIDDLE);
    vi.advanceTimersByTime(HOLD_MS);
    gestures.reset();
    expect(calls).toEqual(["hold", "release"]);
  });
});

describe("a second finger", () => {
  it("makes a pinch of it: nothing is tapped, held or skipped, and a hold in progress ends", () => {
    const { calls, gestures, press } = setup();
    const first = press(LEFT);
    vi.advanceTimersByTime(HOLD_MS);
    const second = press(RIGHT);
    expect(calls).toEqual(["hold", "release"]);
    gestures.end(first);
    gestures.end(second);
    vi.advanceTimersByTime(DOUBLE_TAP_MS * 2);
    expect(calls).toEqual(["hold", "release"]);
  });

  it("is over when both are up: the next tap is an ordinary one", () => {
    const { calls, gestures, tap, press } = setup();
    const first = press(LEFT);
    const second = press(RIGHT);
    gestures.end(first);
    gestures.end(second);
    tap(MIDDLE);
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(calls).toEqual(["tap:touch:away"]);
  });
});

describe("reset", () => {
  it("drops a tap that was waiting, and a run of skips", () => {
    const { calls, gestures, tap } = setup();
    tap(LEFT);
    gestures.reset();
    vi.advanceTimersByTime(DOUBLE_TAP_MS * 2);
    expect(calls).toEqual([]);

    tap(RIGHT);
    tap(RIGHT);
    gestures.reset();
    tap(RIGHT);
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(calls).toEqual(["double:forward", "tap:touch:away"]);
  });
});
