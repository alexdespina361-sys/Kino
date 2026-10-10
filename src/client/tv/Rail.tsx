import { Fragment, type ReactNode } from "react";
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
  /** A short state beside the name ("Connected"). */
  badge?: string;
  testId: string;
  onPress: () => void;
}

/** The menu down the left: a strip of icons that opens into names while the remote is on it. */
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
  return (
    <nav
      className="tv-rail"
      data-open={open}
      data-testid="tv-rail"
      aria-label={t("tv.menu")}
      onFocus={() => onOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onOpen(false);
      }}
    >
      {entries.map((entry, row) =>
        !open && !entry.icon ? null : (
          <Fragment key={entry.id}>
            {open && entry.group && (
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
              data-badged={entry.badge ? "true" : undefined}
              aria-current={entry.current ? "page" : undefined}
              onClick={entry.onPress}
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
