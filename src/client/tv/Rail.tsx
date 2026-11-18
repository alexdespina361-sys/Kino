import { Fragment, useState, type MouseEvent, type ReactNode } from "react";
import { useT } from "../i18n";
import { Logo } from "../shared/Logo";

export interface RailEntry {
  id: string;
  label: string;
  icon?: ReactNode;
  group?: string;
  apart?: boolean;
  current?: boolean;
  badge?: string;
  lit?: boolean;
  testId: string;
  onPress: () => void;
}

export function Rail({
  open,
  onOpen,
  entries,
  onArrive,
  onHome,
  bar = false,
  flat = false,
}: {
  open: boolean;
  onOpen: (open: boolean) => void;
  entries: readonly RailEntry[];
  onArrive: (element: HTMLElement) => void;
  onHome?: () => void;
  bar?: boolean;
  flat?: boolean;
}) {
  const t = useT();
  const [resting, setResting] = useState(false);
  const wide = !bar && (open || resting);
  const onWordmark = (event: MouseEvent<HTMLElement>): boolean => {
    if (bar || (event.target as Element).closest("button")) return false;
    const mark = document.querySelector('[data-testid="tv-logo-home"]')?.getBoundingClientRect();
    return !!mark && mark.width > 0 && event.clientX >= mark.left && event.clientX <= mark.right && event.clientY >= mark.top && event.clientY <= mark.bottom;
  };
  return (
    <nav
      className="tv-rail"
      data-open={wide}
      data-bar={bar ? "true" : undefined}
      data-flat={flat ? "true" : undefined}
      data-testid="tv-rail"
      aria-label={t("tv.menu")}
      onFocus={() => !bar && onOpen(true)}
      onBlur={(event) => {
        if (!bar && !event.currentTarget.contains(event.relatedTarget as Node | null)) onOpen(false);
      }}
      onPointerEnter={(event) => !bar && event.pointerType !== "touch" && setResting(true)}
      onPointerLeave={() => setResting(false)}
      onClick={(event) => {
        if (!onHome || !onWordmark(event)) return;
        setResting(false);
        onOpen(false);
        onHome();
      }}
    >
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
