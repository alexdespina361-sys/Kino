import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const pictures = {
  "kino-cat-off.svg": read("../../../public/branding/kino-cat-off.svg"),
};

const ELEMENTS = ["svg", "title", "g", "path", "circle"];
const ATTRIBUTES = ["xmlns", "width", "height", "viewBox", "fill", "role", "aria-label", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "d", "cx", "cy", "r"];

const box = (svg: string) => ["width", "height", "viewBox"].map((name) => svg.match(new RegExp(`<svg\\b[^>]*\\s${name}="([^"]+)"`))?.[1]);

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

  it("has a size, and the component asks for that size", () => {
    const [width, height] = box(pictures["kino-cat-off.svg"]);
    expect(width && height, "a size to ask for").toBeTruthy();
    expect(read("./Logo.tsx")).toContain(`width="${width}" height="${height}"`);
  });
});
