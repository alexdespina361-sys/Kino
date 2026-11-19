import { describe, expect, it } from "vitest";
import { chooseRole, chooseTier, isDesk, isHandHeld, isPhone, nextSlowness, QUICK_START_MS, readSlowness, SLOW_FOR_MS, SLOW_START_MS, type RoleInput, type TierInput } from "./role";

const desktop = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const tizen = "Mozilla/5.0 (SMART-TV; LINUX; Tizen 7.0) AppleWebKit/537.36 (KHTML, like Gecko) 94.0.4606.31/7.0 TV Safari/537.36";
const tierOf = (input: Partial<TierInput>) => chooseTier({ asked: null, pinned: undefined, slow: false, userAgent: desktop, cores: 8, memoryGb: 8, ...input });

describe("chooseTier", () => {
  it("gives a strong desktop the full page", () => {
    expect(tierOf({})).toBe("full");
    expect(tierOf({ cores: undefined, memoryGb: undefined })).toBe("full");
  });
  it("gives TVs, few cores, little memory and a slow start the light page", () => {
    expect(tierOf({ userAgent: tizen })).toBe("lite");
    expect(tierOf({ cores: 2 })).toBe("lite");
    expect(tierOf({ memoryGb: 2 })).toBe("lite");
    expect(tierOf({ slow: true })).toBe("lite");
    expect(tierOf({ cores: 4, memoryGb: 4 })).toBe("full");
  });
  it("lets the address or a kept choice win both ways", () => {
    expect(tierOf({ userAgent: tizen, asked: "full" })).toBe("full");
    expect(tierOf({ asked: "lite" })).toBe("lite");
    expect(tierOf({ userAgent: tizen, pinned: "full" })).toBe("full");
    expect(tierOf({ pinned: "full", asked: "lite" })).toBe("lite");
    expect(tierOf({ userAgent: tizen, asked: "junk", pinned: "junk" })).toBe("lite");
  });
});

describe("nextSlowness", () => {
  const none = { strikes: 0, until: 0 };
  const middle = (SLOW_START_MS + QUICK_START_MS) / 2;
  it("needs two slow starts before it turns the light page on, then keeps it for a week", () => {
    const once = nextSlowness(SLOW_START_MS, none, 1000);
    expect(once).toEqual({ strikes: 1, until: 0 });
    expect(nextSlowness(SLOW_START_MS, once, 2000)).toEqual({ strikes: 0, until: 2000 + SLOW_FOR_MS });
  });
  it("forgets the strikes on a quick start and keeps them on an in-between one", () => {
    const once = nextSlowness(SLOW_START_MS, none, 1000);
    expect(nextSlowness(middle, once, 2000)).toBe(once);
    expect(nextSlowness(QUICK_START_MS, once, 2000)).toEqual(none);
    expect(nextSlowness(QUICK_START_MS, { strikes: 0, until: 9e12 }, 2000)).toEqual(none);
  });
  it("reads a kept value, an old flag or junk without throwing", () => {
    expect(readSlowness(JSON.stringify({ strikes: 1, until: 5 }))).toEqual({ strikes: 1, until: 5 });
    expect(readSlowness("1")).toEqual(none);
    expect(readSlowness("{bad")).toEqual(none);
    expect(readSlowness(undefined)).toEqual(none);
    expect(readSlowness(JSON.stringify({ strikes: "x" }))).toEqual(none);
  });
});

const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const PIXEL = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36";
const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const FIRE_TV = "Mozilla/5.0 (Linux; Android 9; AFTMM Build/PS7233; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/110.0 Mobile Safari/537.36";
const FIRE_TABLET = "Mozilla/5.0 (Linux; Android 11; KFTRWI) AppleWebKit/537.36 (KHTML, like Gecko) Silk/120.0 like Chrome/120.0 Safari/537.36";
const TIZEN = "Mozilla/5.0 (SMART-TV; Linux; Tizen 7.0) AppleWebKit/537.36 (KHTML, like Gecko) 94.0.4606.31/7.0 TV Safari/537.36";
const WEBOS = "Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0 Safari/537.36 WebAppManager";
const ANDROID_TV = "Mozilla/5.0 (Linux; Android 10; BRAVIA 4K UR3 Build/QTG3.200305.006.S1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const VIDAA = "Mozilla/5.0 (Linux; U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0 Safari/537.36 VIDAA/6.0";

const page = (changes: Partial<RoleInput>): RoleInput => ({
  pathname: "/",
  search: "",
  storedRole: undefined,
  userAgent: DESKTOP,
  touchPoints: 0,
  remoteBefore: false,
  ...changes,
});

describe("chooseRole", () => {
  it("makes a screen without touch the TV, and a touch screen that comes for the first time a screen too: it opens on the library", () => {
    expect(chooseRole(page({}))).toBe("tv");
    expect(chooseRole(page({ userAgent: IPHONE, touchPoints: 5 }))).toBe("tv");
    expect(chooseRole(page({ userAgent: IPAD, touchPoints: 5 }))).toBe("tv");
    expect(chooseRole(page({ userAgent: FIRE_TABLET, touchPoints: 10 }))).toBe("tv");
  });

  it("keeps a touch screen that has been the remote here before the remote: it may be somebody's, paired with their TV", () => {
    expect(chooseRole(page({ userAgent: IPHONE, touchPoints: 5, remoteBefore: true }))).toBe("remote");
    expect(chooseRole(page({ userAgent: IPAD, touchPoints: 5, remoteBefore: true }))).toBe("remote");
    expect(chooseRole(page({ userAgent: PIXEL, touchPoints: 5, remoteBefore: true, storedRole: "tv" }))).toBe("tv");
    expect(chooseRole(page({ remoteBefore: true }))).toBe("tv");
    expect(chooseRole(page({ userAgent: FIRE_TV, touchPoints: 1, remoteBefore: true }))).toBe("tv");
  });

  it.each([
    ["Fire TV", FIRE_TV],
    ["Tizen", TIZEN],
    ["webOS", WEBOS],
    ["a Hisense set (VIDAA)", VIDAA],
    ["an Android TV set", ANDROID_TV],
  ])("recognises a TV browser by its user agent: %s", (_name, userAgent) => {
    expect(chooseRole(page({ userAgent }))).toBe("tv");
    expect(chooseRole(page({ userAgent, touchPoints: 1 }))).toBe("tv");
  });

  it("always plays on /tv, with or without a trailing slash", () => {
    expect(chooseRole(page({ pathname: "/tv", userAgent: IPHONE, touchPoints: 5 }))).toBe("tv");
    expect(chooseRole(page({ pathname: "/tv/", storedRole: "remote" }))).toBe("tv");
  });

  it("follows an address that asks for a role", () => {
    expect(chooseRole(page({ search: "?role=remote" }))).toBe("remote");
    expect(chooseRole(page({ search: "?role=tv", userAgent: IPHONE, touchPoints: 5 }))).toBe("tv");
    expect(chooseRole(page({ search: "?role=banana" }))).toBe("tv");
  });

  it("plays a title's link, wherever it is opened: it opens that title's page on a screen that plays", () => {
    expect(chooseRole(page({ search: "?title=movie-603", userAgent: IPHONE, touchPoints: 5 }))).toBe("tv");
    expect(chooseRole(page({ search: "?title=movie-603", storedRole: "remote" }))).toBe("tv");
    expect(chooseRole(page({ search: "?title=movie-603&role=remote" }))).toBe("remote");
  });

  it("plays a watch party's link, wherever it is opened", () => {
    expect(chooseRole(page({ search: "?party=123456", userAgent: IPHONE, touchPoints: 5 }))).toBe("tv");
    expect(chooseRole(page({ search: "?party=123456", storedRole: "remote" }))).toBe("tv");
    expect(chooseRole(page({ search: "?party=123456&role=remote" }))).toBe("remote");
  });

  it("treats the links made for the phone as the remote, wherever they are opened", () => {
    expect(chooseRole(page({ search: "?code=123456" }))).toBe("remote");
    expect(chooseRole(page({ search: "?url=https%3A%2F%2Fsite.example%2Fwatch" }))).toBe("remote");
    expect(chooseRole(page({ search: "?text=look+at+this", storedRole: "tv" }))).toBe("remote");
    expect(chooseRole(page({ search: "?link=ABCD2345", storedRole: "tv" }))).toBe("remote");
    expect(chooseRole(page({ search: "?friend=ABCD2345", touchPoints: 0 }))).toBe("remote");
  });

  it("remembers what the switch chose, over the guess", () => {
    expect(chooseRole(page({ storedRole: "remote" }))).toBe("remote");
    expect(chooseRole(page({ storedRole: "tv", userAgent: IPHONE, touchPoints: 5 }))).toBe("tv");
    expect(chooseRole(page({ storedRole: "nonsense" }))).toBe("tv");
  });
});

describe("isPhone", () => {
  it("is a phone: touch is how it is used, and the screen is small, held either way up", () => {
    expect(isPhone({ userAgent: IPHONE, touchPoints: 5, coarsePointer: true, shortSide: 390 })).toBe(true);
    expect(isPhone({ userAgent: PIXEL, touchPoints: 5, coarsePointer: true, shortSide: 412 })).toBe(true);
  });

  it("is not a tablet, which can be somebody's screen with a phone to control it", () => {
    expect(isPhone({ userAgent: IPAD, touchPoints: 5, coarsePointer: true, shortSide: 820 })).toBe(false);
    expect(isPhone({ userAgent: FIRE_TABLET, touchPoints: 10, coarsePointer: true, shortSide: 800 })).toBe(false);
  });

  it("is not a computer, even one with a touch screen beside its mouse or pad", () => {
    expect(isPhone({ userAgent: DESKTOP, touchPoints: 0, coarsePointer: false, shortSide: 1080 })).toBe(false);
    expect(isPhone({ userAgent: DESKTOP, touchPoints: 10, coarsePointer: false, shortSide: 360 })).toBe(false);
  });

  it("is not a TV, whatever it claims about touch", () => {
    for (const userAgent of [FIRE_TV, TIZEN, WEBOS, VIDAA, ANDROID_TV]) expect(isPhone({ userAgent, touchPoints: 1, coarsePointer: true, shortSide: 360 })).toBe(false);
  });
});

describe("isHandHeld", () => {
  it("is a phone or a tablet: the system's Back is what they have", () => {
    expect(isHandHeld({ userAgent: PIXEL, touchPoints: 5, coarsePointer: true })).toBe(true);
    expect(isHandHeld({ userAgent: IPAD, touchPoints: 5, coarsePointer: true })).toBe(true);
    expect(isHandHeld({ userAgent: FIRE_TABLET, touchPoints: 10, coarsePointer: true })).toBe(true);
  });

  it("is not a computer, with or without a touch screen, nor a TV, whatever it says about touch (their Back is a key the page hears)", () => {
    expect(isHandHeld({ userAgent: DESKTOP, touchPoints: 0, coarsePointer: false })).toBe(false);
    expect(isHandHeld({ userAgent: DESKTOP, touchPoints: 10, coarsePointer: false })).toBe(false);
    expect(isHandHeld({ userAgent: DESKTOP, touchPoints: 0, coarsePointer: true })).toBe(false);
    for (const userAgent of [FIRE_TV, TIZEN, WEBOS, VIDAA, ANDROID_TV]) expect(isHandHeld({ userAgent, touchPoints: 1, coarsePointer: true })).toBe(false);
  });
});

describe("isDesk", () => {
  it("is a laptop or a PC with a mouse or a pad, whose big-screen page stops growing with the window", () => {
    expect(isDesk({ userAgent: DESKTOP, finePointer: true })).toBe(true);
    expect(isDesk({ userAgent: IPAD, finePointer: true })).toBe(true);
  });

  it("is not a TV, a TV box with a mouse, a phone or a tablet", () => {
    for (const userAgent of [TIZEN, WEBOS, FIRE_TV, ANDROID_TV]) expect(isDesk({ userAgent, finePointer: true })).toBe(false);
    for (const userAgent of [PIXEL, IPHONE, FIRE_TABLET]) expect(isDesk({ userAgent, finePointer: true })).toBe(false);
    expect(isDesk({ userAgent: DESKTOP, finePointer: false })).toBe(false);
    expect(isDesk({ userAgent: IPAD, finePointer: false })).toBe(false);
  });
});
