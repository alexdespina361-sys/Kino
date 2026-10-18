import { useMemo, useState } from "react";
import { FEEDBACK_AREA_GROUPS, FEEDBACK_DETAILS_FOR, FEEDBACK_FREQUENCIES, FEEDBACK_LIMITS, FEEDBACK_SEVERITIES, type FeedbackArea } from "../../shared";
import { useT, type Key } from "../i18n";
import { ChevronIcon, SendIcon, ShieldIcon } from "../shared/icons";
import type { SendFailure } from "./api";
import { collectContext, type Include } from "./diagnostics";
import type { FormState } from "./formState";
import { hasContent } from "./formState";
import { Pictures, type PicturesProps } from "./Pictures";
import { Choice, Chip, Section, Switch } from "./ui";

export type SendState = { phase: "idle" } | { phase: "sending"; waking: boolean } | { phase: "failed"; reason: SendFailure; retryAfter?: number };

export interface FormProps {
  form: FormState;
  onChange: (patch: Partial<FormState>) => void;
  pictures: Omit<PicturesProps, "pieces">;
  pieces: PicturesProps["pieces"];
  send: SendState;
  onSend: () => void;
  onWhere: () => void;
  signedIn: boolean;
}

/** The group a place of the app is listed under, for "Playing · Subtitles". */
export const groupOf = (area: FeedbackArea) => FEEDBACK_AREA_GROUPS.find((group) => (group.areas as readonly string[]).includes(area))?.id ?? "general";

const INCLUDES: Array<keyof Include> = ["device", "steps", "errors", "playback"];

const counter = (value: string, max: number) => (value.length > max * 0.8 ? `${value.length} / ${max}` : null);

/** The form for one kind of feedback: where it is, what it is, the pictures, what the page may say about itself, and the way to answer. */
export function FormScreen({ form, onChange, pictures, pieces, send, onSend, onWhere, signedIn }: FormProps) {
  const t = useT();
  const questions = FEEDBACK_DETAILS_FOR[form.kind];
  const answered = questions.some((key) => (form.details[key] ?? "").trim() !== "");
  const [asking, setAsking] = useState(answered);
  const [previewing, setPreviewing] = useState(false);
  const ready = hasContent(form, pieces.length);
  const sending = send.phase === "sending";
  // What would go with the report, as it is now (read when the preview is opened and whenever a part is switched).
  const preview = useMemo(() => (previewing ? JSON.stringify(collectContext(form.include, { signedIn }), null, 1) : ""), [previewing, form.include, signedIn]);

  const setInclude = (key: keyof Include, on: boolean) => onChange({ include: { ...form.include, [key]: on } });
  const left = counter(form.text, FEEDBACK_LIMITS.text);

  return (
    <>
      <div className="fb-body" data-testid="fb-form">
        <Section title={t("feedback.where")} testId="fb-where">
          <button type="button" className="fb-where-button" data-nav data-testid="fb-where-button" onClick={onWhere}>
            <span className="fb-where-text">
              <strong>{t(`feedback.area.${form.area}` as Key)}</strong>
              <small>
                {t(`feedback.group.${groupOf(form.area)}` as Key)}
                {form.areaChosen ? "" : ` · ${t("feedback.whereGuess")}`}
              </small>
            </span>
            <span className="fb-where-change">
              {t("feedback.whereChange")}
              <ChevronIcon />
            </span>
          </button>
        </Section>

        <Section title={t(`feedback.say.${form.kind}` as Key)}>
          <textarea
            className="fb-text"
            rows={5}
            maxLength={FEEDBACK_LIMITS.text}
            value={form.text}
            placeholder={t(`feedback.say.${form.kind}.hint` as Key)}
            aria-label={t(`feedback.say.${form.kind}` as Key)}
            data-nav
            data-autofocus
            data-testid="fb-text"
            onChange={(event) => onChange({ text: event.target.value })}
          />
          {left ? <small className="fb-count">{left}</small> : null}
        </Section>

        {questions.length > 0 ? (
          <div className="fb-more">
            <button type="button" className="fb-disclose" aria-expanded={asking} data-nav data-testid="fb-questions" onClick={() => setAsking(!asking)}>
              <ChevronIcon className={asking ? "fb-rot" : ""} />
              <span>{t("feedback.questions")}</span>
              <small>{t("common.optional")}</small>
            </button>
            {asking ? (
              <div className="fb-questions">
                {questions.map((key) => (
                  <label key={key} className="fb-field">
                    <span>{t(`feedback.detail.${key}` as Key)}</span>
                    <textarea
                      rows={3}
                      maxLength={FEEDBACK_LIMITS.detail}
                      value={form.details[key] ?? ""}
                      placeholder={t(`feedback.detail.${key}.hint` as Key)}
                      data-nav
                      data-testid={`fb-detail-${key}`}
                      onChange={(event) => onChange({ details: { ...form.details, [key]: event.target.value } })}
                    />
                  </label>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {form.kind === "bug" ? (
          <>
            <Section title={t("feedback.severity")}>
              <Choice label={t("feedback.severity")} testId="fb-severity">
                {FEEDBACK_SEVERITIES.map((value) => (
                  <Chip key={value} selected={form.severity === value} testId={`fb-severity-${value}`} onClick={() => onChange({ severity: form.severity === value ? undefined : value })}>
                    {t(`feedback.severity.${value}` as Key)}
                  </Chip>
                ))}
              </Choice>
            </Section>
            <Section title={t("feedback.frequency")}>
              <Choice label={t("feedback.frequency")} testId="fb-frequency">
                {FEEDBACK_FREQUENCIES.map((value) => (
                  <Chip key={value} selected={form.frequency === value} testId={`fb-frequency-${value}`} onClick={() => onChange({ frequency: form.frequency === value ? undefined : value })}>
                    {t(`feedback.frequency.${value}` as Key)}
                  </Chip>
                ))}
              </Choice>
            </Section>
          </>
        ) : null}

        <Pictures pieces={pieces} {...pictures} />

        <Section title={t("feedback.include")} hint={t("feedback.includeHint")} testId="fb-include">
          <div className="fb-switches">
            {INCLUDES.map((key) => (
              <Switch key={key} on={form.include[key]} label={t(`feedback.include.${key}` as Key)} hint={t(`feedback.include.${key}.hint` as Key)} testId={`fb-include-${key}`} onChange={(on) => setInclude(key, on)} />
            ))}
          </div>
          <button type="button" className="fb-disclose" aria-expanded={previewing} data-nav data-testid="fb-preview" onClick={() => setPreviewing(!previewing)}>
            <ChevronIcon className={previewing ? "fb-rot" : ""} />
            <span>{t("feedback.preview")}</span>
          </button>
          {previewing ? (
            <pre className="fb-preview" tabIndex={0} data-nav data-testid="fb-preview-text" aria-label={t("feedback.previewLabel")}>
              {preview === "{}" ? t("feedback.previewNothing") : preview}
            </pre>
          ) : null}
          <p className="fb-privacy">
            <ShieldIcon />
            <span>{t("feedback.privacy")}</span>
          </p>
        </Section>

        <Section title={t("feedback.answerTitle")} testId="fb-answer">
          <Switch on={form.answer} label={t("feedback.answer")} hint={signedIn ? t("feedback.answerHintAccount") : t("feedback.answerHint")} testId="fb-answer-switch" onChange={(on) => onChange({ answer: on })} />
        </Section>
      </div>

      <div className="fb-foot">
        {send.phase === "sending" && send.waking ? (
          <p className="fb-working" role="status" data-testid="fb-waking">
            <span className="spinner" /> {t("feedback.waking")}
          </p>
        ) : null}
        {send.phase === "failed" ? (
          <p className="fb-problem" role="alert" data-testid="fb-send-error">
            {t(`feedback.error.${send.reason}` as Key, { seconds: send.retryAfter ?? 60 })}
          </p>
        ) : null}
        <button type="button" className="fb-send" data-nav data-testid="fb-send" disabled={!ready || sending} onClick={onSend}>
          {sending ? <span className="spinner" /> : <SendIcon />}
          <span>{sending ? t("feedback.sending") : send.phase === "failed" ? t("common.retry") : t("feedback.send")}</span>
        </button>
        {!ready ? <small className="fb-needs">{t("feedback.needs")}</small> : null}
      </div>
    </>
  );
}
