import { describe, expect, it } from "vitest";
import { noPinchZoom } from "./kinoApp";

const page = (content: string) => {
  const viewport = { content };
  const style: { touchAction?: string } = {};
  const doc = { querySelector: (what: string) => (what === 'meta[name="viewport"]' ? viewport : null), documentElement: { style } } as unknown as Document;
  return { doc, viewport, style };
};

describe("no two-finger zoom in the app", () => {
  it("the viewport does not scale and a touch only pans", () => {
    const { doc, viewport, style } = page("width=device-width, initial-scale=1, viewport-fit=cover");
    noPinchZoom(doc);
    expect(viewport.content).toBe("width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1, user-scalable=no");
    expect(style.touchAction).toBe("pan-x pan-y");
  });

  it("said twice, the viewport is as after once", () => {
    const { doc, viewport } = page("width=device-width, initial-scale=1");
    noPinchZoom(doc);
    noPinchZoom(doc);
    expect(viewport.content).toBe("width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no");
  });
});
