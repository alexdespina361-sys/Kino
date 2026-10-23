import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The wordmark's two pictures (public/branding) are what the page loads in an <img>: shapes and nothing else, and the one with the cat's ears is
 * the plain one in the same box with the ears on it (so that one sits exactly over the other, and nothing moves when the ears fade in).
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const pictures = {
  "kino-cat-off.svg": read("../../../public/branding/kino-cat-off.svg"),
  "kino-cat-on.svg": read("../../../public/branding/kino-cat-on.svg"),
};

const ELEMENTS = ["svg", "title", "g", "path", "circle"];
const ATTRIBUTES = ["xmlns", "width", "height", "viewBox", "fill", "role", "aria-label", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "d", "cx", "cy", "r"];

const box = (svg: string) => ["width", "height", "viewBox"].map((name) => svg.match(new RegExp(`<svg\\b[^>]*\\s${name}="([^"]+)"`))?.[1]);
const shapes = (svg: string) => svg.match(/<(?:path|circle)\b[^>]*>/g) ?? [];

describe("the wordmark's pictures", () => {
  it.each(Object.entries(pictures))("%s is shapes and nothing else: nothing that runs, loads or needs a font", (_name, svg) => {
    const markup = svg.replace(/<!--[\s\S]*?-->/g, "");
    const tags = [...markup.matchAll(/<\/?([A-Za-z][\w:.-]*)([^>]*)>/g)];
    expect(tags.length, "every < opens a tag this test understands (no doctype, no entity, no CDATA)").toBe(markup.split("<").length - 1);
    for (const [, element, attributes] of tags) {
      expect(ELEMENTS, `<${element}>`).toContain(element);
      for (const [, attribute] of attributes!.matchAll(/([\w:.-]+)\s*=/g)) expect(ATTRIBUTES, `<${element} ${attribute}>`).toContain(attribute);
    }
  });

  it("are the same size and box, the one with the ears has all the shapes of the plain one, and the component asks for that size", () => {
    const [plain, ears] = Object.values(pictures);
    const [width, height] = box(plain!);
    expect(width && height, "a size to ask for").toBeTruthy();
    expect(box(ears!)).toEqual(box(plain!));
    for (const shape of shapes(plain!)) expect(ears, shape).toContain(shape);
    expect(shapes(ears!).length).toBeGreaterThan(shapes(plain!).length);
    expect(read("./Logo.tsx")).toContain(`width="${width}" height="${height}"`);
  });
});
