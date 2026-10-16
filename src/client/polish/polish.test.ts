import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dir = new URL(".", import.meta.url);
const sheets = readdirSync(dir).filter((name) => name.endsWith(".css"));
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** What an old TV browser (VIDAA, Tizen, webOS) drops, or worse, drops the whole block around. The older sheets do not use these either. */
const TOO_NEW: [RegExp, string][] = [
  [/@layer\b/, "@layer (a browser that does not know it drops the whole block)"],
  [/@container\b/, "@container"],
  [/@property\b/, "@property"],
  [/color-mix\(/, "color-mix()"],
  [/\b(?:oklch|oklab|lch|lab)\(/, "oklch()/oklab()/lch()/lab()"],
  [/light-dark\(/, "light-dark()"],
  [/\d(?:dvh|svh|lvh|dvw|svw|lvw)\b/, "dvh/svh/lvh (and the w ones)"],
  [/\bsubgrid\b/, "subgrid"],
  [/:has\(/, ":has() (a selector list with one it does not know is dropped whole)"],
  [/:where\(/, ":where()"],
  [/:is\(/, ":is()"],
  [/\btext-wrap\s*:/, "text-wrap"],
  [/\bcontainer-type\s*:/, "container-type"],
];

/** The selector of every style rule, also inside @media and @supports; the steps of @keyframes and the like are not selectors. */
export function selectorsOf(css: string): string[] {
  const selectors: string[] = [];
  const stack: ("group" | "rule" | "opaque")[] = [];
  let start = 0;
  for (let at = 0; at < css.length; at++) {
    const char = css[at];
    if (char === "{") {
      const prelude = css.slice(start, at).trim();
      const top = stack[stack.length - 1];
      if (prelude.startsWith("@")) stack.push(/^@(?:media|supports)\b/.test(prelude) ? "group" : "opaque");
      else if (top === undefined || top === "group") {
        selectors.push(prelude);
        stack.push("rule");
      } else stack.push("opaque");
      start = at + 1;
    } else if (char === "}") {
      stack.pop();
      start = at + 1;
    } else if (char === ";") {
      start = at + 1;
    }
  }
  return selectors;
}

describe("selectorsOf", () => {
  it("lists the selectors of rules, also in media queries, and not the steps of an animation", () => {
    const css = `:root[data-ui="polish"] a, :root[data-ui="polish"] b { color: red; } @media (min-width: 1px) { .x, .y { top: 0; } } @keyframes k { from { opacity: 0; } 50% { opacity: 1; } } @font-face { font-family: f; }`;
    expect(selectorsOf(css)).toEqual([':root[data-ui="polish"] a, :root[data-ui="polish"] b', ".x, .y"]);
  });
});

describe("the stylesheets of the refined layer (src/client/polish)", () => {
  it("are there", () => {
    expect(sheets).toContain("base.css");
  });

  for (const name of sheets) {
    const css = withoutComments(readFileSync(new URL(name, dir), "utf8"));

    it(`${name}: starts every rule with :root[data-ui="polish"], so the layer stays one that can be taken off the page by taking off the attribute`, () => {
      const offenders = selectorsOf(css)
        .flatMap((list) => list.split(",").map((one) => one.trim()))
        .filter((one) => !one.startsWith(':root[data-ui="polish"]'));
      expect(offenders).toEqual([]);
    });

    it(`${name}: names its @keyframes polish-..., since keyframes are global and one of the same name as an older sheet's would change that animation by accident`, () => {
      const names = [...css.matchAll(/@keyframes\s+([^\s{]+)/g)].map((match) => match[1] ?? "");
      expect(names.filter((one) => !one.startsWith("polish-"))).toEqual([]);
    });

    it(`${name}: keeps to what the oldest TV browsers understand`, () => {
      const found = TOO_NEW.filter(([pattern]) => pattern.test(css)).map(([, label]) => label);
      expect(found).toEqual([]);
    });
  }
});
