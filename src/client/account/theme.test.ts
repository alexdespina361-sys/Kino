import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACCENTS } from "../../shared";
import { ACCENT_INK, ACCENT_SWATCH } from "./theme";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

/** What the stylesheet says for one accent (the first one, red, is the root's own). */
function declared(accent: string, name: string): string | undefined {
  const block = accent === ACCENTS[0] ? /:root\s*\{([^}]*)\}/.exec(css) : new RegExp(`:root\\[data-accent="${accent}"\\]\\s*\\{([^}]*)\\}`).exec(css);
  return new RegExp(`--${name}:\\s*([^;]+);`).exec(block?.[1] ?? "")?.[1]?.trim();
}

const channel = (value: number) => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => {
  const n = parseInt(hex.length === 4 ? hex.replace(/[a-f\d]/gi, "$&$&").slice(1) : hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
};
const contrast = (a: string, b: string) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
};

describe("the accents", () => {
  it.each(ACCENTS)("%s: the picker's swatch and ink are the colours the stylesheet uses", (accent) => {
    expect(declared(accent, "accent")).toBe(ACCENT_SWATCH[accent]);
    expect(declared(accent, "accent-ink") ?? declared(ACCENTS[0], "accent-ink")).toBe(ACCENT_INK[accent]);
  });

  it.each(ACCENTS)("%s: the words on it can be read", (accent) => {
    expect(contrast(ACCENT_INK[accent], ACCENT_SWATCH[accent])).toBeGreaterThanOrEqual(3.5);
  });
});
