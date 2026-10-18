import { useT } from "../i18n";
import { CheckIcon, MessageIcon } from "../shared/icons";

export interface SentProps {
  /** The report can be answered here (it kept a receipt). */
  answerable: boolean;
  /** Pictures the server did not take (a type or a size it does not accept), and the plain ones that did not fit behind the marked ones. */
  rejected: number;
  dropped: number;
  onMine: () => void;
  onAnother: () => void;
  onClose: () => void;
}

export function SentScreen({ answerable, rejected, dropped, onMine, onAnother, onClose }: SentProps) {
  const t = useT();
  return (
    <div className="fb-body fb-sent" data-testid="fb-sent">
      <span className="fb-sent-mark" aria-hidden="true">
        <CheckIcon />
      </span>
      <h3 className="fb-sent-title" data-autofocus tabIndex={-1}>
        {t("feedback.sent.title")}
      </h3>
      <p className="fb-lead">{answerable ? t("feedback.sent.answerable") : t("feedback.sent.plain")}</p>
      {rejected > 0 ? <p className="fb-note">{t("feedback.sent.rejected", { count: rejected })}</p> : null}
      {dropped > 0 ? <p className="fb-note">{t("feedback.sent.dropped", { count: dropped })}</p> : null}
      <div className="fb-sent-actions">
        {answerable ? (
          <button type="button" className="fb-primary" data-nav data-testid="fb-sent-mine" onClick={onMine}>
            <MessageIcon />
            <span>{t("feedback.mine")}</span>
          </button>
        ) : null}
        <button type="button" className="fb-secondary" data-nav data-testid="fb-sent-another" onClick={onAnother}>
          {t("feedback.another")}
        </button>
        <button type="button" className="fb-secondary" data-nav data-testid="fb-sent-close" onClick={onClose}>
          {t("common.close")}
        </button>
      </div>
    </div>
  );
}
