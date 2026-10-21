import { useSyncExternalStore } from "react";
import { useT } from "../i18n";
import { CAT_PANEL_ID, emitCat, panelIsOpen, subscribePanel } from "./bus";

/**
 * The cat's button in the library's corner, beside the bell and the profile: it opens the cat's panel (come here, pet, sit, sleep, play, find me
 * something). It is only there on a screen that has a cat. `col` is its place among the corner's buttons, for the library's arrow keys.
 * This file is in the website's first download, with the button's drawing; the panel and the cat are not.
 */
export function CatIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {/* the head with its two ears */}
      <path d="M4.5 9.5V4.6a.6.6 0 0 1 1-.4l3.6 2.6a9 9 0 0 1 5.8 0l3.6-2.6a.6.6 0 0 1 1 .4v4.9c.7 1.1 1 2.3 1 3.6 0 4.2-3.6 7.2-8 7.2s-8-3-8-7.2c0-1.3.3-2.5 1-3.6z" />
      {/* eyes, nose and whiskers */}
      <circle cx="9.2" cy="12.2" r=".7" fill="currentColor" stroke="none" />
      <circle cx="14.8" cy="12.2" r=".7" fill="currentColor" stroke="none" />
      <path d="M11 15h2l-1 1.1z" fill="currentColor" strokeWidth={1} />
      <path d="M2.6 14.2l3-.4M2.8 17l2.9-1M21.4 14.2l-3-.4M21.2 17l-2.9-1" strokeWidth={1.4} />
    </svg>
  );
}

export function CatChip({ col }: { col: number }) {
  const t = useT();
  const open = useSyncExternalStore(subscribePanel, panelIsOpen, () => false);
  return (
    <button
      type="button"
      className="tv-corner-button tv-cat-chip"
      onClick={() => emitCat({ type: "panel" })}
      data-zone="top"
      data-row={0}
      data-col={col}
      data-cat-chip
      data-testid="tv-cat-chip"
      aria-haspopup="true"
      aria-expanded={open}
      aria-controls={open ? CAT_PANEL_ID : undefined}
      aria-label={t("cat.panel")}
      title={t("cat.panel")}
    >
      <CatIcon />
    </button>
  );
}
