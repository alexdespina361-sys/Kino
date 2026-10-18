import { describe, expect, it } from "vitest";
import type { Friend, FriendsState } from "../../shared";
import { chatWaiting, waitingFrom } from "./notices";

const friend = (id: string): Friend => ({ id, name: id, avatar: "fox", since: 1, on: true, lists: true, ratings: true, activity: false, inbox: true });
const state = (chat: FriendsState["chat"], ids = ["sam", "kim"]): FriendsState => ({ friends: ids.map(friend), inbox: [], activity: [], invites: [], requests: [], sent: [], ...(chat ? { chat } : {}) });

describe("what waits in the chats", () => {
  it("is nothing before the server has answered, and nothing from a server that says nothing of chats", () => {
    expect(chatWaiting(null)).toEqual([]);
    expect(chatWaiting(state(undefined))).toEqual([]);
    expect(waitingFrom(null, "sam")).toBe(0);
  });

  it("is told a friend at a time, the newest first", () => {
    const waiting = state([
      { friend: "sam", count: 2, at: 10 },
      { friend: "kim", count: 1, at: 30 },
    ]);
    expect(chatWaiting(waiting).map((notice) => notice.friend)).toEqual(["kim", "sam"]);
    expect(waitingFrom(waiting, "sam")).toBe(2);
    expect(waitingFrom(waiting, "kim")).toBe(1);
    expect(waitingFrom(waiting, "lee")).toBe(0);
  });

  it("leaves out a friend this profile no longer has", () => {
    const waiting = state([{ friend: "gone", count: 3, at: 10 }]);
    expect(chatWaiting(waiting)).toEqual([]);
    expect(waitingFrom(waiting, "gone")).toBe(0);
  });

  it("does not change the answer it was given", () => {
    const chat = [
      { friend: "sam", count: 2, at: 10 },
      { friend: "kim", count: 1, at: 30 },
    ];
    chatWaiting(state(chat));
    expect(chat.map((notice) => notice.friend)).toEqual(["sam", "kim"]);
  });
});
