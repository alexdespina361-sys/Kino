import { useState } from "react";
import { DEFAULT_LIST, listKey, listOf, MAX_LISTS, savedKeys } from "../../shared";
import { listName } from "../account/cards";
import { ListEditor } from "../account/Lists";
import type { ListEntry } from "../account/profileStore";
import { profileStore, useProfileData } from "../account/store";
import { useT } from "../i18n";
import { CheckIcon, PencilIcon, PlusIcon } from "../shared/icons";
import { Sheet } from "./Sheet";

/** Which of the lists a title is in: a tap on a list puts it there or takes it out. And a new list for it, when none is the right one. */
export function ListPickerSheet({ entry, onClose }: { entry: ListEntry; onClose: () => void }) {
  const t = useT();
  const { lists, list } = useProfileData();
  const [making, setMaking] = useState(false);
  const saved = savedKeys(list);

  return (
    <Sheet title={t(making ? "lists.new" : "library.addToAList")} onClose={making ? () => setMaking(false) : onClose} testId="list-picker">
      {making ? (
        <ListEditor
          taken={lists.map(listName)}
          onSave={(name) => {
            const made = profileStore.createList(name);
            if (made) profileStore.setInList(entry, true, made);
            setMaking(false);
          }}
          onCancel={() => setMaking(false)}
        />
      ) : (
        <>
          <p className="muted">{entry.title}</p>
          <div className="choices" role="group" aria-label={t("library.addToAList")}>
            {lists.map((info) => {
              const has = saved.has(listKey(entry.url, info.id));
              return (
                <button key={info.id} type="button" className={`choice ${has ? "active" : ""}`} aria-pressed={has} data-testid={`pick-${info.id}`} onClick={() => profileStore.setInList(entry, !has, info.id)}>
                  <span className="choice-label">
                    {has ? <CheckIcon /> : <PlusIcon />} {listName(info)}
                  </span>
                </button>
              );
            })}
            {lists.length < MAX_LISTS && (
              <button type="button" className="choice choice-new" onClick={() => setMaking(true)} data-testid="pick-new">
                <span className="choice-label">
                  <PlusIcon /> {t("lists.new")}
                </span>
              </button>
            )}
          </div>
        </>
      )}
    </Sheet>
  );
}

/** The lists themselves: make one, give one another name, delete one (all but the first). */
export function ListsSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { lists, list } = useProfileData();
  /** `undefined`: the lists; `null`: making a new one; an id: changing that one. */
  const [editing, setEditing] = useState<string | null | undefined>(undefined);
  const back = () => setEditing(undefined);
  const changing = typeof editing === "string" ? lists.find((info) => info.id === editing) : undefined;
  const showing = editing === undefined || (typeof editing === "string" && !changing) ? undefined : editing;

  return (
    <Sheet title={t(showing === undefined ? "lists.manage" : showing === null ? "lists.new" : "lists.edit")} onClose={showing === undefined ? onClose : back} testId="lists-sheet">
      {showing === undefined ? (
        <div className="choices">
          {lists.map((info) => (
            <button key={info.id} type="button" className="choice" onClick={() => setEditing(info.id)} data-testid={`manage-${info.id}`}>
              <span>{listName(info)}</span>
              <span className="choice-note">
                {t("tv.titles", { count: list.filter((item) => listOf(item) === info.id).length })} <PencilIcon />
              </span>
            </button>
          ))}
          {lists.length < MAX_LISTS && (
            <button type="button" className="choice choice-new" onClick={() => setEditing(null)} data-testid="list-new">
              <span className="choice-label">
                <PlusIcon /> {t("lists.new")}
              </span>
            </button>
          )}
        </div>
      ) : (
        <ListEditor
          list={changing}
          taken={lists.filter((info) => info.id !== changing?.id).map(listName)}
          onSave={(name) => {
            if (changing) profileStore.renameList(changing.id, name);
            else profileStore.createList(name);
            back();
          }}
          onCancel={back}
          onDelete={
            changing && changing.id !== DEFAULT_LIST
              ? () => {
                  profileStore.deleteList(changing.id);
                  back();
                }
              : undefined
          }
        />
      )}
    </Sheet>
  );
}
