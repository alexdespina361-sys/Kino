import { ACCENTS, type Accent } from "../../shared";

export function applyAccent(accent: Accent | undefined): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (accent && accent !== ACCENTS[0]) root.dataset.accent = accent;
  else delete root.dataset.accent;
}

export const ACCENT_SWATCH: Record<Accent, string> = {
  red: "#e50914",
  blue: "#2772e5",
  purple: "#8e54ea",
  green: "#1fb86a",
  orange: "#ff8a1f",
  pink: "#ff4f9a",
};

export const ACCENT_INK: Record<Accent, string> = {
  red: "#fff",
  blue: "#fff",
  purple: "#fff",
  green: "#111",
  orange: "#111",
  pink: "#111",
};
