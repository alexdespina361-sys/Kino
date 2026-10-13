import { Fragment, useState, type ReactNode } from "react";
import { useT } from "../i18n";

/** One line of the library's menu. */
export interface RailEntry {
  id: string;
  label: string;
  /** The pages and actions have one and stay in view as icons while the menu is closed; the categories under them have none and show only when it is open. */
  icon?: ReactNode;
  /** A heading above this line, for the first of a group (only shown while the menu is open). */
  group?: string;
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
 */
export function Rail({
  open,
  onOpen,
  entries,
  onArrive,
}: {
  open: boolean;
  onOpen: (open: boolean) => void;
  entries: readonly RailEntry[];
  onArrive: (element: HTMLElement) => void;
}) {
  const t = useT();
  const [resting, setResting] = useState(false);
  const wide = open || resting;
  return (
    <nav
      className="tv-rail"
      data-open={wide}
      data-testid="tv-rail"
      aria-label={t("tv.menu")}
      onFocus={() => onOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onOpen(false);
      }}
      // (A finger on a touch screen is no pointer that rests: its tap takes the focus, and that opens the menu.)
      onPointerEnter={(event) => event.pointerType !== "touch" && setResting(true)}
      onPointerLeave={() => setResting(false)}
    >
      {entries.map((entry, row) =>
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
              data-row={row}
              data-col={0}
              data-testid={entry.testId}
              data-badged={entry.badge || entry.lit ? "true" : undefined}
              aria-current={entry.current ? "page" : undefined}
              onClick={() => {
                setResting(false);
                entry.onPress();
              }}
              onFocus={(event) => onArrive(event.currentTarget)}
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
