import { useSyncExternalStore } from "react";
import type { FeedbackArea, FeedbackKind } from "../../shared";
import { t } from "../i18n";

export interface FeedbackOptions {
  kind?: FeedbackKind;
  area?: FeedbackArea;
  text?: string;
  screen?: "mine";
}

export interface FeedbackUi {
  open: boolean;
  options: FeedbackOptions;
  session: number;
}

let state: FeedbackUi = { open: false, options: {}, session: 0 };
const listeners = new Set<() => void>();
const change = (next: FeedbackUi) => {
  state = next;
  listeners.forEach((listener) => listener());
};

export const openFeedback = (options: FeedbackOptions = {}): void => change({ open: true, options, session: state.session + 1 });
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
