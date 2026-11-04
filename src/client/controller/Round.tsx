import { useMemo } from "react";
import { listKey, savedKeys } from "../../shared";
import { listName } from "../account/cards";
import type { ListEntry } from "../account/profileStore";
import { profileStore, useProfileData } from "../account/store";
import { useT } from "../i18n";
import { CheckIcon, CloseIcon } from "../shared/icons";

/** How a title stands with the lists: it is in one (a tick on its poster, and a tap takes it out), or it can go in one; with several lists a tap asks which. */
export interface ListToggle {
  inList: boolean;
  label: string;
  asks: boolean;
  onClick: () => void;
  /** The same, from a hold on the title: the finger is on the poster and sees nothing change on it, so a line at the bottom says what happened. */
  onHold: () => void;
}

/** The page is told (see Controller.tsx) what to say at the bottom of the screen by this event on the window, its text the event's detail. */
export const LINE_EVENT = "kino:line";

/** How a title stands with the lists: for any title, what its + says and does (`onPick` asks which list when there are several). */
export function useListToggle(onPick: (entry: ListEntry) => void): (entry: ListEntry) => ListToggle {
  const t = useT();
  const { lists, list } = useProfileData();
  const saved = useMemo(() => savedKeys(list), [list]);
  const several = lists.length > 1;
  return (entry) => {
    const inList = lists.some((info) => saved.has(listKey(entry.url, info.id)));
    const onClick = () => (several ? onPick(entry) : profileStore.setInList(entry, !inList));
    return {
      inList,
      asks: several,
      label: several ? t(inList ? "rows.inLists" : "library.addToAList") : t(inList ? "library.inList" : "library.addToList", { list: listName(lists[0]!) }),
      onClick,
      onHold: () => {
        onClick();
        if (!several) window.dispatchEvent(new CustomEvent(LINE_EVENT, { detail: t(inList ? "rows.removedFrom" : "rows.addedTo", { list: listName(lists[0]!) }) }));
      },
    };
  };
}

/**
 * What a poster says of a title that is in a list: a small tick in its corner, and nothing at all on one that is not (a poster with a button on it for every
 * title was a wall of buttons). A title goes in a list by a hold on it (the line at the bottom says what happened), or by the button of its page.
 */
export function SavedMark() {
  return (
    <span className="lib-saved" data-testid="saved-mark" aria-hidden="true">
      <CheckIcon />
    </span>
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
