import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteAfterGoogle, googleStartUrl, takeGoogleOutcome } from "./google";

/** A page at `address`, with the history and the tab's storage a browser gives it (what the code changes is kept, to be looked at). */
function page(address: string, storage: Map<string, string> | null = new Map()) {
  const at = { href: new URL(address, "https://kino.test").href };
  const replaced: string[] = [];
  vi.stubGlobal("location", {
    get href() {
      return at.href;
    },
  });
  vi.stubGlobal("history", {
    state: { page: 1 },
    replaceState(_state: unknown, _title: string, url: string) {
      replaced.push(url);
      at.href = new URL(url, at.href).href;
    },
  });
  vi.stubGlobal(
    "sessionStorage",
    storage
      ? { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => void storage.set(key, value), removeItem: (key: string) => void storage.delete(key) }
      : {
          getItem: () => {
            throw new Error("no storage");
          },
          setItem: () => {
            throw new Error("no storage");
          },
          removeItem: () => {
            throw new Error("no storage");
          },
        },
  );
  return { replaced, address: () => at.href };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("googleStartUrl", () => {
  it("goes to the server's start for this screen, back to the TV's page from the TV's and to the phone's from anywhere else", () => {
    expect(googleStartUrl("remote", "signin", "/")).toBe("/api/auth/google/start?device=remote&next=%2F");
    expect(googleStartUrl("tv", "signin", "/tv")).toBe("/api/auth/google/start?device=tv&next=%2Ftv");
    expect(googleStartUrl("tv", "signin", "/tv/")).toBe("/api/auth/google/start?device=tv&next=%2Ftv");
    expect(googleStartUrl("tv", "signin", "/")).toBe("/api/auth/google/start?device=tv&next=%2F");
    expect(googleStartUrl("remote", "signin", "/tvx")).toBe("/api/auth/google/start?device=remote&next=%2F");
    expect(googleStartUrl("remote", "signin", "//elsewhere.test/tv")).toBe("/api/auth/google/start?device=remote&next=%2F");
  });

  it("connects Google with mode=link, and confirms who is here before deleting with mode=reauth", () => {
    expect(googleStartUrl("remote", "link", "/")).toBe("/api/auth/google/start?device=remote&next=%2F&mode=link");
    expect(googleStartUrl("remote", "delete", "/")).toBe("/api/auth/google/start?device=remote&next=%2F&mode=reauth");
  });
});

describe("takeGoogleOutcome", () => {
  it("takes the word the server sent the browser back with out of the address, and keeps the rest of it", () => {
    const { replaced, address } = page("/tv?google=denied&role=tv#top");
    expect(takeGoogleOutcome()).toBe("denied");
    expect(replaced).toEqual(["/tv?role=tv#top"]);
    expect(address()).toBe("https://kino.test/tv?role=tv#top");
    expect(takeGoogleOutcome()).toBeNull(); // (a reload says nothing again)
  });

  it("knows every word the server says", () => {
    for (const word of ["denied", "failed", "closed", "busy", "taken", "unavailable", "linked", "reauth"]) {
      page(`/?google=${word}`);
      expect(takeGoogleOutcome()).toBe(word);
    }
  });

  it("takes a word nobody knows out of the address too, and it is nothing", () => {
    const { replaced } = page("/?google=%3Cscript%3E");
    expect(takeGoogleOutcome()).toBeNull();
    expect(replaced).toEqual(["/"]);
  });

  it("leaves an address without one alone", () => {
    const { replaced } = page("/?role=remote");
    expect(takeGoogleOutcome()).toBeNull();
    expect(replaced).toEqual([]);
  });
});

describe("deleteAfterGoogle", () => {
  it("is asked for once: the next time the page comes back, and not after", () => {
    page("/");
    expect(deleteAfterGoogle.take()).toBe(false);
    deleteAfterGoogle.ask();
    expect(deleteAfterGoogle.take()).toBe(true);
    expect(deleteAfterGoogle.take()).toBe(false);
  });

  it("is forgotten after ten minutes", () => {
    vi.useFakeTimers({ now: new Date("2026-11-05T10:00:00Z") });
    page("/");
    deleteAfterGoogle.ask();
    vi.setSystemTime(new Date("2026-11-05T10:09:59Z"));
    expect(deleteAfterGoogle.take()).toBe(true);
    deleteAfterGoogle.ask();
    vi.setSystemTime(new Date("2026-11-05T10:20:00Z"));
    expect(deleteAfterGoogle.take()).toBe(false);
  });

  it("is never asked for in a browser that keeps nothing", () => {
    page("/", null);
    deleteAfterGoogle.ask();
    expect(deleteAfterGoogle.take()).toBe(false);
  });
});
