import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cookieText, findCookie, readKept, writeKept } from "./kept";

describe("findCookie", () => {
  it("finds a cookie among others", () => {
    expect(findCookie("a=1; tv.deviceId=tv_abc; b=2", "tv.deviceId")).toBe("tv_abc");
    expect(findCookie("tv.deviceId=tv_abc", "tv.deviceId")).toBe("tv_abc");
  });

  it("is not fooled by a cookie that only ends or starts with the name", () => {
    expect(findCookie("my-tv.deviceId=x; tv.deviceId2=y", "tv.deviceId")).toBeUndefined();
  });

  it("reads an encoded value, and gives nothing for a broken one or none at all", () => {
    expect(findCookie("k=a%20b", "k")).toBe("a b");
    expect(findCookie("k=%E0%A4%A", "k")).toBeUndefined();
    expect(findCookie("", "k")).toBeUndefined();
  });
});

describe("cookieText", () => {
  it("keeps the value for a long time, for the whole site, and only over https on https", () => {
    expect(cookieText("controller.id", "ctl_1", false)).toBe("controller.id=ctl_1; Path=/; Max-Age=34560000; SameSite=Lax");
    expect(cookieText("controller.id", "ctl_1", true)).toMatch(/; Secure$/);
  });
});

/** A page's storage and cookies, the two places an id is kept. */
function browser() {
  const storage = new Map<string, string>();
  const jar = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  });
  vi.stubGlobal("location", { protocol: "https:" });
  vi.stubGlobal("document", {
    get cookie() {
      return [...jar].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; ");
    },
    set cookie(text: string) {
      const [pair = ""] = text.split(";");
      const at = pair.indexOf("=");
      jar.set(pair.slice(0, at), decodeURIComponent(pair.slice(at + 1)));
    },
  });
  return { storage, jar };
}

describe("readKept and writeKept", () => {
  let place: ReturnType<typeof browser>;
  beforeEach(() => {
    place = browser();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps an id in both places", () => {
    writeKept("tv.deviceId", "tv_1");
    expect(place.storage.get("tv.deviceId")).toBe("tv_1");
    expect(place.jar.get("tv.deviceId")).toBe("tv_1");
    expect(readKept("tv.deviceId")).toBe("tv_1");
  });

  it("finds the id in the cookie when the page's storage was wiped, and puts it back", () => {
    writeKept("tv.deviceId", "tv_1");
    place.storage.clear();
    expect(readKept("tv.deviceId")).toBe("tv_1");
    expect(place.storage.get("tv.deviceId")).toBe("tv_1");
  });

  it("finds the id in the page's storage when the cookie was wiped, and puts it back", () => {
    writeKept("controller.id", "ctl_1");
    place.jar.clear();
    expect(readKept("controller.id")).toBe("ctl_1");
    expect(place.jar.get("controller.id")).toBe("ctl_1");
  });

  it("trusts the page's storage when the two disagree, and makes the cookie agree", () => {
    place.storage.set("controller.id", "ctl_new");
    place.jar.set("controller.id", "ctl_old");
    expect(readKept("controller.id")).toBe("ctl_new");
    expect(place.jar.get("controller.id")).toBe("ctl_new");
  });

  it("has nothing for an id that was never kept", () => {
    expect(readKept("tv.deviceId")).toBeUndefined();
    expect(place.jar.size).toBe(0);
  });

  it("copes with a browser that has no storage and no cookies", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    });
    vi.stubGlobal("document", {
      get cookie(): string {
        throw new Error("denied");
      },
      set cookie(_text: string) {
        throw new Error("denied");
      },
    });
    expect(() => writeKept("tv.deviceId", "tv_1")).not.toThrow();
    expect(readKept("tv.deviceId")).toBeUndefined();
  });
});
