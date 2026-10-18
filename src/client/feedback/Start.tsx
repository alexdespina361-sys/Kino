import { feedbackTitle, FEEDBACK_KINDS, type FeedbackKind } from "../../shared";
import { useT, type Key } from "../i18n";
import { ChevronIcon, MessageIcon, ShieldIcon, TrashIcon } from "../shared/icons";
import { useUnreadFeedback } from "./api";
import type { Draft } from "./receipts";
import { KindIcon } from "./ui";

export interface StartProps {
  onKind: (kind: FeedbackKind) => void;
  /** Words from before (this page's own, or the last session's) that were not sent. */
  draft: Draft | undefined;
  onContinue: () => void;
  onDiscard: () => void;
  /** Whether there is anything to look at under "Your messages" (a receipt, or an account). */
  hasMessages: boolean;
  onMine: () => void;
}

/** The first screen: what kind of feedback it is, and the way back to a draft or an answer. */
export function StartScreen({ onKind, draft, onContinue, onDiscard, hasMessages, onMine }: StartProps) {
  const t = useT();
  const unread = useUnreadFeedback();
  return (
    <div className="fb-body" data-testid="fb-start">
      <p className="fb-lead">{t("feedback.lead")}</p>
      {draft ? (
        <div className="fb-draft" data-testid="fb-draft">
          <button type="button" className="fb-draft-open" data-nav data-testid="fb-draft-continue" onClick={onContinue}>
            <span className="fb-draft-text">
              <strong>{t("feedback.draft.continue")}</strong>
              <small>{feedbackTitle({ message: draft.text || Object.values(draft.details).find((value) => value?.trim()) || "" }, "…")}</small>
            </span>
            <ChevronIcon />
          </button>
          <button type="button" className="fb-icon-button" data-nav data-testid="fb-draft-discard" aria-label={t("feedback.draft.discard")} onClick={onDiscard}>
            <TrashIcon />
          </button>
        </div>
      ) : null}
      <div className="fb-kinds" role="group" aria-label={t("feedback.title")}>
        {FEEDBACK_KINDS.map((kind) => (
          <button key={kind} type="button" className={`fb-kind fb-kind-${kind}`} data-nav data-testid={`fb-kind-${kind}`} data-autofocus={kind === "bug" ? "" : undefined} onClick={() => onKind(kind)}>
            <span className="fb-kind-icon">
              <KindIcon kind={kind} />
            </span>
            <span className="fb-kind-text">
              <strong>{t(`feedback.kind.${kind}` as Key)}</strong>
              <small>{t(`feedback.kind.${kind}.hint` as Key)}</small>
            </span>
            <ChevronIcon />
          </button>
        ))}
      </div>
      {hasMessages ? (
        <button type="button" className="fb-mine-link" data-nav data-testid="fb-mine" onClick={onMine}>
          <MessageIcon />
          <span className="fb-mine-text">{t("feedback.mine")}</span>
          {unread > 0 ? (
            <span className="fb-badge" data-testid="fb-unread" aria-label={t("feedback.unread", { count: unread })}>
              {unread}
            </span>
          ) : null}
          <ChevronIcon />
        </button>
      ) : null}
      <p className="fb-privacy">
        <ShieldIcon />
        <span>{t("feedback.privacy")}</span>
      </p>
    </div>
  );
}
