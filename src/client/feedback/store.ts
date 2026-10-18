import { useSyncExternalStore } from "react";
import type { FeedbackArea, FeedbackKind } from "../../shared";
import { t } from "../i18n";

/**
 * Whether the feedback is open, and how: the screens open it from a button (the profile's, next to Settings) or from a problem they found
 * themselves (a film that will not play). This is all that the rest of the app needs to know about it: the form itself is a chunk of its own, loaded
 * when it is first opened (see FeedbackGate.tsx).
 */
export interface FeedbackOptions {
  /** Straight to the form for this kind (the first screen, where the kind is chosen, is skipped). */
  kind?: FeedbackKind;
  /** Where the problem is, when the screen that opens it knows better than a guess does. */
  area?: FeedbackArea;
  /** Words to begin with (what an error card says went wrong). */
  text?: string;
  /** "Your messages" instead of the first screen. */
  screen?: "mine";
}

export interface FeedbackUi {
  open: boolean;
  options: FeedbackOptions;
  /** Goes up with each opening, so what is keyed by it begins afresh. */
  session: number;
}

let state: FeedbackUi = { open: false, options: {}, session: 0 };
const listeners = new Set<() => void>();
const change = (next: FeedbackUi) => {
  state = next;
  listeners.forEach((listener) => listener());
};

export const openFeedback = (options: FeedbackOptions = {}): void => change({ open: true, options, session: state.session + 1 });
/**
 * The form for a title that would not play, from the card or the line that says so: a problem, in its place, with what the screen said as the
 * words to begin with (so a remote that cannot type well can send it as it is). What was playing and why it stopped go along by themselves.
 */
export const reportWontPlay = (reason: string): void => openFeedback({ kind: "bug", area: "wontplay", text: t("feedback.seed.wontplay", { reason }) });
export const closeFeedback = (): void => {
  if (state.open) change({ ...state, open: false });
};
export const feedbackNow = (): FeedbackUi => state;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
export const useFeedbackUi = (): FeedbackUi => useSyncExternalStore(subscribe, feedbackNow, feedbackNow);
