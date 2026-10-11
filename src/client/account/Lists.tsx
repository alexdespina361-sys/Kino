import { useState, type FormEvent } from "react";
import { LIST_NAME_MAX, type ListInfo } from "../../shared";
import { useT } from "../i18n";
import { TrashIcon } from "../shared/icons";
import { listName } from "./cards";

interface EditorProps {
  /** Absent: a new list. */
  list?: ListInfo | undefined;
  /** The names of the account's other lists: two lists with one name can't be told apart in a row of buttons. */
  taken?: readonly string[];
  onSave: (name: string) => void;
  onCancel: () => void;
  /** Absent for a new list and for the first one, which can't be removed. */
  onDelete?: (() => void) | undefined;
  /** On the TV every control is reached with the remote's arrow keys (`data-nav`), and the buttons look like the TV's. */
  tv?: boolean;
}

/** The name of one list, and the way to remove it. The same on the phone (in a sheet) and on the TV (on a page of its own). */
export function ListEditor({ list, taken = [], onSave, onCancel, onDelete, tv = false }: EditorProps) {
  const t = useT();
  const [name, setName] = useState(list ? listName(list) : "");
  const [confirming, setConfirming] = useState(false);
  const [clash, setClash] = useState(false);
  const nav = tv ? { "data-nav": true } : {};
  const buttonClass = (kind: "main" | "plain" | "danger") =>
    tv ? `tv-action${kind === "main" ? " tv-action-primary" : kind === "danger" ? " tv-action-danger" : ""}` : `btn${kind === "main" ? " btn-red" : kind === "danger" ? " btn-danger" : ""}`;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = name.trim();
    if (!next) return;
    if (taken.some((other) => other.trim().toLowerCase() === next.toLowerCase())) return setClash(true);
    // The same name is nothing to save (and the first list keeps following the language of the screen until somebody really names it).
    if (list && next === listName(list)) onCancel();
    else onSave(next);
  };

  return (
    <form className={`profile-editor${tv ? " profile-editor-tv list-editor-tv" : ""}`} onSubmit={submit} noValidate data-testid="list-editor">
      <label className="auth-field">
        <span>{t("lists.name")}</span>
        <input
          data-testid="list-name-input"
          value={name}
          maxLength={LIST_NAME_MAX}
          autoComplete="off"
          autoCapitalize="sentences"
          enterKeyHint="done"
          onChange={(event) => {
            setName(event.target.value);
            setClash(false);
          }}
          {...nav}
        />
      </label>

      {clash && (
        <p className="auth-error" role="alert" data-testid="list-error">
          {t("lists.nameTaken")}
        </p>
      )}

      <div className="editor-actions">
        <button type="submit" className={buttonClass("main")} disabled={!name.trim()} data-testid="list-save" {...nav}>
          {t("common.save")}
        </button>
        <button type="button" className={buttonClass("plain")} onClick={onCancel} data-testid="list-cancel" {...nav}>
          {t("common.cancel")}
        </button>
      </div>

      {onDelete &&
        (confirming ? (
          <div className="editor-confirm" role="alert">
            <p>{t("lists.deleteAsk", { name: list ? listName(list) : "" })}</p>
            <div className="editor-actions">
              <button type="button" className={buttonClass("danger")} onClick={onDelete} data-testid="list-delete-confirm" {...nav}>
                <TrashIcon /> {t("common.delete")}
              </button>
              {/* The button that was pressed is gone: on the TV the remote lands on the safe answer. */}
              <button type="button" className={buttonClass("plain")} onClick={() => setConfirming(false)} data-testid="list-delete-cancel" autoFocus={tv} {...nav}>
                {t("common.cancel")}
              </button>
            </div>
          </div>
        ) : tv ? (
          <button type="button" className={buttonClass("danger")} onClick={() => setConfirming(true)} data-testid="list-delete" {...nav}>
            <TrashIcon /> {t("lists.delete")}
          </button>
        ) : (
          <button type="button" className="auth-switch danger" onClick={() => setConfirming(true)} data-testid="list-delete">
            <TrashIcon /> {t("lists.delete")}
          </button>
        ))}
    </form>
  );
}
