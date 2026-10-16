import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHAIN_MS, DOUBLE_TAP_MS, HOLD_MS, MOVE_PX, PictureGestures, sideOf, type PictureActions, type PointerKind, type Zone } from "./gestures";

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
  const tap = (x: number, { kind = "touch", after = 40, visible = false, zone }: { kind?: PointerKind; after?: number; visible?: boolean; zone?: Zone } = {}) => {
    id += 1;
    gestures.start({ id, x, y: 300, width: WIDTH, kind, wasVisible: visible, ...(zone ? { zone } : {}) });
    vi.advanceTimersByTime(after);
    gestures.end(id);
  };
  const press = (x: number, kind: PointerKind = "touch", zone?: Zone) => {
    id += 1;
    gestures.start({ id, x, y: 300, width: WIDTH, kind, wasVisible: false, ...(zone ? { zone } : {}) });
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

  it("is a click for a mouse as well, acted on after the same wait", () => {
    const { calls, tap } = setup();
    tap(LEFT, { kind: "mouse" });
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(calls).toEqual(["tap:mouse:away"]);
  });

  it("is no pair with a click that follows it: a finger's tap and a mouse's click each stand by themselves", () => {
    const { calls, tap } = setup();
    tap(LEFT);
    tap(LEFT, { kind: "mouse" });
    expect(calls).toEqual(["tap:touch:away"]); // (the click waits, as any does)
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(calls).toEqual(["tap:touch:away", "tap:mouse:away"]);
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

describe("a run of skips", () => {
  // (each of these goes by the time the next tap comes within the run's window: it is the ordinary tap it would be after any pause)
  it("is over when a finger drags", () => {
    const { calls, gestures, tap, press } = setup();
    tap(RIGHT);
    tap(RIGHT);
    const id = press(RIGHT);
    gestures.move(id, RIGHT, 300 + MOVE_PX + 5);
    gestures.end(id);
    tap(RIGHT);
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(calls).toEqual(["double:forward", "tap:touch:away"]);
  });

  it("is over when the browser takes a finger away", () => {
    const { calls, gestures, tap, press } = setup();
    tap(RIGHT);
    tap(RIGHT);
    gestures.cancel(press(RIGHT));
    tap(RIGHT);
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(calls).toEqual(["double:forward", "tap:touch:away"]);
  });

  it("is over when a second finger makes a pinch of it", () => {
    const { calls, gestures, tap, press } = setup();
    tap(RIGHT);
    tap(RIGHT);
    const first = press(RIGHT);
    const second = press(LEFT);
    gestures.end(first);
    gestures.end(second);
    tap(RIGHT);
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(calls).toEqual(["double:forward", "tap:touch:away"]);
  });

  it("is over when a finger is held", () => {
    const { calls, gestures, tap, press } = setup();
    tap(RIGHT);
    tap(RIGHT);
    const id = press(RIGHT);
    vi.advanceTimersByTime(HOLD_MS);
    gestures.end(id);
    tap(RIGHT);
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(calls).toEqual(["double:forward", "hold", "release", "tap:touch:away"]);
  });

  it("is over when a mouse clicks", () => {
    const { calls, tap } = setup();
    tap(RIGHT);
    tap(RIGHT);
    tap(RIGHT, { kind: "mouse" });
    tap(RIGHT);
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(calls).toEqual(["double:forward", "tap:mouse:away", "tap:touch:away"]);
  });
});

describe("a finger on the bars laid over the picture", () => {
  it("taps, and puts the controls away, like one on the picture", () => {
    const { calls, tap } = setup();
    tap(MIDDLE, { zone: "bar", visible: true });
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(calls).toEqual(["tap:touch:up"]);
  });

  it("skips on a double tap at the side, like one on the picture", () => {
    const { calls, tap } = setup();
    tap(LEFT, { zone: "bar" });
    tap(LEFT, { zone: "bar" });
    expect(calls).toEqual(["double:back"]);
  });

  it("does not hold, however long it rests: on its way to a button it is no wish to play faster", () => {
    const { calls, gestures, press } = setup();
    const id = press(MIDDLE, "touch", "bar");
    vi.advanceTimersByTime(HOLD_MS * 3);
    expect(calls).toEqual([]);
    gestures.end(id);
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(calls).toEqual(["tap:touch:away"]); // (a slow tap, but a tap)
  });

  it("holds on the picture, which is where a press lands when the page does not say", () => {
    const { calls, press } = setup();
    press(MIDDLE, "touch", "picture");
    vi.advanceTimersByTime(HOLD_MS);
    expect(calls).toEqual(["hold"]);
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

describe("a mouse", () => {
  it("skips on a double click at a side, as two taps of a finger do, and the first click is not a click of its own", () => {
    const { calls, tap } = setup();
    tap(LEFT, { kind: "mouse" });
    vi.advanceTimersByTime(DOUBLE_TAP_MS - 20);
    tap(LEFT, { kind: "mouse", after: 20 });
    vi.advanceTimersByTime(DOUBLE_TAP_MS * 2);
    expect(calls).toEqual(["double:back"]);
  });

  it("skips forward on the other side", () => {
    const { calls, tap } = setup();
    tap(RIGHT, { kind: "mouse" });
    tap(RIGHT + 5, { kind: "mouse" });
    expect(calls).toEqual(["double:forward"]);
  });

  it("goes full screen on a double click in the middle, which is no skip", () => {
    const { calls, tap } = setup();
    tap(MIDDLE, { kind: "mouse" });
    tap(MIDDLE, { kind: "mouse" });
    expect(calls).toEqual(["double:middle"]);
  });

  it("runs on: a click soon after a double click skips again, and a run of a mouse is a mouse's alone", () => {
    const { calls, tap } = setup();
    tap(RIGHT, { kind: "mouse" });
    tap(RIGHT, { kind: "mouse" });
    tap(RIGHT, { kind: "mouse" });
    expect(calls).toEqual(["double:forward", "double:forward"]);
    tap(RIGHT); // (a finger's tap on that side is the first of its own pair)
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(calls).toEqual(["double:forward", "double:forward", "tap:touch:away"]);
  });

  it("is two clicks when they are on different sides, the first standing by itself", () => {
    const { calls, tap } = setup();
    tap(LEFT, { kind: "mouse" });
    tap(RIGHT, { kind: "mouse" });
    expect(calls).toEqual(["tap:mouse:away"]);
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(calls).toEqual(["tap:mouse:away", "tap:mouse:away"]);
  });

  it("is two clicks when the second comes too late", () => {
    const { calls, tap } = setup();
    tap(LEFT, { kind: "mouse" });
    vi.advanceTimersByTime(DOUBLE_TAP_MS + 10);
    tap(LEFT, { kind: "mouse" });
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(calls).toEqual(["tap:mouse:away", "tap:mouse:away"]);
  });

  it("holds with the button down long enough, and lifting it ends the hold with no click", () => {
    const { calls, gestures, press } = setup();
    const id = press(MIDDLE, "mouse");
    vi.advanceTimersByTime(HOLD_MS - 1);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual(["hold"]);
    gestures.end(id);
    vi.advanceTimersByTime(DOUBLE_TAP_MS * 2);
    expect(calls).toEqual(["hold", "release"]);
  });

  it("is an ordinary slow click when the page says a hold means nothing now (the picture is paused)", () => {
    const { calls, tap } = setup(false);
    tap(MIDDLE, { kind: "mouse", after: HOLD_MS + 100 });
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(calls).toEqual(["hold", "tap:mouse:away"]);
  });

  it("takes back a click that was waiting for a second when the button is held down instead", () => {
    const { calls, gestures, press, tap } = setup();
    tap(LEFT, { kind: "mouse" });
    const id = press(LEFT, "mouse");
    vi.advanceTimersByTime(HOLD_MS);
    gestures.end(id);
    vi.advanceTimersByTime(DOUBLE_TAP_MS * 2);
    expect(calls).toEqual(["hold", "release"]);
  });

  it("is no click when dragged, and no hold either", () => {
    const { calls, gestures, press } = setup();
    const id = press(MIDDLE, "mouse");
    gestures.move(id, MIDDLE + MOVE_PX + 1, 300);
    vi.advanceTimersByTime(HOLD_MS * 2);
    gestures.end(id);
    vi.advanceTimersByTime(DOUBLE_TAP_MS * 2);
    expect(calls).toEqual([]);
  });

  it("does not hold on the bars, however long the button rests: on its way to a button it is no wish to play faster", () => {
    const { calls, gestures, press } = setup();
    const id = press(MIDDLE, "mouse", "bar");
    vi.advanceTimersByTime(HOLD_MS * 3);
    expect(calls).toEqual([]);
    gestures.end(id);
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(calls).toEqual(["tap:mouse:away"]);
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
