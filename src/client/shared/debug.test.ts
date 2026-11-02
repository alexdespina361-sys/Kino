import { describe, expect, it } from "vitest";
import { debugOn, describeElement, describeKey, describeServer } from "./debug";

describe("debugOn", () => {
  it("is off unless the address asks, or an earlier visit did", () => {
    expect(debugOn("", null)).toBe(false);
    expect(debugOn("?x=1", undefined)).toBe(false);
    expect(debugOn("", "1")).toBe(true);
    expect(debugOn("", "0")).toBe(false);
  });

  it("is turned on by ?debug, with or without a value, and off by ?debug=0", () => {
    expect(debugOn("?debug", null)).toBe(true);
    expect(debugOn("?debug=1", null)).toBe(true);
    expect(debugOn("?role=tv&debug", null)).toBe(true);
    expect(debugOn("?debug=0", "1")).toBe(false);
    expect(debugOn("?debug=off", "1")).toBe(false);
    expect(debugOn("?debug=FALSE", "1")).toBe(false);
  });
});

describe("describeServer", () => {
  it("says whether the server keeps things between restarts, and how long it has been up", () => {
    expect(describeServer({ ok: true, storage: "postgres", uptime: 41 })).toBe("server: storage postgres (kept)  up 41s");
    expect(describeServer({ ok: true, storage: "file", uptime: 125 })).toBe("server: storage file (lost when it sleeps or restarts)  up 2m");
    expect(describeServer({ ok: true, storage: "memory", uptime: 3 * 3600 + 5 * 60 + 9 })).toBe("server: storage memory (lost when it sleeps or restarts)  up 3h 5m");
    expect(describeServer({ ok: true, storage: "postgres", uptime: 2 * 86_400 + 4 * 3600 })).toBe("server: storage postgres (kept)  up 2d 4h");
  });

  it("says how many pieces of a film the proxy gave from memory and how many it fetched, when it says so", () => {
    expect(describeServer({ storage: "postgres", uptime: 41, segments: { hits: 120, misses: 40, keptMB: 33 } })).toBe(
      "server: storage postgres (kept)  up 41s  film pieces: 120 from memory, 40 fetched",
    );
    expect(describeServer({ storage: "postgres", uptime: 41, segments: { hits: "many" } })).toBe("server: storage postgres (kept)  up 41s");
  });

  it("makes no claim about what it was not told", () => {
    expect(describeServer({ ok: true })).toBe("server: storage unknown (?)  up ?");
    expect(describeServer(null)).toBe("server: storage unknown (?)  up ?");
    expect(describeServer("<html>")).toBe("server: storage unknown (?)  up ?");
    expect(describeServer({ storage: 3, uptime: -1 })).toBe("server: storage unknown (?)  up ?");
  });
});

describe("describeKey", () => {
  const element = (tagName: string, type?: string) => ({ tagName, ...(type ? { type } : {}), id: "", getAttribute: () => null }) as unknown as EventTarget;
  const press = (key: string, target: EventTarget | null, code = "KeyS", keyCode = 83) => ({ key, code, keyCode, target });

  it("writes the keys of a remote as they are, and a letter pressed where nothing is typed", () => {
    expect(describeKey("keydown", press("ArrowUp", element("BUTTON"), "ArrowUp", 38))).toBe("v ArrowUp ArrowUp #38 on button");
    expect(describeKey("keyup", press("Enter", element("DIV"), "Enter", 13))).toBe("^ Enter Enter #13 on div");
    expect(describeKey("keydown", press("s", element("BUTTON")))).toBe("v s KeyS #83 on button");
    expect(describeKey("keydown", press("s", null))).toBe("v s KeyS #83 on -");
  });

  it("writes nothing of what is typed in a field, a password included, not even which key", () => {
    for (const target of [element("INPUT"), element("INPUT", "password"), element("INPUT", "search"), element("TEXTAREA")]) {
      expect(describeKey("keydown", press("s", target))).toMatch(/^v \(typing\) on (input|textarea)$/);
      expect(describeKey("keyup", press("S", target))).toMatch(/^\^ \(typing\) on (input|textarea)$/);
    }
  });

  it("writes the keys that move through a field or leave it, and a key in a field that takes no text", () => {
    expect(describeKey("keydown", press("ArrowDown", element("INPUT"), "ArrowDown", 40))).toBe("v ArrowDown ArrowDown #40 on input");
    expect(describeKey("keydown", press("Backspace", element("INPUT"), "Backspace", 8))).toBe("v Backspace Backspace #8 on input");
    expect(describeKey("keydown", press(" ", element("INPUT", "checkbox"), "Space", 32))).toBe("v   Space #32 on input");
  });
});

describe("describeElement", () => {
  const element = (tagName: string, attributes: Record<string, string> = {}, id = "") =>
    ({ tagName, id, getAttribute: (name: string) => attributes[name] ?? null }) as unknown;

  it("says what an element is in a few characters", () => {
    expect(describeElement(element("BUTTON", { "data-testid": "tv-stop-btn" }))).toBe("button[tv-stop-btn]");
    expect(describeElement(element("BUTTON", { "aria-label": "Play" }))).toBe("button[Play]");
    expect(describeElement(element("DIV", {}, "root"))).toBe("div[root]");
    expect(describeElement(element("VIDEO"))).toBe("video");
  });

  it("says nothing for what is not an element", () => {
    expect(describeElement(null)).toBe("-");
    expect(describeElement(undefined)).toBe("-");
    expect(describeElement({})).toBe("-");
  });
});
