import { describe, expect, it } from "vitest";
import { debugOn, describeElement } from "./debug";

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
