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
  blue: "#2b7fff",
  purple: "#9b5cff",
  green: "#1fb86a",
  orange: "#ff8a1f",
  pink: "#ff4f9a",
};
