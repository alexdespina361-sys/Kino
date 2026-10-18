import {
  cleanText,
  FEEDBACK_DETAILS_FOR,
  FEEDBACK_LIMITS,
  type FeedbackArea,
  type FeedbackAttachmentInput,
  type FeedbackContext,
  type FeedbackDetailKey,
  type FeedbackFrequency,
  type FeedbackKind,
  type FeedbackSend,
  type FeedbackSeverity,
} from "../../shared";
import type { Include } from "./diagnostics";
import type { Draft } from "./receipts";

/** What is filled in on the form, apart from the pictures (those are `Piece`s, see images.ts). */
export interface FormState {
  kind: FeedbackKind;
  area: FeedbackArea;
  /** The person chose the place themselves (else it is the page's guess, and says so). */
  areaChosen: boolean;
  text: string;
  details: Partial<Record<FeedbackDetailKey, string>>;
  severity?: FeedbackSeverity | undefined;
  frequency?: FeedbackFrequency | undefined;
  include: Include;
  /** The sender wants the answer in the app. */
  answer: boolean;
}

export const ALL_ON: Include = { device: true, steps: true, errors: true, playback: true };

export function newForm(kind: FeedbackKind, area: FeedbackArea, areaChosen: boolean, text = ""): FormState {
  return { kind, area, areaChosen, text, details: {}, include: { ...ALL_ON }, answer: true };
}

export function fromDraft(draft: Draft): FormState {
  return { ...newForm(draft.kind, draft.area, true, draft.text), details: { ...draft.details }, severity: draft.severity, frequency: draft.frequency };
}

export function toDraft(form: FormState, at: number): Draft {
  return { kind: form.kind, area: form.area, text: form.text, details: form.details, severity: form.severity, frequency: form.frequency, at };
}

/** The details a form of this kind asks for (a kind that was changed after some were written does not send the ones it does not ask). */
export function detailsOf(form: FormState): Partial<Record<FeedbackDetailKey, string>> | undefined {
  const kept: Partial<Record<FeedbackDetailKey, string>> = {};
  for (const key of FEEDBACK_DETAILS_FOR[form.kind]) {
    const value = cleanText(form.details[key] ?? "", FEEDBACK_LIMITS.detail);
    if (value) kept[key] = value;
  }
  return Object.keys(kept).length > 0 ? kept : undefined;
}

/** Whether there is something to send: words of any kind, or a picture. */
export function hasContent(form: FormState, pieces: number): boolean {
  return form.text.trim() !== "" || detailsOf(form) !== undefined || pieces > 0;
}

/** Whether the form has anything on it that would be lost by closing (words are kept as a draft; pictures are not). */
export function hasWords(form: FormState): boolean {
  return form.text.trim() !== "" || Object.values(form.details).some((value) => (value ?? "").trim() !== "");
}

/**
 * Whether a form that a screen opened itself (the card of a title that would not play, with the words that card gave it) has anything on it that the
 * person wrote. That kind of form never showed them the draft they may have kept, so until they have written something it keeps nothing, and
 * closing it empty leaves that draft where it was (the form of the first screen, where they chose to begin again, clears it).
 */
export function writtenByThePerson(form: FormState, seed: string): boolean {
  const text = form.text.trim();
  return (text !== "" && text !== seed.trim()) || Object.values(form.details).some((value) => (value ?? "").trim() !== "");
}

export function buildPayload(form: FormState, key: string, attachments: FeedbackAttachmentInput[], context: FeedbackContext): FeedbackSend {
  const details = detailsOf(form);
  const bug = form.kind === "bug";
  return {
    key,
    kind: form.kind,
    area: form.area,
    message: cleanText(form.text, FEEDBACK_LIMITS.text),
    ...(details ? { details } : {}),
    ...(bug && form.severity ? { severity: form.severity } : {}),
    ...(bug && form.frequency ? { frequency: form.frequency } : {}),
    answer: form.answer,
    attachments,
    context,
  };
}
