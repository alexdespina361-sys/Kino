import { describe, expect, it } from "vitest";
import { chooseRole, type RoleInput } from "./role";

const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const FIRE_TV = "Mozilla/5.0 (Linux; Android 9; AFTMM Build/PS7233; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/110.0 Mobile Safari/537.36";
const FIRE_TABLET = "Mozilla/5.0 (Linux; Android 11; KFTRWI) AppleWebKit/537.36 (KHTML, like Gecko) Silk/120.0 like Chrome/120.0 Safari/537.36";
const TIZEN = "Mozilla/5.0 (SMART-TV; Linux; Tizen 7.0) AppleWebKit/537.36 (KHTML, like Gecko) 94.0.4606.31/7.0 TV Safari/537.36";
const WEBOS = "Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0 Safari/537.36 WebAppManager";
const ANDROID_TV = "Mozilla/5.0 (Linux; Android 10; BRAVIA 4K UR3 Build/QTG3.200305.006.S1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const page = (changes: Partial<RoleInput>): RoleInput => ({
  pathname: "/",
  search: "",
  storedRole: undefined,
  userAgent: DESKTOP,
  touchPoints: 0,
  ...changes,
});

describe("chooseRole", () => {
  it("makes a screen without touch the TV, and a touch screen the remote", () => {
    expect(chooseRole(page({}))).toBe("tv"); // a desktop or a monitor
    expect(chooseRole(page({ userAgent: IPHONE, touchPoints: 5 }))).toBe("remote");
    expect(chooseRole(page({ userAgent: IPAD, touchPoints: 5 }))).toBe("remote"); // a tablet is a remote too
    expect(chooseRole(page({ userAgent: FIRE_TABLET, touchPoints: 10 }))).toBe("remote");
  });

  it.each([
    ["Fire TV", FIRE_TV],
    ["Tizen", TIZEN],
    ["webOS", WEBOS],
    ["an Android TV set", ANDROID_TV],
  ])("recognises a TV browser by its user agent: %s", (_name, userAgent) => {
    expect(chooseRole(page({ userAgent }))).toBe("tv");
    expect(chooseRole(page({ userAgent, touchPoints: 1 }))).toBe("tv"); // even when it claims a touch point
  });

  it("always plays on /tv, with or without a trailing slash", () => {
    expect(chooseRole(page({ pathname: "/tv", userAgent: IPHONE, touchPoints: 5 }))).toBe("tv");
    expect(chooseRole(page({ pathname: "/tv/", storedRole: "remote" }))).toBe("tv");
  });

  it("follows an address that asks for a role", () => {
    expect(chooseRole(page({ search: "?role=remote" }))).toBe("remote");
    expect(chooseRole(page({ search: "?role=tv", userAgent: IPHONE, touchPoints: 5 }))).toBe("tv");
    expect(chooseRole(page({ search: "?role=banana" }))).toBe("tv"); // not a role: the guess decides
  });

  it("plays a watch party's link, wherever it is opened", () => {
    expect(chooseRole(page({ search: "?party=123456", userAgent: IPHONE, touchPoints: 5 }))).toBe("tv");
    expect(chooseRole(page({ search: "?party=123456", storedRole: "remote" }))).toBe("tv");
    expect(chooseRole(page({ search: "?party=123456&role=remote" }))).toBe("remote"); // an explicit role still wins
  });

  it("treats the links made for the phone as the remote, wherever they are opened", () => {
    expect(chooseRole(page({ search: "?code=123456" }))).toBe("remote");
    expect(chooseRole(page({ search: "?url=https%3A%2F%2Fsite.example%2Fwatch" }))).toBe("remote");
    expect(chooseRole(page({ search: "?text=look+at+this", storedRole: "tv" }))).toBe("remote");
    // the code on a TV's sign-in screen is meant for a phone, even one that was last used as a TV
    expect(chooseRole(page({ search: "?link=ABCD2345", storedRole: "tv" }))).toBe("remote");
  });

  it("remembers what the switch chose, over the guess", () => {
    expect(chooseRole(page({ storedRole: "remote" }))).toBe("remote");
    expect(chooseRole(page({ storedRole: "tv", userAgent: IPHONE, touchPoints: 5 }))).toBe("tv");
    expect(chooseRole(page({ storedRole: "nonsense" }))).toBe("tv");
  });
});
