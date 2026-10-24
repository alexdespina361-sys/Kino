import { Fragment, useState, type ReactNode } from "react";
import { useT } from "../i18n";
import { Logo } from "../shared/Logo";

/** One line of the library's menu. */
export interface RailEntry {
  id: string;
  label: string;
  /** The pages and actions have one and stay in view as icons while the menu is closed; the categories under them have none and show only when it is open. */
  icon?: ReactNode;
  /** A heading above this line, for the first of a group (only shown while the menu is open). */
  group?: string;
  /** A space above this line, to set what follows (the party, a phone, the profile) apart from the places above it. */
  apart?: boolean;
  /** The page that is open. */
  current?: boolean;
  /** A short count beside the name (how many are in the party). */
  badge?: string;
  /** The entry stands for something that is on right now (a phone is connected): while the menu is shut, a dot on its icon says so; open, its name does. */
  lit?: boolean;
  testId: string;
  onPress: () => void;
}

/**
 * The menu down the left: a strip of icons that opens into names while the remote is on it, or while a mouse rests on it (a press with
 * the mouse takes no focus, so focus alone would open it only for as long as the button is held down). A click on a line goes there and
 * shuts the menu, as a press of OK does; it opens again once the pointer has left and come back.
 * On a phone held upright (`bar`, see compact.ts) it is a bar of a few places along the bottom instead, each with its name under its icon: it is never open or shut,
 * and its places are one row (`data-col`) for the arrow keys.
 */
export function Rail({
  open,
  onOpen,
  entries,
  onArrive,
  bar = false,
}: {
  open: boolean;
  onOpen: (open: boolean) => void;
  entries: readonly RailEntry[];
  onArrive: (element: HTMLElement) => void;
  bar?: boolean;
}) {
  const t = useT();
  const [resting, setResting] = useState(false);
  const wide = !bar && (open || resting);
  return (
    <nav
      className="tv-rail"
      data-open={wide}
      data-bar={bar ? "true" : undefined}
      data-testid="tv-rail"
      aria-label={t("tv.menu")}
      onFocus={() => !bar && onOpen(true)}
      onBlur={(event) => {
        if (!bar && !event.currentTarget.contains(event.relatedTarget as Node | null)) onOpen(false);
      }}
      // (A finger on a touch screen is no pointer that rests: its tap takes the focus, and that opens the menu.)
      onPointerEnter={(event) => !bar && event.pointerType !== "touch" && setResting(true)}
      onPointerLeave={() => setResting(false)}
    >
      {/* Open, the menu covers the page's wordmark: it carries the name itself, where the page has it (the stylesheet shows it only while the menu is open). */}
      {!bar && (
        <span className="tv-rail-brand" aria-hidden="true">
          <Logo />
        </span>
      )}
      {entries.map((entry, place) =>
        !wide && !entry.icon ? null : (
          <Fragment key={entry.id}>
            {wide && entry.group && (
              <p className="tv-rail-group" aria-hidden="true">
                {entry.group}
              </p>
            )}
            <button
              className={`tv-rail-item${entry.icon ? "" : " tv-rail-category"}`}
              data-zone="rail"
              data-row={bar ? 0 : place}
              data-col={bar ? place : 0}
              data-testid={entry.testId}
              data-badged={entry.badge || entry.lit ? "true" : undefined}
              data-apart={entry.apart ? "true" : undefined}
              aria-current={entry.current ? "page" : undefined}
              onClick={() => {
                setResting(false);
                entry.onPress();
              }}
              onFocus={(event) => !bar && onArrive(event.currentTarget)}
            >
              {entry.icon}
              <span>{entry.label}</span>
              {entry.badge && <i className="tv-rail-badge">{entry.badge}</i>}
            </button>
          </Fragment>
        ),
      )}
    </nav>
  );
}
