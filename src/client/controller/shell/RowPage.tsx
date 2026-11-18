import { useEffect, useMemo, useRef } from "react";
import { forChildren } from "../../../shared";
import { listEntryOf } from "../../account/cards";
import type { ListEntry } from "../../account/profileStore";
import { scoreOf, useScores } from "../../account/ratings";
import { useProfileData } from "../../account/store";
import { rowTitle, useT } from "../../i18n";
import { allRows, failedTitles, feed, GRID_CAP, hasMoreTitles, loadingTitles, nearBottom, useFeed } from "../../shared/feed";
import { entryOfItem, type Entry } from "../../tv/pages";
import { Page } from "../AccountScreen";
import { Tile } from "../Library";
import { useListToggle } from "../Round";

const WAITING = 6;

export function RowPage({ rowId, onClose, onOpen, onPick }: { rowId: string; onClose: () => void; onOpen: (entry: Entry) => void; onPick: (entry: ListEntry) => void }) {
  const t = useT();
  const toggleFor = useListToggle(onPick);
  const scores = useScores();
  const feeding = useFeed();
  const child = useProfileData().settings.child === true;
  const row = useMemo(() => {
    const found = allRows(feeding.data, GRID_CAP).find((one) => one.id === rowId);
    return found && child ? { ...found, items: found.items.filter((item) => forChildren(item, found)) } : found;
  }, [feeding.data, rowId, child]);
  const grid = useRef<HTMLDivElement>(null);
  const count = row?.items.length ?? 0;
  const more = row !== undefined && hasMoreTitles(feeding, rowId, count, GRID_CAP);
  const loading = loadingTitles(feeding, rowId);
  const failed = failedTitles(feeding, rowId);

  useEffect(() => {
    const body = grid.current?.closest<HTMLElement>(".page-body");
    if (!more || !body) return;
    const look = () => {
      if (nearBottom(body)) feed.loadMore(rowId, GRID_CAP);
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
