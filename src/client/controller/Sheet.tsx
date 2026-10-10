import { useEffect, type ReactNode } from "react";
import { t, useT } from "../i18n";
import { CloseIcon } from "../shared/icons";

/** A bottom sheet: the phone's way of showing a short list of choices without leaving the remote. */
export function Sheet({
  title,
  onClose,
  children,
  testId,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
}) {
  useT();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t("common.close")} data-testid="sheet-close">
            <CloseIcon />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export interface Choice {
  key: string | number;
  label: string;
  active: boolean;
  testId: string;
  pick: () => void;
}

/** One-of-many list inside a sheet. */
export function ChoiceList({ choices }: { choices: Choice[] }) {
  return (
    <div className="choices" role="listbox">
      {choices.map((choice) => (
        <button
          key={choice.key}
          className={`choice ${choice.active ? "active" : ""}`}
          data-testid={choice.testId}
          role="option"
          aria-selected={choice.active}
          onClick={choice.pick}
        >
          <span>{choice.label}</span>
          <span className="choice-dot" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
