import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Back = typeof import("./backButton");
let back: Back;

type Listener = (event: Record<string, unknown>) => void;

/**
 * Just enough of a browser: the history (entries, a position, and a `popstate` that comes after a Back, as it does, a moment later), the
 * events a page listens to, a clock the test moves, and whether the person has used the page yet.
 *
 * It keeps the rule that Chrome keeps about the entries a page makes (checked with the browser's own Back, see docs/android-back.md): an entry
 * made while the person has not touched the page since their last Back (or since it opened) is held against the page, and a Back passes over
 * every entry under it, out of the site if there is none left. Touching the page (a finger lifted, a click, a key) lets go of it all again.
 * What the page does with `go` is its own and passes over nothing; `replaceState` makes no entry.
 */
function browser(start: unknown[] = [null], at = 0) {
  const entries: unknown[] = [...start];
  const passedOver: boolean[] = start.map(() => false);
  const listeners = new Map<string, Set<Listener>>();
  const timers = new Map<number, { at: number; run: () => void }>();
  let now = 0;
  let next = 0;
  let activated = false;
  let activeUntil = -1;
  /** The entries the page makes now count (the person touched the page since their last Back). */
  let counts = false;
  let pushes = 0;
  let gone = false;
  /** The page's own `go` takes its time (the arrivals wait in `late`). */
  let slow = false;
  const late: (() => void)[] = [];
  const dispatch = (type: string, event: Record<string, unknown> = {}) => listeners.get(type)?.forEach((listener) => listener({ type, isTrusted: true, ...event }));
  const arrive = (target: number) =>
    queueMicrotask(() => {
      at = target;
      dispatch("popstate", { state: entries[at] });
    });
  const window = {
    history: {
      get state() {
        return entries[at];
      },
      pushState: (state: unknown) => {
        entries.splice(at + 1);
        passedOver.splice(at + 1);
        entries.push(state);
        passedOver.push(false);
        at += 1;
        pushes += 1;
        if (!counts) passedOver.fill(true, 0, at);
      },
      replaceState: (state: unknown) => void (entries[at] = state),
      // It goes where the history stood when it was asked: a push that follows in the same moment does not change where (as in a real
      // browser, where this is how a Back and a push in one render ended with the new layer closed by the Back).
      go: (delta: number) => {
        const target = at + delta;
        const arrive = () => {
          if (target < 0) gone = true; // (past the first entry the browser leaves the page: nothing is said to it)
          if (target < 0 || target >= entries.length) return; // (and with no entry ahead it does nothing)
          at = target;
          dispatch("popstate", { state: entries[at] });
        };
        if (slow) late.push(arrive);
        else queueMicrotask(arrive);
      },
      back: () => window.history.go(-1),
    },
    navigator: {
      get userActivation() {
        return { hasBeenActive: activated, isActive: now < activeUntil };
      },
    },
    addEventListener: (type: string, fn: Listener) => void (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn),
    removeEventListener: (type: string, fn: Listener) => void listeners.get(type)?.delete(fn),
    setTimeout: (run: () => void, ms = 0) => {
      next += 1;
      timers.set(next, { at: now + ms, run });
      return next;
    },
    clearTimeout: (id: number | undefined) => void (id !== undefined && timers.delete(id)),
  };
  // (everything the history says comes in a microtask of the one before it: a few turns of them are the moment a browser takes)
  const settle = async () => {
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
  };
  return {
    window,
    entries,
    /** The person's Back button. */
    async press() {
      counts = false;
      let target = at - 1;
      while (target >= 0 && passedOver[target]) target -= 1;
      if (target < 0) gone = true; // (nowhere in the site to go: the phone leaves it)
      else arrive(target);
      await settle();
    },
    /** The person's thumb on the page (the browser counts it from now on, and lets go of what it held against the page). */
    async touch(type = "pointerup") {
      activated = true;
      counts = true;
      activeUntil = now + 5000;
      passedOver.fill(false);
      dispatch(type, { pointerType: "touch" });
      await settle();
    },
    /** An event the browser does not count as the person using the page (a finger that only went down). */
    async fire(type: string, extra: Record<string, unknown> = {}) {
      dispatch(type, extra);
      await settle();
    },
    settle,
    /** What the page asks of the history with `go` arrives only once `arrive` is called. */
    slowly: () => void (slow = true),
    /** ...and how many arrivals are waiting, or that they never come. */
    pending: () => late.length,
    lose: () => void late.splice(0),
    async arrive() {
      slow = false;
      late.splice(0).forEach((run) => run());
      await settle();
    },
    depth: () => at,
    /** How many entries the page has made. */
    pushes: () => pushes,
    /** The Back found nothing in the site to go to. */
    left: () => gone,
    listening: () => (listeners.get("popstate")?.size ?? 0) > 0,
    /** Time passes: the timers that fall due run. */
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at > now) continue;
        timers.delete(id);
        timer.run();
      }
    },
    now: () => now,
  };
}

let page: ReturnType<typeof browser>;
const left: (() => void)[] = [];

/** A layer, as a component that opened it would hold it. */
function open(close: () => void = () => undefined) {
  const layer = back.openLayer(close);
  left.push(layer.leave);
  return layer;
}

/** The page of a person with a phone: the guard is put under it, and the first touch is what lets it stand. */
async function started(start?: unknown[], at?: number) {
  if (start) page = browser(start, at);
  vi.stubGlobal("window", page.window);
  back.installExitGuard();
  await page.touch();
}

async function fresh() {
  vi.resetModules();
  back = await import("./backButton");
  page = browser();
  vi.stubGlobal("window", page.window);
}

beforeEach(async () => {
  await fresh();
  vi.spyOn(Date, "now").mockImplementation(() => page.now());
});
afterEach(async () => {
  left.splice(0).forEach((leave) => leave());
  await page.settle(); // (the entries of those come off a moment later, and need the window to do it)
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the Back button", () => {
  // (A sheet is opened by a touch, and the entry it makes counts with the browser.)
  beforeEach(async () => {
    await page.touch();
  });

  it("closes what is on top, one at a time", async () => {
    const lower = vi.fn();
    const upper = vi.fn();
    open(lower);
    const top = open(upper);
    expect(page.depth()).toBe(2);

    await page.press();
    expect(upper).toHaveBeenCalledTimes(1);
    expect(lower).not.toHaveBeenCalled();
    top.leave(); // (it closed, as the thing that opened it does when it is asked to: its entry has gone already)
    await page.settle();
    expect(page.depth()).toBe(1);

    await page.press();
    expect(lower).toHaveBeenCalledTimes(1);
  });

  it("takes a layer's entry off again when it closed some other way, without closing anything under it", async () => {
    const lower = vi.fn();
    open(lower);
    const top = open();
    top.leave(); // its own button
    await page.settle();
    expect(page.depth()).toBe(1);
    expect(lower).not.toHaveBeenCalled();
  });

  it("gives a layer that stays (a page that only steps back to the one before) its entry again, by going forward to it: no entry is made", async () => {
    const stepBack = vi.fn();
    const layer = open(stepBack);
    const made = page.pushes();
    await page.press();
    expect(stepBack).toHaveBeenCalledTimes(1);
    expect(page.depth()).toBe(0);

    layer.stayed(); // it drew again, still there
    await page.settle();
    expect(page.depth()).toBe(1);
    expect(page.pushes()).toBe(made); // (an entry made now would be held against the page: the person has not touched it since the Back)
    await page.press();
    expect(stepBack).toHaveBeenCalledTimes(2);
    expect(page.left()).toBe(false);
  });

  it("does the same for a layer that did not draw at all", async () => {
    open();
    await page.press();
    page.advance(150);
    await page.settle();
    expect(page.depth()).toBe(1);
  });

  it("does not put the entry back for a layer that has gone", async () => {
    const layer = open();
    await page.press();
    layer.leave();
    page.advance(150);
    layer.stayed();
    await page.settle();
    expect(page.depth()).toBe(0);
  });

  it("keeps the page when a layer is swapped for another in the same moment (a sheet for the one it opens)", async () => {
    const menu = open();
    const party = vi.fn();
    menu.leave(); // the menu closes ...
    open(party); // ... and the party sheet opens, in the same render
    await page.settle();
    expect(party).not.toHaveBeenCalled();
    expect(page.depth()).toBe(1); // (one entry for the one layer, not two and not none)

    await page.press();
    expect(party).toHaveBeenCalledTimes(1);
  });

  it("takes the entry off a layer that was swapped in when it closes by its own button", async () => {
    const menu = open();
    menu.leave();
    const party = open();
    await page.settle();
    expect(page.depth()).toBe(1);
    party.leave();
    await page.settle();
    expect(page.depth()).toBe(0);
  });

  it("swaps a layer that has another under it the same way", async () => {
    const lower = vi.fn();
    const upper = vi.fn();
    open(lower);
    const sheet = open();
    sheet.leave();
    open(upper);
    await page.settle();
    expect(page.depth()).toBe(2);
    expect(upper).not.toHaveBeenCalled();

    await page.press();
    expect(upper).toHaveBeenCalledTimes(1);
    expect(lower).not.toHaveBeenCalled();
  });

  it("takes the entries of layers that all closed in the same moment", async () => {
    const lower = open();
    const upper = open();
    upper.leave();
    lower.leave();
    await page.settle();
    expect(page.depth()).toBe(0);
  });

  it("gives a layer that opens once the one before it has gone an entry of its own", async () => {
    const first = open();
    first.leave();
    await page.settle();
    expect(page.depth()).toBe(0);
    open();
    expect(page.depth()).toBe(1);
  });

  it("listens only while something is open", () => {
    expect(page.listening()).toBe(false);
    const layer = open();
    expect(page.listening()).toBe(true);
    layer.leave();
    expect(page.listening()).toBe(false);
  });

  it("makes no entry for a layer that opens by itself after a Back, and makes it at the next touch", async () => {
    const lower = vi.fn();
    const first = open(lower);
    await page.press(); // (the first layer's entry went; it stays)
    first.stayed();
    await page.settle();
    const made = page.pushes();
    const upper = vi.fn();
    open(upper); // (a sheet that comes up by itself, a party that is offered)
    await page.settle();
    expect(page.pushes()).toBe(made);
    expect(page.depth()).toBe(1);

    await page.touch();
    expect(page.pushes()).toBe(made + 1);
    expect(page.depth()).toBe(2);
    await page.press();
    expect(upper).toHaveBeenCalledTimes(1);
    expect(page.left()).toBe(false);
  });

  it("does not take a touch that does not lift for the person using the page, nor a click that no one made", async () => {
    const first = open();
    await page.press();
    first.stayed();
    await page.settle();
    const made = page.pushes();
    open();
    await page.fire("pointerdown"); // (a finger that only went down)
    await page.fire("click", { isTrusted: false }); // (a script's)
    await page.fire("keydown", { key: "Escape" });
    await page.fire("pointerup", { pointerType: "mouse" }); // (a mouse is counted when it goes down)
    expect(page.pushes()).toBe(made);
    await page.touch("click");
    expect(page.pushes()).toBe(made + 1);
  });

  it("keeps what a touch gave through the entry that goes when a layer is closed by its own button: the next layer, opened by itself, has its entry at once", async () => {
    await page.touch();
    const sheet = open();
    await page.touch("click");
    sheet.leave(); // (its button: the entry goes with a Back of the page's own, which the browser does not count as the person's)
    await page.settle();
    expect(page.depth()).toBe(0);
    const made = page.pushes();
    open(); // (it comes up by itself, with no touch since)
    expect(page.pushes()).toBe(made + 1);
    expect(page.depth()).toBe(1);
  });

  it("takes the entry off a layer that closes while the history is on its way forward to it, once it has arrived", async () => {
    const layer = open();
    await page.press();
    page.slowly();
    layer.stayed(); // (the history is asked to go forward to its entry ...)
    layer.leave(); // ... and its own button closes it before it has got there
    await page.settle();
    expect(page.depth()).toBe(0);
    await page.arrive();
    expect(page.depth()).toBe(0); // (the entry it was given is taken off again)
    open();
    await page.settle();
    expect(page.depth()).toBe(1); // (and nothing is left waiting: the next layer is given an entry)
  });

  it("stops waiting for a history that never arrives, and takes what a layer that closed meanwhile left", async () => {
    const layer = open();
    await page.press();
    page.slowly();
    layer.stayed();
    layer.leave();
    await page.settle();
    page.lose(); // (nothing came)
    page.advance(400);
    await page.settle();
    open();
    expect(page.pending()).toBe(1); // (the next layer is not left waiting for the entry of the one before: its own is asked for)
    await page.arrive();
    expect(page.left()).toBe(false);
    expect(page.depth()).toBe(1);
  });

  it("never goes back past the entries it made, whatever it believes it has: the site is not left by a layer that closes", async () => {
    const layer = open();
    await page.press();
    page.entries.length = 1; // (the entry the layer was to be given again is not there to go forward to)
    layer.stayed();
    await page.settle();
    page.advance(400); // (the page stops waiting for a history that has nowhere to go)
    layer.leave();
    await page.settle();
    expect(page.left()).toBe(false);
    expect(page.depth()).toBe(0);
  });

  it("works on a screen that has no guard, for a layer that stays through a Back and comes back with the next", async () => {
    const stepBack = vi.fn();
    const layer = open(stepBack);
    for (let step = 0; step < 4; step += 1) {
      await page.press();
      layer.stayed();
      await page.settle();
      expect(page.depth()).toBe(1);
    }
    expect(stepBack).toHaveBeenCalledTimes(4);
    expect(page.left()).toBe(false);
  });
});

describe("the bottom of the site", () => {
  it("is left alone until the page has been touched: the browser passes over an entry a page makes by itself, and nothing is lost yet", async () => {
    back.installExitGuard();
    expect(page.entries).toHaveLength(1);
    await page.press(); // (past the first entry: the browser leaves)
    expect(back.hintNow()).toBeNull();
    expect(page.depth()).toBe(0);
    expect(page.left()).toBe(true);
  });

  it("puts one entry under the layers at the first touch, and not another at the next", async () => {
    await started();
    expect(page.entries).toHaveLength(2);
    await page.touch();
    await page.touch("click");
    expect(page.entries).toHaveLength(2);
    expect(page.depth()).toBe(1);
  });

  it("does not put it until a touch the browser counts: a finger that only went down is not one", async () => {
    back.installExitGuard();
    await page.fire("pointerdown");
    expect(page.entries).toHaveLength(1);
    await page.touch("pointerup");
    expect(page.entries).toHaveLength(2);
  });

  it("closes a layer and stays on the page: the guard is under the layers, not in their way", async () => {
    await started();
    const sheet = vi.fn();
    const layer = open(sheet);
    expect(page.depth()).toBe(2);
    await page.press();
    expect(sheet).toHaveBeenCalledTimes(1);
    layer.leave();
    await page.settle();
    expect(page.depth()).toBe(1);
    expect(back.hintNow()).toBeNull();
  });

  it("asks at the bottom instead of leaving: the first Back says so, the second is the browser's", async () => {
    await started();
    await page.press();
    expect(back.hintNow()).toMatchObject({ text: "exit.press", ms: back.ASK_MS, lifted: false });
    expect(page.depth()).toBe(0); // (standing on the page the site was opened on: one more goes through it)
    expect(page.left()).toBe(false);

    await page.press(); // the answer: nothing here puts the guard in its way
    expect(page.left()).toBe(true);
  });

  it("puts the guard back when nobody answers, by going forward to it: the next Back is a first one again", async () => {
    await started();
    const made = page.pushes();
    await page.press();
    page.advance(back.ASK_MS - 1);
    expect(back.hintNow()).not.toBeNull();
    expect(page.depth()).toBe(0);
    page.advance(1);
    await page.settle();
    expect(back.hintNow()).toBeNull();
    expect(page.depth()).toBe(1);
    expect(page.entries).toHaveLength(2); // (no pile of them)
    expect(page.pushes()).toBe(made); // (an entry made by a timer, with no touch since the Back, would have the next Back run past the page)
    await page.press();
    expect(back.hintNow()).not.toBeNull();
    expect(page.left()).toBe(false);
  });

  it("puts it back at once at the first touch: a Back after that is a first one, not the answer to an old question", async () => {
    await started();
    await page.press();
    await page.fire("pointerdown");
    expect(back.hintNow()).toBeNull();
    expect(page.depth()).toBe(1);
    await page.press();
    expect(back.hintNow()).not.toBeNull(); // asked again, not left
    expect(page.left()).toBe(false);
  });

  it("puts it back, if it can be put anew, at the touch that lifts: the entry counts then", async () => {
    await started();
    await page.press();
    page.entries.length = 1; // (something took the entry of the guard that was ahead: it can only be made again)
    await page.touch("click");
    expect(page.entries).toHaveLength(2);
    expect(page.depth()).toBe(1);
    await page.press();
    expect(page.left()).toBe(false);
  });

  it("brings the guard back under a layer that opens while the question is up, and gives the layer its entry at the next touch", async () => {
    await started();
    await page.press();
    const sheet = vi.fn();
    open(sheet); // (it came up by itself: nothing was touched since the Back)
    expect(back.hintNow()).toBeNull();
    await page.settle();
    expect(page.entries).toHaveLength(2); // the page, the guard
    expect(page.depth()).toBe(1);
    await page.touch();
    expect(page.entries).toHaveLength(3); // the page, the guard, the layer
    expect(page.depth()).toBe(2);
    await page.press();
    expect(sheet).toHaveBeenCalledTimes(1);
    expect(page.depth()).toBe(1);
  });

  it("waits for layers that were open before the first touch to be gone, and makes no entry for them until then", async () => {
    back.installExitGuard();
    const sheet = open();
    expect(page.entries).toHaveLength(1); // (nothing is made before the first touch)
    await page.touch();
    expect(page.entries).toHaveLength(2); // the page and the layer's entry (the guard would stand above it: it waits)
    await page.press();
    sheet.leave();
    page.advance(150);
    await page.settle();
    expect(page.depth()).toBe(0);
    await page.touch();
    expect(page.entries).toHaveLength(2); // the page, and the guard that came with the touch after the layer had gone
    expect(page.depth()).toBe(1);
    await page.press();
    expect(back.hintNow()).not.toBeNull();
    expect(page.left()).toBe(false);
  });

  it("goes through an entry an earlier visit left when the page was reloaded or restored on one", async () => {
    const earlier = { layers: 0, guard: true, visit: "earlier" };
    await started([null, earlier, { layers: 1, visit: "earlier" }], 2);
    expect(page.entries).toHaveLength(3);
    await page.press(); // onto the earlier guard, which nothing here stands for: it is passed in the same breath ...
    expect(back.hintNow()).toMatchObject({ text: "exit.press" }); // ... and the question is asked at the bottom
    expect(page.depth()).toBe(0);
  });

  it("does not take a Forward onto the guard, after the question, for an answer: nobody is leaving, and nothing is piled up", async () => {
    await started();
    await page.press();
    expect(back.hintNow()).not.toBeNull();
    page.window.history.go(1);
    await page.settle();
    expect(back.hintNow()).toBeNull();
    expect(page.entries).toHaveLength(2);
    expect(page.depth()).toBe(1);
    await page.press();
    expect(back.hintNow()).not.toBeNull(); // (a first Back again)
  });

  it("puts the guard back for a page that the browser brings back, which may have been asking when it was put away", async () => {
    await started();
    await page.press();
    expect(back.hintNow()).not.toBeNull();
    await page.fire("pageshow", { persisted: true });
    expect(back.hintNow()).toBeNull();
    expect(page.depth()).toBe(1);
    await page.fire("pageshow", { persisted: false });
    expect(page.entries).toHaveLength(2);
  });

  it("does not put the guard on while the layer that closed has not given its entry up, and makes none for one that never had it", async () => {
    back.installExitGuard();
    open().leave(); // closed by its own button, before anything was touched: it never had an entry
    await page.touch();
    expect(page.entries).toHaveLength(2); // the page and the guard
    expect(page.depth()).toBe(1);
    expect(back.hintNow()).toBeNull();
  });

  it("does not put the guard on while the history is going back, nor take the Back for a person's", async () => {
    await started();
    const sheet = open();
    sheet.leave();
    await Promise.resolve(); // (the entry has been asked to go: the history has not said that it has)
    await page.touch();
    expect(back.hintNow()).toBeNull(); // (a Back that nobody pressed is no question at the bottom)
    expect(page.depth()).toBe(1);
    expect(page.left()).toBe(false);
  });

  it("goes forward to the guard and the layers that are open again when a Back went past both", async () => {
    await started();
    const sheet = vi.fn();
    open(sheet);
    const made = page.pushes();
    await page.press(); // two Backs in a row, before the page drew: the guard is gone too
    await page.press();
    expect(sheet).toHaveBeenCalled();
    expect(page.depth()).toBe(0);
    page.advance(150);
    await page.settle();
    expect(page.depth()).toBe(2);
    expect(page.pushes()).toBe(made);
    await page.press();
    expect(page.depth()).toBe(1);
    expect(page.left()).toBe(false);
  });

  it("makes the guard and the layers again, at the next touch, when they were made without it and a Back went past both", async () => {
    await started();
    const sheet = vi.fn();
    open(sheet);
    await page.press();
    await page.press();
    page.entries.length = 1; // (they cannot be gone forward to)
    page.advance(150);
    await page.settle();
    expect(page.depth()).toBe(0);
    page.advance(400); // (a history that has nowhere to go says nothing: the page stops waiting for it)
    await page.touch();
    expect(page.entries).toHaveLength(3);
    expect(page.depth()).toBe(2);
  });

  it("does not go forward to entries that were made when the guard was not under them", async () => {
    back.installExitGuard();
    const sheet = open();
    await page.touch(); // (the layer's entry, no guard under it)
    await page.press();
    sheet.leave(); // closed by the Back
    page.advance(150);
    await page.settle();
    expect(page.depth()).toBe(0); // (the entry that is ahead is the layer's, and is no guard)
    await page.touch();
    await page.press();
    expect(back.hintNow()).not.toBeNull();
    expect(page.left()).toBe(false);
  });

  it("is not there on a screen that was not given it", async () => {
    await page.touch();
    expect(page.entries).toHaveLength(1);
  });

  it("listens as long as the guard stands", async () => {
    await started();
    expect(page.listening()).toBe(true);
  });
});

describe("a Back that asks first", () => {
  it("is not the answer the first time, and is the second time within a moment", () => {
    expect(back.pressAgain("exit.stopParty")).toBe(false);
    expect(back.hintNow()).toMatchObject({ text: "exit.stopParty", lifted: true });
    page.advance(1000);
    expect(back.pressAgain("exit.stopParty")).toBe(true);
    expect(back.hintNow()).toBeNull();
  });

  it("is a first Back again once the moment is over", () => {
    back.pressAgain("exit.stopParty");
    page.advance(back.ASK_MS + 1);
    expect(back.hintNow()).toBeNull();
    expect(back.pressAgain("exit.stopParty")).toBe(false);
  });

  it("is a first Back again for another question", () => {
    back.pressAgain("exit.stopParty");
    expect(back.pressAgain("exit.leaveParty")).toBe(false);
    expect(back.hintNow()).toMatchObject({ text: "exit.leaveParty" });
  });

  it("asks through a layer that does nothing the first time, which keeps its place for the second", async () => {
    await page.touch();
    const stop = vi.fn();
    const onBack = () => void (back.pressAgain("exit.stopParty") && stop());
    const layer = open(onBack);
    await page.press();
    layer.stayed(); // (the page drew again, and the layer is still on it)
    await page.settle();
    expect(stop).not.toHaveBeenCalled();
    expect(page.depth()).toBe(1);
    await page.press();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(page.left()).toBe(false);
  });
});

/* ------------------------------ walks ------------------------------ */

/** A small seeded generator, so a walk that finds something can be walked again. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Random things done to a phone with the browser's rule kept, then a check of what a person is promised: a Back does not take them out of the site
 * unless nothing was touched yet or they were asked at the bottom, and after a touch the history holds the guard and one entry for each layer.
 */
describe("walks with the browser's own Back", () => {
  const WALKS = 150;
  const STEPS = 40;

  it(`keep the person in the site, and the history in order, over ${WALKS} walks of ${STEPS} steps`, async () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= WALKS; seed += 1) {
      await fresh();
      vi.spyOn(Date, "now").mockImplementation(() => page.now());
      const random = rng(seed);
      const log: string[] = [];
      const layers: { handle: ReturnType<typeof open>; stays: number }[] = [];
      let touchedEver = false;
      back.installExitGuard();
      try {
        for (let step = 0; step < STEPS && !page.left(); step += 1) {
          const roll = random();
          if (roll < 0.22) {
            // a tap that opens a layer: one that closes at a Back, one that steps back and stays, one that asks twice
            const kind = ["closes", "stays", "asks"][Math.floor(random() * 3)]!;
            await page.touch(random() < 0.5 ? "pointerup" : "click");
            touchedEver = true;
            const entry: { handle: ReturnType<typeof open>; stays: number } = { handle: undefined as never, stays: 0 };
            entry.handle = open(() => {
              queueMicrotask(() => {
                if (kind === "stays" || (kind === "asks" && entry.stays++ === 0)) entry.handle.stayed();
                else {
                  entry.handle.leave();
                  layers.splice(layers.indexOf(entry), 1);
                }
              });
            });
            layers.push(entry);
            log.push(`open ${kind} (${layers.length} open)`);
          } else if (roll < 0.3 && touchedEver) {
            // a layer that comes up by itself
            const entry: { handle: ReturnType<typeof open>; stays: number } = { handle: undefined as never, stays: 0 };
            entry.handle = open(() =>
              queueMicrotask(() => {
                entry.handle.leave();
                layers.splice(layers.indexOf(entry), 1);
              }),
            );
            layers.push(entry);
            log.push(`open by itself (${layers.length} open)`);
          } else if (roll < 0.4 && layers.length > 0) {
            // its own button
            await page.touch("click");
            touchedEver = true;
            const entry = layers[layers.length - 1]!;
            entry.handle.leave();
            layers.pop();
            log.push(`button closes the top (${layers.length} open)`);
          } else if (roll < 0.55) {
            await page.touch(random() < 0.5 ? "pointerup" : "click");
            touchedEver = true;
            log.push("touch");
          } else if (roll < 0.6) {
            await page.fire("pointerdown");
            log.push("finger down");
          } else if (roll < 0.68) {
            page.advance(back.ASK_MS + 1);
            await page.settle();
            log.push("wait");
          } else {
            const before = { touched: touchedEver, layers: layers.length, asking: back.hintNow() !== null };
            const quick = random() < 0.15;
            await page.press();
            if (quick && !page.left()) await page.press();
            log.push(`${quick ? "BACK x2" : "BACK"} (touched ${before.touched}, ${before.layers} open, question ${before.asking ? "up" : "not up"})`);
            if (page.left()) {
              if (before.touched && !quick && !(before.layers === 0 && before.asking)) failures.push(`seed ${seed}: left the site\n   ${log.join("\n   ")}`);
              break;
            }
          }
          await page.settle();
          page.advance(200);
          await page.settle();
          if (touchedEver && !log[log.length - 1]!.startsWith("BACK") && !log[log.length - 1]!.startsWith("wait") && !/^(open|finger)/.test(log[log.length - 1]!)) {
            // after a touch the history holds the guard and one entry for each layer
            const standing = page.entries[page.depth()] as { at?: number } | null;
            if (standing?.at !== layers.length + 1) failures.push(`seed ${seed}: history out of order after a touch (stands at ${standing?.at}, ${layers.length} layers open)\n   ${log.join("\n   ")}`);
          }
        }
      } finally {
        left.splice(0).forEach((leave) => leave());
        await page.settle();
        vi.restoreAllMocks();
      }
      if (failures.length >= 3) break;
    }
    expect(failures.slice(0, 3).join("\n\n")).toBe("");
  });
});
