import { useMemo } from "react";
import { listKey, savedKeys } from "../../shared";
import { listName } from "../account/cards";
import { listTap } from "../account/listTap";
import type { ListEntry } from "../account/profileStore";
import { profileStore, useProfileData } from "../account/store";
import { useT } from "../i18n";
import { CheckIcon, CloseIcon } from "../shared/icons";

export interface ListToggle {
  inList: boolean;
  label: string;
  asks: boolean;
  onClick: () => void;
  onHold: () => void;
}

export const LINE_EVENT = "kino:line";

export function useListToggle(onPick: (entry: ListEntry) => void): (entry: ListEntry) => ListToggle {
  const t = useT();
  const { lists, list } = useProfileData();
  const saved = useMemo(() => savedKeys(list), [list]);
  return (entry) => {
    const inList = lists.some((info) => saved.has(listKey(entry.url, info.id)));
    const tap = listTap(lists, saved, entry.url);
    const main = listName(lists[0]!);
    const onClick = () => (tap === "pick" ? onPick(entry) : profileStore.setInList(entry, tap === "add"));
    return {
      inList,
      asks: tap === "pick",
      label: tap === "pick" ? t("rows.inLists") : t(tap === "remove" ? "library.inList" : "library.addToList", { list: main }),
      onClick,
      onHold: () => {
        onClick();
        if (tap !== "pick") window.dispatchEvent(new CustomEvent(LINE_EVENT, { detail: t(tap === "remove" ? "rows.removedFrom" : "rows.addedTo", { list: main }) }));
      },
    };
  };
}

export function SavedMark() {
  return (
    <span className="lib-saved" data-testid="saved-mark" aria-hidden="true">
      <CheckIcon />
    </span>
  );
}

export function RemoveButton({ label, onClick, testId }: { label: string; onClick: () => void; testId: string }) {
  return (
    <button type="button" className="lib-round" onClick={onClick} aria-label={label} data-testid={testId}>
      <CloseIcon />
    </button>
  );
}
