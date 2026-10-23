import { describe, expect, it } from "vitest";
import { DWELL_MS, EdgeScroll, edgeAt, FASTEST, IDLE_MS, LOOK_MS, RAMP_MS, SLOWEST, speedAt, stripOf, type EdgeHint, type EdgeWorld, type Page, type PointerMove } from "./edgeScroll";

const HEIGHT = 720;
const STRIP = stripOf(HEIGHT);

/** A page that scrolls: where it is, how much of it there is, and how much of it shows. */
class FakePage implements Page {
  top = 0;
  constructor(
    public total = 6000,
    private readonly visible = 600,
  ) {}
  room(edge: "top" | "bottom") {
    return edge === "bottom" ? this.top + this.visible < this.total : this.top > 0;
  }
  shown() {
    return this.visible;
  }
  by(pixels: number) {
    this.top = Math.min(this.total - this.visible, Math.max(0, this.top + pixels));
  }
}

/** The machine, with a page for it to scroll (or none), the hints it gave, and a clock that goes along as a loop of frames would take it. */
function setup(page: FakePage | null = new FakePage()) {
  const world = { page, asked: 0, x: -1 };
  const hints: Array<EdgeHint | null> = [];
  const machine = new EdgeScroll(
    {
      pageFor: (_edge, x) => {
        world.asked += 1;
        world.x = x;
        return world.page;
      },
    } satisfies EdgeWorld,
    (hint) => hints.push(hint),
  );
  let now = 0;
  let next: number | null = null;
  const point = (y: number, more: Partial<PointerMove> = {}): PointerMove => ({ x: 400, y, height: HEIGHT, mouse: true, busy: () => false, ...more });
  /** What the binding does: look now, and again when it is told to. `run(ms)` lets that much time go by. */
  const look = () => {
    next = machine.frame(now);
  };
  const run = (ms: number) => {
    const end = now + ms;
    while (next !== null && now < end) {
      now = Math.min(end, now + (next === 0 ? 16 : next));
      look();
    }
    now = end;
  };
  /** The pointer goes to `y` (and, as the binding does when something is to be looked at, the machine looks at once). */
  const moveTo = (y: number, more: Partial<PointerMove> = {}) => {
    if (machine.move(point(y, more))) look();
  };
  return { world, hints, machine, moveTo, run, look, clock: () => now, after: () => hints.at(-1) ?? null };
}

describe("the strip", () => {
  it("is thin, and as thick as the screen is tall within limits", () => {
    expect(stripOf(720)).toBe(18);
    expect(stripOf(1080)).toBe(27);
    expect(stripOf(2160)).toBe(40);
    expect(stripOf(4320)).toBe(40);
    expect(stripOf(200)).toBe(16);
  });

  it("is at the top and at the bottom of the screen, and nowhere else", () => {
    expect(edgeAt(0, 720)).toBe("top");
    expect(edgeAt(18, 720)).toBe("top");
    expect(edgeAt(19, 720)).toBeNull();
    expect(edgeAt(360, 720)).toBeNull();
    expect(edgeAt(701, 720)).toBeNull();
    expect(edgeAt(702, 720)).toBe("bottom");
    expect(edgeAt(719, 720)).toBe("bottom");
  });

  it("is left only when the pointer is well out of it (a hand shakes)", () => {
    expect(edgeAt(690, 720, "bottom")).toBe("bottom");
    expect(edgeAt(684, 720, "bottom")).toBe("bottom");
    expect(edgeAt(683, 720, "bottom")).toBeNull();
    expect(edgeAt(30, 720, "top")).toBe("top");
    expect(edgeAt(37, 720, "top")).toBeNull();
    // (and one that was in the other is no more in this one than a new pointer would be)
    expect(edgeAt(690, 720, "top")).toBeNull();
  });
});

describe("how fast the page goes", () => {
  it("starts gently, goes faster the longer it has gone on, and stops getting faster", () => {
    expect(speedAt(0)).toBe(SLOWEST);
    expect(speedAt(RAMP_MS / 2)).toBeCloseTo((SLOWEST + FASTEST) / 2);
    expect(speedAt(RAMP_MS)).toBe(FASTEST);
    expect(speedAt(RAMP_MS * 10)).toBe(FASTEST);
    expect(speedAt(-5)).toBe(SLOWEST);
  });
});

describe("a pointer at the bottom of the screen", () => {
  it("says it is waiting at once, moves nothing for a second, and then scrolls the page down", () => {
    const s = setup();
    s.moveTo(719);
    expect(s.after()).toEqual({ edge: "bottom", moving: false });
    s.run(DWELL_MS - 100);
    expect(s.world.page!.top).toBe(0);
    expect(s.after()).toEqual({ edge: "bottom", moving: false });
    s.run(300);
    expect(s.world.page!.top).toBeGreaterThan(0);
    expect(s.after()).toEqual({ edge: "bottom", moving: true });
  });

  it("goes faster the longer it goes on, and by about a screen a second to begin with", () => {
    const s = setup();
    s.moveTo(719);
    s.run(DWELL_MS);
    const from = s.world.page!.top;
    s.run(1000);
    const first = s.world.page!.top - from;
    s.run(2500);
    const before = s.world.page!.top;
    s.run(1000);
    const later = s.world.page!.top - before;
    expect(first).toBeGreaterThan(600 * SLOWEST * 0.9);
    expect(first).toBeLessThan(600 * FASTEST);
    expect(later).toBeGreaterThan(first);
    expect(later).toBeLessThanOrEqual(600 * FASTEST + 20);
  });

  it("scrolls up from the top of the screen, by the same rule", () => {
    const page = new FakePage();
    page.top = 3000;
    const s = setup(page);
    s.moveTo(0);
    expect(s.after()).toEqual({ edge: "top", moving: false });
    s.run(DWELL_MS - 50);
    expect(page.top).toBe(3000);
    s.run(1500);
    expect(page.top).toBeLessThan(3000);
    expect(s.after()).toEqual({ edge: "top", moving: true });
  });

  it("goes by whole pixels, and loses none of the parts of one", () => {
    const s = setup();
    s.moveTo(719);
    s.run(DWELL_MS);
    const from = s.world.page!.top;
    s.run(1000);
    const moved = s.world.page!.top - from;
    // about 600 px a screen at 0.5 a screen a second, a little faster as it ramps: not a pixel a frame short of that
    expect(moved).toBeGreaterThan(300 + 0.2 * 600 * 0.9);
    expect(Number.isInteger(s.world.page!.top)).toBe(true);
  });

  it("comes to a stop at the end of the page, with nothing said, and goes on when the page has more", () => {
    const page = new FakePage(1500, 600); // 900 px to go
    const s = setup(page);
    s.moveTo(719);
    s.run(DWELL_MS + 2500);
    expect(page.top).toBe(900);
    expect(s.after()).toBeNull();
    // (the library brings more rows as it nears its end)
    page.total = 4000;
    s.run(IDLE_MS + 500);
    expect(page.top).toBeGreaterThan(900);
    expect(s.after()).toEqual({ edge: "bottom", moving: true });
  });

  it("is not a hint where no page goes that way, and counts the wait again from when there is one", () => {
    const s = setup(null);
    s.moveTo(719);
    expect(s.after()).toBeNull();
    s.run(5000);
    expect(s.after()).toBeNull();
    const page = new FakePage();
    s.world.page = page;
    s.run(IDLE_MS + 20); // (it looks again within that)
    expect(s.after()).toEqual({ edge: "bottom", moving: false });
    const shownAt = s.clock();
    s.run(DWELL_MS - 100);
    expect(page.top).toBe(0);
    s.run(shownAt + DWELL_MS + 300 - s.clock());
    expect(page.top).toBeGreaterThan(0);
  });

  it("counts the wait again when the page goes away while the pointer waits and comes back", () => {
    const page = new FakePage();
    const s = setup(page);
    s.moveTo(719);
    s.run(DWELL_MS - 300); // (nearly there)
    s.world.page = null; // (the page the pointer was waiting on is gone: a title page closed, the library changed)
    s.run(1_500);
    expect(s.after()).toBeNull();
    s.world.page = page;
    s.run(IDLE_MS + 20); // (it looks again within that)
    expect(s.after()).toEqual({ edge: "bottom", moving: false });
    s.run(DWELL_MS - 300);
    expect(page.top).toBe(0); // (not on the old count)
    s.run(600);
    expect(page.top).toBeGreaterThan(0);
  });

  it("has nothing to scroll up when the page is at its top", () => {
    const s = setup();
    s.moveTo(0);
    expect(s.after()).toBeNull();
    s.run(3000);
    expect(s.world.page!.top).toBe(0);
  });
});

describe("a pointer that does not stay", () => {
  it("that only passes through the strip moves nothing, and leaves no hint", () => {
    const s = setup();
    s.moveTo(719);
    s.run(DWELL_MS - 400);
    s.moveTo(300);
    expect(s.after()).toBeNull();
    s.run(3000);
    expect(s.world.page!.top).toBe(0);
  });

  it("that leaves the strip stops the page where it is", () => {
    const s = setup();
    s.moveTo(719);
    s.run(DWELL_MS + 800);
    const at = s.world.page!.top;
    expect(at).toBeGreaterThan(0);
    s.moveTo(300);
    expect(s.after()).toBeNull();
    s.run(2000);
    expect(s.world.page!.top).toBe(at);
  });

  it("that shakes at the edge of the strip stays in it", () => {
    const s = setup();
    s.moveTo(715);
    s.run(600);
    s.moveTo(690); // (out of the strip, not out of its slack)
    s.run(600);
    expect(s.world.page!.top).toBeGreaterThan(0);
  });

  it("that is a finger or a pen is no pointer that rests", () => {
    const s = setup();
    s.moveTo(719, { mouse: false });
    expect(s.after()).toBeNull();
    s.run(3000);
    expect(s.world.page!.top).toBe(0);
    // and one that was resting is stopped by a finger
    s.moveTo(719);
    s.run(DWELL_MS + 400);
    expect(s.world.page!.top).toBeGreaterThan(0);
    const at = s.world.page!.top;
    s.moveTo(500, { mouse: false });
    s.run(1000);
    expect(s.world.page!.top).toBe(at);
    expect(s.after()).toBeNull();
  });

  it("that holds a button, or is on the menu, is not waiting for the page", () => {
    const s = setup();
    s.moveTo(719, { busy: () => true });
    expect(s.after()).toBeNull();
    s.run(3000);
    expect(s.world.page!.top).toBe(0);
    s.moveTo(718); // (the button was let go, or the menu left, and the pointer is still against the edge)
    expect(s.after()).toEqual({ edge: "bottom", moving: false });
  });

  it("that has left the page, or whose page has gone away, is stopped", () => {
    const s = setup();
    s.moveTo(719);
    s.run(DWELL_MS + 400);
    const at = s.world.page!.top;
    s.machine.stand();
    s.look();
    s.run(1500);
    expect(s.world.page!.top).toBe(at);
    expect(s.after()).toBeNull();
  });
});

describe("what else is in use", () => {
  it.each(["a key", "a press"])("%s ends it, and the pointer has to go out of the strip and come back before it counts", () => {
    const s = setup();
    s.moveTo(719);
    s.run(DWELL_MS + 500);
    const at = s.world.page!.top;
    expect(at).toBeGreaterThan(0);
    s.machine.other();
    s.look();
    expect(s.after()).toBeNull();
    s.run(2000);
    expect(s.world.page!.top).toBe(at);
    // (moving about inside the strip is not coming back, and nor is a move to where the pointer already is)
    s.moveTo(719);
    s.moveTo(717);
    s.moveTo(719);
    s.run(3000);
    expect(s.world.page!.top).toBe(at);
    expect(s.after()).toBeNull();
    // out, and in again
    s.moveTo(300);
    s.moveTo(719);
    expect(s.after()).toEqual({ edge: "bottom", moving: false });
    s.run(DWELL_MS + 500);
    expect(s.world.page!.top).toBeGreaterThan(at);
  });

  it("while the wait is on is the same: a pointer left at the edge while the remote is used does nothing", () => {
    const s = setup();
    s.moveTo(719);
    s.run(400);
    s.machine.other();
    s.look();
    s.run(5000);
    expect(s.world.page!.top).toBe(0);
    expect(s.after()).toBeNull();
  });

  it("is nothing to a pointer that is not in a strip: it counts as soon as it moves into one", () => {
    const s = setup();
    s.moveTo(300);
    s.machine.other();
    s.look();
    s.moveTo(719);
    expect(s.after()).toEqual({ edge: "bottom", moving: false });
    s.run(DWELL_MS + 300);
    expect(s.world.page!.top).toBeGreaterThan(0);
  });

  it("a wheel ends it for good: what was moving stops, and nothing the pointer does after starts it again", () => {
    const s = setup();
    s.moveTo(719);
    s.run(DWELL_MS + 500);
    const at = s.world.page!.top;
    expect(at).toBeGreaterThan(0);
    s.machine.retire();
    s.look();
    expect(s.after()).toBeNull();
    s.run(2000);
    expect(s.world.page!.top).toBe(at);
    const looked = s.world.asked;
    // out of the strip and in again, in the other strip, with a finger between: none of it counts
    s.moveTo(300);
    s.moveTo(719);
    s.moveTo(300, { mouse: false });
    s.moveTo(2);
    s.run(DWELL_MS + 2000);
    expect(s.after()).toBeNull();
    expect(s.world.page!.top).toBe(at);
    expect(s.world.asked).toBe(looked); // (and it did not so much as look)
  });

  it("a wheel before the pointer ever rests means it never does", () => {
    const s = setup();
    s.machine.retire();
    s.moveTo(300);
    s.moveTo(719);
    expect(s.after()).toBeNull();
    s.run(DWELL_MS + 2000);
    expect(s.world.page!.top).toBe(0);
    expect(s.world.asked).toBe(0);
  });

  it("a move to where the pointer already is (a page that moves under a pointer that rests makes the browser say so) starts nothing, and puts nothing off", () => {
    const s = setup();
    s.moveTo(300);
    s.machine.other();
    s.look();
    s.moveTo(300);
    expect(s.after()).toBeNull();
    s.moveTo(719);
    s.run(500);
    s.moveTo(719); // again, in the strip: the wait is not begun again by it
    s.run(DWELL_MS - 500 + 200);
    expect(s.world.page!.top).toBeGreaterThan(0);
  });
});

describe("the looking", () => {
  it("is for the page at the side of the screen the pointer is at", () => {
    const s = setup();
    s.moveTo(719, { x: 123 });
    expect(s.world.x).toBe(123);
    s.moveTo(715, { x: 900 }); // (along the edge: the next look is at the new place)
    s.run(LOOK_MS + 20);
    expect(s.world.x).toBe(900);
  });

  it("is not done for a pointer that is not in a strip, nor is the question of whether it is busy", () => {
    const s = setup();
    let asked = 0;
    const busy = () => {
      asked += 1;
      return false;
    };
    s.moveTo(300, { busy });
    s.moveTo(310, { busy });
    s.moveTo(400, { busy });
    expect(asked).toBe(0);
    expect(s.world.asked).toBe(0);
    expect(s.machine.frame(1000)).toBeNull();
    s.moveTo(719, { busy }); // (in a strip, it is: once, as the pointer comes in)
    expect(asked).toBe(1);
    expect(s.world.asked).toBe(1);
  });

  it("is a few times a second while the pointer waits, and the wait is not one frame longer than a second", () => {
    const s = setup();
    s.moveTo(719);
    const askedAtFirst = s.world.asked;
    s.run(DWELL_MS - 10);
    // one look at the page for the start, and one every LOOK_MS after
    expect(s.world.asked - askedAtFirst).toBeLessThanOrEqual(Math.ceil(DWELL_MS / LOOK_MS) + 1);
    s.run(40);
    expect(s.after()).toEqual({ edge: "bottom", moving: true });
  });

  it("does not take a long stall for time the page should have gone through", () => {
    const s = setup();
    s.moveTo(719);
    s.run(DWELL_MS + 100);
    const at = s.world.page!.top;
    const next = s.machine.frame(s.clock() + 5000); // five seconds in one frame
    expect(next).toBe(0);
    expect(s.world.page!.top - at).toBeLessThan(600 * FASTEST * 0.07 + 2);
  });
});
