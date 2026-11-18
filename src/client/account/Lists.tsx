import { useState, type FormEvent } from "react";
import { LIST_NAME_MAX, type ListInfo } from "../../shared";
import { useT } from "../i18n";
import { ChevronIcon, TrashIcon } from "../shared/icons";
import { useBackFirst } from "../tv/dpad";
import { appendTo } from "../tv/librarySearch";
import { NameKeys } from "../tv/NameKeys";
import { listName } from "./cards";

interface EditorProps {
  list?: ListInfo | undefined;
  taken?: readonly string[];
  onSave: (name: string) => void;
  onCancel: () => void;
  onDelete?: (() => void) | undefined;
  onMove?: ((by: -1 | 1) => void) | undefined;
  canMoveEarlier?: boolean;
  canMoveLater?: boolean;
  tv?: boolean;
}

export function ListEditor({ list, taken = [], onSave, onCancel, onDelete, onMove, canMoveEarlier = true, canMoveLater = true, tv = false }: EditorProps) {
  const t = useT();
  const [name, setName] = useState(list ? listName(list) : "");
  const [confirming, setConfirming] = useState(false);
  useBackFirst(tv && confirming ? () => setConfirming(false) : undefined);
  const [clash, setClash] = useState(false);
  const nav = tv ? { "data-nav": true } : {};
  const buttonClass = (kind: "main" | "plain" | "danger") =>
    tv ? `tv-action${kind === "main" ? " tv-action-primary" : kind === "danger" ? " tv-action-danger" : ""}` : `btn${kind === "main" ? " btn-red" : kind === "danger" ? " btn-danger" : ""}`;

  const change = (update: (before: string) => string) => {
    setName(update);
    setClash(false);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = name.trim();
    if (!next) return;
    if (taken.some((other) => other.trim().toLowerCase() === next.toLowerCase())) return setClash(true);
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

      {tv && (
        <NameKeys
          onKey={(char) => change((before) => appendTo(before, before === "" ? char.toUpperCase() : char, LIST_NAME_MAX))}
          onDelete={() => change((before) => before.slice(0, -1))}
          onClear={() => change(() => "")}
        />
      )}

      <div className="editor-actions">
        <button type="submit" className={buttonClass("main")} disabled={!name.trim()} data-testid="list-save" {...nav}>
          {t("common.save")}
        </button>
        <button type="button" className={buttonClass("plain")} onClick={onCancel} data-testid="list-cancel" {...nav}>
          {t("common.cancel")}
        </button>
      </div>

      {onMove && (
        <div className="editor-actions editor-move" role="group" aria-label={t("lists.place")}>
          <button type="button" className={buttonClass("plain")} aria-disabled={!canMoveEarlier} onClick={() => canMoveEarlier && onMove(-1)} data-testid="list-move-earlier" {...nav}>
            <ChevronIcon className={tv ? "flip" : "turn-up"} /> {t(tv ? "lists.moveLeft" : "lists.moveUp")}
          </button>
          <button type="button" className={buttonClass("plain")} aria-disabled={!canMoveLater} onClick={() => canMoveLater && onMove(1)} data-testid="list-move-later" {...nav}>
            {t(tv ? "lists.moveRight" : "lists.moveDown")} <ChevronIcon className={tv ? undefined : "turn-down"} />
          </button>
        </div>
      )}

      {onDelete &&
        (confirming ? (
          <div className="editor-confirm" role="alert">
            <p>{t("lists.deleteAsk", { name: list ? listName(list) : "" })}</p>
            <div className="editor-actions">
              <button type="button" className={buttonClass("danger")} onClick={onDelete} data-testid="list-delete-confirm" {...nav}>
                <TrashIcon /> {t("common.delete")}
              </button>
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
