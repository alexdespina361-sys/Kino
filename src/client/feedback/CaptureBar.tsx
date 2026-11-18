import { useT } from "../i18n";
import { ScreenshotIcon } from "../shared/icons";

export interface CaptureBarProps {
  counting: number | null;
  onNow: () => void;
  onLater: () => void;
  onCancel: () => void;
}

export function CaptureBar({ counting, onNow, onLater, onCancel }: CaptureBarProps) {
  const t = useT();
  return (
    <div className="fb-capture-bar" data-feedback-skip role="group" aria-label={t("feedback.capture.title")} data-testid="fb-capture-bar">
      <p className="fb-capture-text" role="status" aria-live="polite">
        <ScreenshotIcon />
        <span>{counting !== null ? t("feedback.capture.counting", { seconds: counting }) : t("feedback.capture.lead")}</span>
      </p>
      <div className="fb-capture-actions">
        <button type="button" className="fb-primary" data-nav data-testid="fb-capture-now" onClick={onNow}>
          {t("feedback.capture.now")}
        </button>
        {counting === null ? (
          <button type="button" className="fb-secondary" data-nav data-testid="fb-capture-later" onClick={onLater}>
            {t("feedback.capture.later")}
          </button>
        ) : null}
        <button type="button" className="fb-secondary" data-nav data-testid="fb-capture-cancel" onClick={onCancel}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}

export function Shutter() {
  const t = useT();
  return (
    <div className="fb-shutter" data-feedback-skip role="status" data-testid="fb-shutter">
      <span className="spinner" />
      <span>{t("feedback.capture.taking")}</span>
    </div>
  );
}
