import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Back = typeof import("./backButton");
let back: Back;

/**
 * Just enough of a browser: the history (entries, a position, and a `popstate` that comes after a Back, as it does, a moment later), the
 * events a page listens to, a clock the test moves, and whether the person has used the page yet.
 */
function browser(start: unknown[] = [null], at = 0) {
  const entries: unknown[] = [...start];
  const listeners = new Map<string, Set<(event: Record<string, unknown>) => void>>();
  const timers = new Map<number, { at: number; run: () => void }>();
  let now = 0;
  let next = 0;
  let activated = false;
  const window = {
    history: {
      get state() {
        return entries[at];
      },
      pushState: (state: unknown) => {
        entries.splice(at + 1);
        entries.push(state);
        at += 1;
      },
      replaceState: (state: unknown) => void (entries[at] = state),
      // It goes where the history stood when it was asked: a push that follows in the same moment does not change where (as in a real
      // browser, where this is how a Back and a push in one render ended with the new layer closed by the Back).
      go: (delta: number) => {
        const target = at + delta;
        queueMicrotask(() => {
          if (target < 0 || target >= entries.length) return; // (past the first entry the browser leaves the page: nothing is said to it)
          at = target;
          listeners.get("popstate")?.forEach((listener) => listener({ type: "popstate", state: entries[at] }));
        });
      },
      back: () => window.history.go(-1),
    },
    navigator: {
      get userActivation() {
        return { hasBeenActive: activated };
      },
    },
    addEventListener: (type: string, fn: (event: Record<string, unknown>) => void) => void (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn),
    removeEventListener: (type: string, fn: (event: Record<string, unknown>) => void) => void listeners.get(type)?.delete(fn),
    setTimeout: (run: () => void, ms = 0) => {
      next += 1;
      timers.set(next, { at: now + ms, run });
      return next;
    },
    clearTimeout: (id: number | undefined) => void (id !== undefined && timers.delete(id)),
  };
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  return {
    window,
    entries,
    /** The person's Back button. */
    async press() {
      window.history.back();
      await settle();
    },
    /** The person's thumb on the page (the browser counts it from now on). */
    async touch(type = "pointerup") {
      activated = true;
      listeners.get(type)?.forEach((listener) => listener({ type }));
      await settle();
    },
    /** An event the browser does not count as the person using the page (a finger that only went down). */
    async fire(type: string, extra: Record<string, unknown> = {}) {
      listeners.get(type)?.forEach((listener) => listener({ type, ...extra }));
      await settle();
    },
    settle,
    depth: () => at,
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

beforeEach(async () => {
  vi.resetModules();
  back = await import("./backButton");
  page = browser();
  vi.stubGlobal("window", page.window);
  vi.spyOn(Date, "now").mockImplementation(() => page.now());
});
afterEach(async () => {
  left.splice(0).forEach((leave) => leave());
  await page.settle(); // (the entries of those come off a moment later, and need the window to do it)
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the Back button", () => {
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

  it("gives a layer that stays (a page that only steps back to the one before) its entry again", async () => {
    const stepBack = vi.fn();
    const layer = open(stepBack);
    await page.press();
    expect(stepBack).toHaveBeenCalledTimes(1);
    expect(page.depth()).toBe(0);

    layer.stayed(); // it drew again, still there
    expect(page.depth()).toBe(1);
    await page.press();
    expect(stepBack).toHaveBeenCalledTimes(2);
  });

  it("does the same for a layer that did not draw at all", async () => {
    open();
    await page.press();
    page.advance(150);
    expect(page.depth()).toBe(1);
  });

  it("does not put the entry back for a layer that has gone", async () => {
    const layer = open();
    await page.press();
    layer.leave();
    page.advance(150);
    layer.stayed();
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
});

describe("the bottom of the site", () => {
  it("is left alone until the page has been touched: the browser passes over an entry a page makes by itself, and nothing is lost yet", async () => {
    back.installExitGuard();
    expect(page.entries).toHaveLength(1);
    await page.press(); // (past the first entry: the browser leaves)
    expect(back.hintNow()).toBeNull();
    expect(page.depth()).toBe(0);
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

    await page.press(); // the answer: nothing here puts the guard in its way
    expect(page.depth()).toBe(0);
    expect(page.entries).toHaveLength(2);
  });

  it("puts the guard back when nobody answers, so the next Back is a first one again", async () => {
    await started();
    await page.press();
    page.advance(back.ASK_MS - 1);
    expect(back.hintNow()).not.toBeNull();
    expect(page.depth()).toBe(0);
    page.advance(1);
    expect(back.hintNow()).toBeNull();
    expect(page.depth()).toBe(1);
    expect(page.entries).toHaveLength(2); // (in the place of the one it took off: no pile of them)
  });

  it("puts it back at once at the first touch: a Back after that is a first one, not the answer to an old question", async () => {
    await started();
    await page.press();
    await page.touch("pointerdown");
    expect(back.hintNow()).toBeNull();
    expect(page.depth()).toBe(1);
    await page.press();
    expect(back.hintNow()).not.toBeNull(); // asked again, not left
  });

  it("brings the guard back under a layer that opens while the question is up", async () => {
    await started();
    await page.press();
    const sheet = vi.fn();
    open(sheet);
    expect(back.hintNow()).toBeNull();
    expect(page.entries).toHaveLength(3); // the page, the guard, the layer
    await page.press();
    expect(sheet).toHaveBeenCalledTimes(1);
    expect(page.depth()).toBe(1);
  });

  it("waits for layers that were open before the first touch to be gone", async () => {
    back.installExitGuard();
    const sheet = open();
    await page.touch();
    expect(page.entries).toHaveLength(2); // (the layer's entry: the guard would have stood above it)
    await page.press();
    sheet.leave();
    page.advance(150);
    await page.settle();
    expect(page.entries).toHaveLength(2); // the page, and the guard that came once the layer had gone
    expect(page.depth()).toBe(1);
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

  it("does not put the guard on while the entry of a layer that closed is still on its way out", async () => {
    back.installExitGuard();
    open().leave(); // closed by its own button, before anything was touched: its entry goes a moment later ...
    await page.touch(); // ... and the first touch comes in that moment
    expect(page.entries).toHaveLength(2); // the page, and the guard after the entry had gone (not the layer's entry with the guard over it)
    expect(page.depth()).toBe(1);
    expect(back.hintNow()).toBeNull();
  });

  it("does not put the guard on while the history is going back, nor take the Back for a person's", async () => {
    back.installExitGuard();
    open().leave();
    await Promise.resolve(); // (the entry has been asked to go: the history has not said that it has)
    await page.touch();
    expect(back.hintNow()).toBeNull(); // (a Back that nobody pressed is no question at the bottom)
    expect(page.entries).toHaveLength(2);
    expect(page.depth()).toBe(1);
  });

  it("makes the guard and the layers that are open again when a Back went past both", async () => {
    await started();
    const sheet = vi.fn();
    open(sheet);
    page.window.history.go(-2); // two Backs in a row, before the page drew
    await page.settle();
    expect(sheet).toHaveBeenCalledTimes(1);
    page.advance(150);
    expect(page.depth()).toBe(2);
    await page.press();
    expect(sheet).toHaveBeenCalledTimes(2);
    expect(page.depth()).toBe(1);
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
    const stop = vi.fn();
    const onBack = () => void (back.pressAgain("exit.stopParty") && stop());
    const layer = open(onBack);
    await page.press();
    layer.stayed(); // (the page drew again, and the layer is still on it)
    expect(stop).not.toHaveBeenCalled();
    expect(page.depth()).toBe(1);
    await page.press();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
