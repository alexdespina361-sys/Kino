import { CHAT_TEXT_MAX } from "../../shared";
import type { useT } from "../i18n";
import type { ChatProblem } from "./state";

/** `t` as the views of the chat get it (the website's own: the chat's words are in its dictionaries, see i18n/chat.en.ts). */
export type ChatT = ReturnType<typeof useT>;

/** What to say of something that went wrong, quietly, in the words of the person. `report`: it went wrong while a report was made, where "gone" means there is nothing to send. */
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
