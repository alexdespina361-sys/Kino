import { useMemo } from "react";
import { listKey } from "../../shared";
import { listName } from "../account/cards";
import type { ListEntry } from "../account/profileStore";
import { profileStore, useProfileData } from "../account/store";
import { useT } from "../i18n";
import { CheckIcon, CloseIcon, PlusIcon } from "../shared/icons";

/** What the + on a title says and does: it is in a list (a tick, and a tap takes it out), or it can go in one; with several lists a tap asks which. */
export interface ListToggle {
  inList: boolean;
  label: string;
  asks: boolean;
  onClick: () => void;
}

/** How a title stands with the lists: for any title, what its + says and does (`onPick` asks which list when there are several). */
export function useListToggle(onPick: (entry: ListEntry) => void): (entry: ListEntry) => ListToggle {
  const t = useT();
  const { lists, list } = useProfileData();
  const saved = useMemo(() => new Set(list.map((item) => item.key)), [list]);
  const several = lists.length > 1;
  return (entry) => {
    const inList = lists.some((info) => saved.has(listKey(entry.url, info.id)));
    return {
      inList,
      asks: several,
      label: several ? t(inList ? "rows.inLists" : "library.addToAList") : t(inList ? "library.inList" : "library.addToList", { list: listName(lists[0]!) }),
      onClick: () => (several ? onPick(entry) : profileStore.setInList(entry, !inList)),
    };
  };
}

/** The round + on a title (a tick once it is in a list). */
export function ListButton({ toggle, title, testId = "library-list-toggle" }: { toggle: ListToggle; title: string; testId?: string }) {
  return (
    <button
      type="button"
      className="lib-round lib-add"
      onClick={toggle.onClick}
      aria-pressed={toggle.inList}
      aria-haspopup={toggle.asks ? "dialog" : undefined}
      aria-label={`${toggle.label}: ${title}`}
      data-testid={testId}
    >
      {toggle.inList ? <CheckIcon /> : <PlusIcon />}
    </button>
  );
}

/** The round cross on a card: it takes the title off the row. */
export function RemoveButton({ label, onClick, testId }: { label: string; onClick: () => void; testId: string }) {
  return (
    <button type="button" className="lib-round" onClick={onClick} aria-label={label} data-testid={testId}>
      <CloseIcon />
    </button>
  );
}
