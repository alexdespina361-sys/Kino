import { CHAT_TEXT_MAX } from "../../shared";
import type { useT } from "../i18n";
import { gifOf } from "./gifs";
import type { ChatProblem } from "./state";
import { stickerOf } from "./stickers";

export type ChatT = ReturnType<typeof useT>;

export function quoteOf(t: ChatT, text: string): string {
  if (gifOf(text)) return t("chat.gifAlt");
  return stickerOf(text) ? t("chat.stickerSaid", { emoji: text.trim() }) : text;
}

export function problemText(t: ChatT, problem: ChatProblem, name: string, report = false): string {
  switch (problem) {
    case "offline":
      return t("error.offline");
    case "rate_limited":
      return t("chat.error.rate_limited");
    case "chat_off":
      return t("chat.error.chat_off", { name });
    case "friends_off":
      return t("error.friends_off");
    case "not_friends":
      return t("error.not_friends");
    case "too_long":
      return t("chat.error.too_long", { max: CHAT_TEXT_MAX });
    case "empty":
      return t("chat.error.empty");
    case "gone":
      return t(report ? "chat.reportNone" : "chat.error.gone");
    case "changed":
      return t("chat.reportChanged");
    default:
      return t("error.generic");
  }
}
