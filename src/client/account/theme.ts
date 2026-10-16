import { ACCENTS, type Accent } from "../../shared";

/** The colour behind every red thing on the page (buttons, focus rings, progress bars): the stylesheet defines one set per name. */
export function applyAccent(accent: Accent | undefined): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (accent && accent !== ACCENTS[0]) root.dataset.accent = accent;
  else delete root.dataset.accent;
}

/** What each accent looks like in the picker (the same colours as the stylesheet's `--accent`). */
export const ACCENT_SWATCH: Record<Accent, string> = {
  red: "#e50914",
  blue: "#2772e5",
  purple: "#8e54ea",
  green: "#1fb86a",
  orange: "#ff8a1f",
  pink: "#ff4f9a",
};

/** The tick on a swatch, and the words on a button of that colour (the stylesheet's `--accent-ink`). */
export const ACCENT_INK: Record<Accent, string> = {
  red: "#fff",
  blue: "#fff",
  purple: "#fff",
  green: "#111",
  orange: "#111",
  pink: "#111",
};
