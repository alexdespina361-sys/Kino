import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetRelease, HELD_MAX_MS, loadRelease, mayComeIn, megabytes, STRIP_QUIET_MS, wantsTheApp } from "./GetTheApp";

const PIXEL = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID_TV = "Mozilla/5.0 (Linux; Android 12; BRAVIA 4K VH2 Build/STT1.211025.001) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const FIRE_TV = "Mozilla/5.0 (Linux; Android 9; AFTMM Build/PS7633) AppleWebKit/537.36 (KHTML, like Gecko) Silk/120.1.1 like Chrome/120.0.0.0 Safari/537.36";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

describe("whether the Android app is offered", () => {
  it("is offered on an Android phone's browser", () => {
    expect(wantsTheApp({ userAgent: PIXEL, handHeld: true, inApp: false })).toBe(true);
  });

  it("is not offered in the app itself, on an iPhone, on a TV that says Android, nor on a computer", () => {
    expect(wantsTheApp({ userAgent: PIXEL, handHeld: true, inApp: true })).toBe(false);
    expect(wantsTheApp({ userAgent: IPHONE, handHeld: true, inApp: false })).toBe(false);
    expect(wantsTheApp({ userAgent: ANDROID_TV, handHeld: false, inApp: false })).toBe(false);
    expect(wantsTheApp({ userAgent: ANDROID_TV, handHeld: true, inApp: false })).toBe(false); // (a TV with a touch remote is still a TV)
    expect(wantsTheApp({ userAgent: FIRE_TV, handHeld: true, inApp: false })).toBe(false);
    expect(wantsTheApp({ userAgent: WINDOWS, handHeld: false, inApp: false })).toBe(false);
    expect(wantsTheApp({ userAgent: PIXEL, handHeld: false, inApp: false })).toBe(false); // (an Android box with a mouse)
  });

  it("is not offered in the app before its bridge is there (its user agent says so), nor in another app's window onto the web", () => {
    expect(wantsTheApp({ userAgent: `${PIXEL} KinoApp/0.2.0`, handHeld: true, inApp: false })).toBe(false);
    expect(wantsTheApp({ userAgent: PIXEL.replace("Pixel 8)", "Pixel 8; wv)"), handHeld: true, inApp: false })).toBe(false);
  });
});

describe("when the line comes in", () => {
  const atFirst = { now: 10_000, firstDrawing: true, lastTouched: 0, drawnAt: 10_000, heldSince: 0, busy: false };
  const later = { ...atFirst, firstDrawing: false, drawnAt: 1_000 };

  it("comes with the page's first drawing when the release is known by then and nothing was touched", () => {
    expect(mayComeIn(atFirst)).toBe(true);
  });

  it("does not come in late over a page already on the screen, but only once the page has been left alone for a moment (the judge, 17 Nov)", () => {
    expect(mayComeIn({ ...atFirst, firstDrawing: false })).toBe(false);
    expect(mayComeIn({ ...later, drawnAt: later.now - STRIP_QUIET_MS + 1 })).toBe(false);
    expect(mayComeIn({ ...later, drawnAt: later.now - STRIP_QUIET_MS })).toBe(true);
  });

  it("waits while a finger is down, while the page was touched lately, and while something it must not come under is up", () => {
    expect(mayComeIn({ ...atFirst, heldSince: 9_000 })).toBe(false);
    expect(mayComeIn({ ...later, heldSince: 9_000 })).toBe(false);
    expect(mayComeIn({ ...atFirst, lastTouched: 9_500 })).toBe(false);
    expect(mayComeIn({ ...later, lastTouched: later.now - STRIP_QUIET_MS + 1 })).toBe(false);
    expect(mayComeIn({ ...atFirst, busy: true })).toBe(false);
    expect(mayComeIn({ ...later, lastTouched: later.now - STRIP_QUIET_MS })).toBe(true);
  });

  it("does not wait for good on a finger whose lifting was never heard", () => {
    expect(mayComeIn({ ...later, lastTouched: later.now - HELD_MAX_MS, heldSince: later.now - HELD_MAX_MS })).toBe(true);
  });
});

describe("the newest release, as the site says it", () => {
  afterEach(() => forgetRelease());
  const answering = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

  it("is its version and size, asked once a page, without the account's cookies", async () => {
    const fetcher = answering(200, { versionCode: 2, versionName: "0.2.0", size: 3_141_676, sha256: "a".repeat(64), url: "/app/android/kino-2.apk" });
    expect(await loadRelease(fetcher)).toEqual({ versionName: "0.2.0", size: 3_141_676 });
    expect(await loadRelease(fetcher)).toEqual({ versionName: "0.2.0", size: 3_141_676 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("/api/app/android", expect.objectContaining({ credentials: "omit", cache: "no-store" }));
  });

  it("is nothing while the site keeps no app, or says something that is not one", async () => {
    expect(await loadRelease(answering(404, { error: "not_found" }))).toBeNull();
    forgetRelease();
    expect(await loadRelease(answering(200, { versionName: "", size: 10 }))).toBeNull();
    forgetRelease();
    expect(await loadRelease(answering(200, { versionName: "0.2.0", size: 0 }))).toBeNull();
    forgetRelease();
    expect(await loadRelease(answering(200, null))).toBeNull();
    forgetRelease();
    expect(await loadRelease(answering(200, { versionName: "x".repeat(200), size: 5 }))).toEqual({ versionName: "x".repeat(32), size: 5 });
  });

  it("is asked again after the network failed", async () => {
    const failing = vi.fn(async () => {
      throw new TypeError("offline");
    });
    expect(await loadRelease(failing)).toBeNull();
    const fetcher = answering(200, { versionName: "0.2.0", size: 1 });
    expect(await loadRelease(fetcher)).toEqual({ versionName: "0.2.0", size: 1 });
  });
});

describe("the size", () => {
  it("is in whole megabytes, never none, with the unit on the same line", () => {
    expect(megabytes(3_141_676)).toBe("3 MB");
    expect(megabytes(12_600_000)).toBe("13 MB");
    expect(megabytes(20_000)).toBe("1 MB");
  });
});
