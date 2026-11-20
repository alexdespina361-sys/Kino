import { describe, expect, it } from "vitest";
import type { ChatTalk, Friend } from "../../shared";
import { chatsApart, withoutChat } from "./apart";
import { previewOf, talkRows, whenOf } from "./talks";

const friend = (id: string, name = id): Friend => ({ id, name, avatar: "fox", since: 1, on: true, lists: true, ratings: true, activity: false, inbox: true });
const talk = (id: string, at: number, extra: Partial<ChatTalk> = {}): ChatTalk => ({ friend: id, last: { id: 1, at, mine: false, text: "hi" }, unread: 0, ...extra });

describe("the list of chats", () => {
  it("puts the newest message first, then the friends without one by name", () => {
    const rows = talkRows([friend("b", "Bea"), friend("z", "Zoe"), friend("a", "Ana"), friend("k", "Kim")], [talk("z", 100), talk("k", 300)], []);
    expect(rows.map((row) => row.friend.id)).toEqual(["k", "z", "a", "b"]);
    expect(rows[2]?.last).toBeUndefined();
  });

  it("counts what the bell would have counted, and a newer notice moves its friend up", () => {
    const rows = talkRows([friend("a"), friend("b")], [talk("a", 500, { unread: 3 }), talk("b", 100, { unread: 2 })], [{ friend: "b", count: 2, at: 900 }]);
    expect(rows.map((row) => [row.friend.id, row.unread])).toEqual([
      ["b", 2],
      ["a", 0],
    ]);
  });

  it("still counts a muted chat, which the bell leaves out, and says it is muted", () => {
    const [row] = talkRows([friend("a")], [talk("a", 500, { unread: 4, muted: true })], []);
    expect(row).toMatchObject({ unread: 4, muted: true });
  });

  it("shows only for two friends or more, and takes the chats out of the bell", () => {
    const state = { friends: [friend("a")], inbox: [], activity: [], invites: [], requests: [], sent: [], chat: [{ friend: "a", count: 1, at: 1 }] };
    expect(chatsApart(null)).toBe(false);
    expect(chatsApart(state)).toBe(false);
    expect(chatsApart({ ...state, friends: [friend("a"), friend("b")] })).toBe(true);
    expect(withoutChat(state)).not.toHaveProperty("chat");
    expect(state.chat).toHaveLength(1);
  });
});

describe("the last message, as the list shows it", () => {
  it("is the text on one line, with who sent it when it was this profile", () => {
    expect(previewOf({ text: "see you\n at  nine", mine: false })).toBe("see you at nine");
    expect(previewOf({ text: "ok", mine: true })).toBe("You: ok");
  });

  it("names a sticker, a GIF and a title instead of showing them", () => {
    expect(previewOf({ text: "\u{1F37F}", mine: false })).toBe("Sticker");
    expect(previewOf({ text: "", sticker: "abc", mine: true })).toBe("You: Sticker");
    expect(previewOf({ text: "https://static.klipy.com/a/b.gif", mine: false })).toBe("GIF");
    expect(previewOf({ text: "The Matrix (1999) https://kino4tv.com/tv?title=movie-603", mine: false })).toBe("\u{1F3AC} The Matrix (1999)");
    expect(previewOf({ text: "https://kino4tv.com/tv?title=movie-603", mine: false })).toBe("\u{1F3AC} A title");
  });

  it("has its time today and its day before that", () => {
    const now = new Date(2026, 10, 20, 18, 0).getTime();
    expect(whenOf(new Date(2026, 10, 20, 9, 5).getTime(), now, "en")).toMatch(/9:05|09:05/);
    expect(whenOf(new Date(2026, 10, 19, 9, 5).getTime(), now, "en")).toBe("yesterday");
    expect(whenOf(0, now, "en")).toBe("");
  });
});
