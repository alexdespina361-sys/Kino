import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLayer } from "./backButton";

/** Just enough of a browser's history: entries, a position, and a `popstate` that comes after a Back (as it does, a moment later). */
function browser() {
  const entries: unknown[] = [null];
  let at = 0;
  let listener: ((event: { state: unknown }) => void) | null = null;
  const timers: (() => void)[] = [];
  const window = {
    history: {
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
          if (target < 0 || target >= entries.length) return;
          at = target;
          listener?.({ state: entries[at] });
        });
      },
      back: () => window.history.go(-1),
    },
    addEventListener: (_type: string, fn: typeof listener) => void (listener = fn),
    removeEventListener: (_type: string, fn: typeof listener) => void (listener === fn && (listener = null)),
    setTimeout: (fn: () => void) => timers.push(fn),
  };
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  return {
    window,
    /** The person's Back button. */
    async press() {
      window.history.back();
      await settle();
    },
    settle,
    depth: () => at,
    listening: () => listener !== null,
    runTimers: () => timers.splice(0).forEach((run) => run()),
  };
}

let page: ReturnType<typeof browser>;
const left: (() => void)[] = [];

/** A layer, as a component that opened it would hold it. */
function open(close: () => void = () => undefined) {
  const layer = openLayer(close);
  left.push(layer.leave);
  return layer;
}

beforeEach(() => {
  page = browser();
  vi.stubGlobal("window", page.window);
});
afterEach(async () => {
  left.splice(0).forEach((leave) => leave());
  await page.settle(); // (the entries of those come off a moment later, and need the window to do it)
  vi.unstubAllGlobals();
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
    page.runTimers();
    expect(page.depth()).toBe(1);
  });

  it("does not put the entry back for a layer that has gone", async () => {
    const layer = open();
    await page.press();
    layer.leave();
    page.runTimers();
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
