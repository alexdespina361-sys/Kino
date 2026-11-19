import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../role", () => ({ thisTier: () => "full" }));

type Later = typeof import("./later");
const fresh = async (): Promise<Later> => {
  vi.resetModules();
  return import("./later");
};

const videos: { paused: boolean; ended: boolean }[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  videos.length = 0;
  vi.stubGlobal("document", { visibilityState: "visible", querySelectorAll: () => videos, documentElement: {}, addEventListener: () => undefined });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a part of the TV that comes later", () => {
  it("asks for its code once when it comes, and again after a load that failed", async () => {
    const { later } = await fresh();
    const load = vi.fn().mockRejectedValueOnce(new Error("Failed to fetch dynamically imported module")).mockResolvedValue(() => null);
    const Part = later<{ onClose: () => void }>(load);
    await Part.preload();
    await Part.preload();
    await Part.preload();
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("loading the later parts while the TV is idle", () => {
  it("loads them one after another once the page has settled", async () => {
    const { warmLater } = await fresh();
    const order: string[] = [];
    const part = (name: string) => () => (order.push(name), Promise.resolve());
    warmLater([part("chat"), part("qr")]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(order).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(order).toEqual(["chat"]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(order).toEqual(["chat", "qr"]);
  });

  it("waits while a film plays, and goes on once it stops", async () => {
    const { warmLater } = await fresh();
    const loaded = vi.fn(() => Promise.resolve());
    videos.push({ paused: false, ended: false });
    warmLater([loaded]);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(loaded).not.toHaveBeenCalled();
    videos[0]!.paused = true;
    await vi.advanceTimersByTimeAsync(6000);
    expect(loaded).toHaveBeenCalledTimes(1);
  });

  it("starts once per page, and not at all on a device that asks to save data", async () => {
    const { warmLater } = await fresh();
    const first = vi.fn(() => Promise.resolve());
    const second = vi.fn(() => Promise.resolve());
    warmLater([first]);
    warmLater([second]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();

    const again = await fresh();
    vi.stubGlobal("navigator", { connection: { saveData: true } });
    const saved = vi.fn(() => Promise.resolve());
    again.warmLater([saved]);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(saved).not.toHaveBeenCalled();
  });
});
