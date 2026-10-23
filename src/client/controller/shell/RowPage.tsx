import { useEffect, useMemo, useRef } from "react";
import { listEntryOf } from "../../account/cards";
import type { ListEntry } from "../../account/profileStore";
import { scoreOf, useScores } from "../../account/ratings";
import { rowTitle, useT } from "../../i18n";
import { allRows, failedTitles, feed, GRID_CAP, hasMoreTitles, loadingTitles, useFeed } from "../../shared/feed";
import { entryOfItem, type Entry } from "../../tv/pages";
import { Page } from "../AccountScreen";
import { Tile } from "../Library";
import { useListToggle } from "../Round";

/** Empty places shown while the next titles of the row are on their way. */
const WAITING = 6;

/**
 * One row of the library on a page of its own ("See all"): every title of it, a few across and one line under the next, which is the way to look
 * through a long row on a phone held upright. The next titles are asked for as the end comes near, as they are at the end of a row that is scrolled sideways.
 */
export function RowPage({ rowId, onClose, onOpen, onPick }: { rowId: string; onClose: () => void; onOpen: (entry: Entry) => void; onPick: (entry: ListEntry) => void }) {
  const t = useT();
  const toggleFor = useListToggle(onPick);
  const scores = useScores();
  const feeding = useFeed();
  const row = useMemo(() => allRows(feeding.data, GRID_CAP).find((one) => one.id === rowId), [feeding.data, rowId]);
  const grid = useRef<HTMLDivElement>(null);
  const count = row?.items.length ?? 0;
  const more = row !== undefined && hasMoreTitles(feeding, rowId, count, GRID_CAP);
  const loading = loadingTitles(feeding, rowId);
  const failed = failedTitles(feeding, rowId);

  // Near the end of the page (a page that does not fill the screen yet counts), the next titles are asked for; each answer, and each failure that is over, looks again.
  useEffect(() => {
    const body = grid.current?.closest<HTMLElement>(".page-body");
    if (!more || !body) return;
    const look = () => {
      if (body.scrollHeight - body.scrollTop - body.clientHeight <= body.clientHeight * 1.5) feed.loadMore(rowId, GRID_CAP);
    };
    look();
    body.addEventListener("scroll", look, { passive: true });
    return () => body.removeEventListener("scroll", look);
  }, [more, rowId, count, failed]);

  return (
    <Page title={row ? rowTitle(row) : t("library.title")} onBack={onClose} testId="row-page">
      <div className="poster-grid" ref={grid} data-testid="row-grid">
        {row?.items.map((item) => (
          <Tile key={item.id} item={item} score={scoreOf(scores, item.url)} toggle={toggleFor(listEntryOf(item))} onOpen={() => onOpen(entryOfItem(item))} />
        ))}
        {loading &&
          Array.from({ length: WAITING }, (_, at) => (
            <div className="lib-tile lib-waiting" aria-hidden="true" key={`waiting-${at}`}>
              <span className="lib-art" />
            </div>
          ))}
      </div>
      {failed && (
        <p className="muted small" role="status" data-testid="row-failed">
          {t("rows.moreFailed")}
        </p>
      )}
    </Page>
  );
}
