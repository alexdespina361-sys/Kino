import type { ChatLine, ChatNotice, ChatTalk, Friend } from "../../shared";
import { t } from "../i18n";
import { gifOf } from "./gifs";
import { dayOf, stampOf } from "./state";
import { stickerOf } from "./stickers";
import { titleIn } from "./titles";

export interface TalkRow {
  friend: Friend;
  last?: ChatTalk["last"];
  at: number;
  unread: number;
  muted: boolean;
}

export function talkRows(friends: readonly Friend[], talks: readonly ChatTalk[], waiting: readonly ChatNotice[]): TalkRow[] {
  const rows = friends.map((friend): TalkRow => {
    const talk = talks.find((each) => each.friend === friend.id);
    const notice = waiting.find((each) => each.friend === friend.id);
    const muted = talk?.muted === true;
    return {
      friend,
      ...(talk ? { last: talk.last } : {}),
      at: Math.max(talk?.last.at ?? 0, notice?.at ?? 0),
      unread: notice ? notice.count : muted ? talk.unread : 0,
      muted,
    };
  });
  return rows.sort((a, b) => b.at - a.at || a.friend.name.localeCompare(b.friend.name));
}

export function previewOf(last: Pick<ChatLine, "text" | "sticker" | "mine">): string {
  const said = last.sticker || stickerOf(last.text) ? t("chats.sticker") : gifOf(last.text) ? t("chats.gif") : titled(last.text);
  return last.mine ? t("chats.mine", { text: said }) : said;
}

function titled(text: string): string {
  const title = titleIn(text);
  if (!title) return text.replace(/\s+/g, " ").trim();
  return `\u{1F3AC} ${title.rest || t("chats.aTitle")}`;
}

export function whenOf(at: number, now: number, language: string): string {
  if (at <= 0) return "";
  return new Date(at).toDateString() === new Date(now).toDateString() ? stampOf(at, language) : dayOf(at, now, language);
}
