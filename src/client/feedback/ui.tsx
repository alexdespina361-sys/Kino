import type { ReactNode } from "react";
import type { FeedbackKind, FeedbackStatus } from "../../shared";
import { useT, type Key } from "../i18n";
import { BugIcon, BulbIcon, MessageIcon, QuestionIcon, SparkleIcon } from "../shared/icons";

/** The small parts the screens of the feedback are made of. Everything that can be pressed is `data-nav`, which is what the remote's arrow keys walk over. */

export function Chip({ selected, onClick, children, testId, title }: { selected: boolean; onClick: () => void; children: ReactNode; testId?: string; title?: string }) {
  return (
    <button type="button" role="radio" aria-checked={selected} className={`fb-chip${selected ? " is-on" : ""}`} data-nav data-testid={testId} title={title} onClick={onClick}>
      {children}
    </button>
  );
}

/** A choice of one, said as a group (the chips are its radios). */
export function Choice({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="fb-choice" role="radiogroup" aria-label={label} data-testid={testId}>
      {children}
    </div>
  );
}

export function Switch({ on, onChange, label, hint, testId }: { on: boolean; onChange: (on: boolean) => void; label: string; hint?: string; testId?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="fb-switch" data-nav data-testid={testId} onClick={() => onChange(!on)}>
      <span className="fb-switch-text">
        <span className="fb-switch-label">{label}</span>
        {hint ? <span className="fb-switch-hint">{hint}</span> : null}
      </span>
      <span className="fb-switch-track" aria-hidden="true" />
    </button>
  );
}

export function Section({ title, hint, children, testId }: { title: string; hint?: string | undefined; children: ReactNode; testId?: string }) {
  return (
    <section className="fb-section" data-testid={testId}>
      <h3>{title}</h3>
      {hint ? <p className="fb-hint">{hint}</p> : null}
      {children}
    </section>
  );
}

export const KIND_ICONS: Record<FeedbackKind, typeof BugIcon> = { bug: BugIcon, improve: SparkleIcon, idea: BulbIcon, other: MessageIcon };

export function KindIcon({ kind }: { kind: FeedbackKind }) {
  const Icon = KIND_ICONS[kind] ?? QuestionIcon;
  return <Icon />;
}

/** Where a report is in the team's hands, as a small label. */
export function StatusChip({ status }: { status: FeedbackStatus }) {
  const t = useT();
  return <span className={`fb-status fb-status-${status}`}>{t(`feedback.status.${status}` as Key)}</span>;
}

/** When something happened, as a person says it (today, yesterday, a date). */
export function when(at: number, now: number = Date.now(), language?: string): string {
  const age = now - at;
  if (age < 60_000) return "";
  try {
    const rtf = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
    if (age < 3_600_000) return rtf.format(-Math.floor(age / 60_000), "minute");
    if (age < 86_400_000) return rtf.format(-Math.floor(age / 3_600_000), "hour");
    if (age < 7 * 86_400_000) return rtf.format(-Math.floor(age / 86_400_000), "day");
    return new Date(at).toLocaleDateString(language, { day: "numeric", month: "short" });
  } catch {
    return new Date(at).toLocaleDateString();
  }
}
