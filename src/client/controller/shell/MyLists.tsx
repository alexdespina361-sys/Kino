import type { ListInfo, LiveListItem, LiveRating } from "../../../shared";
import type { ListEntry } from "../../account/profileStore";
import { useT } from "../../i18n";
import { ListIcon } from "../../shared/icons";
import type { Entry } from "../../tv/pages";
import { hasListRows, ListRows, RatingsRow } from "../Rows";

/**
 * "My lists", a place of the phone's bar of its own: the lists this profile keeps and what it rated, as the rows they were on the home page. A tab is never
 * left blank or greyed out (R2): with nothing saved it says so, says how to save something, and offers the way to the titles.
 */
export function MyLists({
  lists,
  items,
  ratings,
  ratingsOn,
  onOpen,
  onPick,
  onRemove,
  onManage,
  onAllRatings,
  onBrowse,
}: {
  lists: readonly ListInfo[];
  items: readonly LiveListItem[];
  ratings: readonly LiveRating[];
  ratingsOn: boolean;
  onOpen: (entry: Entry) => void;
  onPick: (entry: ListEntry) => void;
  onRemove: (url: string, list: string) => void;
  onManage: () => void;
  onAllRatings: () => void;
  onBrowse: () => void;
}) {
  const t = useT();
  const empty = !hasListRows(lists, items) && !(ratingsOn && ratings.length > 0);
  return (
    <section className="tab-list" data-testid="my-lists" aria-labelledby="my-lists-heading">
      <h2 className="tab-heading" id="my-lists-heading">
        {t("tabs.list")}
      </h2>
      {empty ? (
        <div className="empty-state" data-testid="my-lists-empty">
          <span className="empty-icon" aria-hidden="true">
            <ListIcon />
          </span>
          <h3>{t("lists.emptyTitle")}</h3>
          <p className="muted">{t("rows.myListEmpty")}</p>
          <button type="button" className="btn btn-red" data-testid="my-lists-browse" onClick={onBrowse}>
            {t("lists.browse")}
          </button>
        </div>
      ) : (
        <>
          <ListRows lists={lists} items={items} onOpen={onOpen} onPick={onPick} onRemove={onRemove} onManage={onManage} />
          {ratingsOn && <RatingsRow ratings={ratings} onOpen={onOpen} onAll={onAllRatings} />}
        </>
      )}
    </section>
  );
}
