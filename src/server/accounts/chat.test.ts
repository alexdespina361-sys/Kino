import { describe, expect, it } from "vitest";
import { CHAT_KEEP_MAX, CHAT_KEEP_MS, CHAT_REPORT_LINES, CHAT_SENDS_PER_MINUTE, CHAT_TEXT_MAX } from "../../shared/chat";
import { ChatBook, type ChatError, type ChatOutcome, type ChatView } from "./chat";

const pair = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** A book with a clock to move, a say in who is friends with whom and who takes messages, and a record of what it asked the store to write down. */
function world() {
  const clock = { now: 1_700_000_000_000 };
  const friends = new Set<string>();
  const off = new Set<string>(); // (friends turned off)
  const quiet = new Set<string>(); // ("Friends can message me" turned off)
  const written = new Set<string>();
  const dropped = new Set<string>();
  const host = {
    now: () => clock.now,
    touch: (key: string) => {
      written.add(key);
      dropped.delete(key);
    },
    drop: (key: string) => {
      dropped.add(key);
      written.delete(key);
    },
    areFriends: (a: string, b: string) => friends.has(pair(a, b)),
    on: (id: string) => !off.has(id),
    takes: (id: string) => !off.has(id) && !quiet.has(id),
  };
  const chat = new ChatBook(host);
  const befriend = (a: string, b: string) => void friends.add(pair(a, b));
  return { chat, clock, friends, off, quiet, written, dropped, host, befriend };
}

/** Alex, Sam and Robin; Alex is friends with both. */
function trio() {
  const w = world();
  w.befriend("alex", "sam");
  w.befriend("alex", "robin");
  return w;
}

const value = <T>(outcome: ChatOutcome<T>): T => {
  if (!outcome.ok) throw new Error(`refused: ${outcome.error}`);
  return outcome.value;
};
const refusal = (outcome: ChatOutcome<unknown>): ChatError | undefined => (outcome.ok ? undefined : outcome.error);
const texts = (view: ChatView) => view.lines.map((line) => line.text);

describe("who may write to whom", () => {
  it("is friends, and nobody else", () => {
    const { chat } = trio();
    expect(refusal(chat.send("alex", "sam", "hi"))).toBeUndefined();
    expect(refusal(chat.send("sam", "robin", "hi"))).toBe("not_friends"); // (both are Alex's friends, not each other's)
    expect(refusal(chat.send("alex", "stranger", "hi"))).toBe("not_friends");
    expect(refusal(chat.send("alex", "alex", "hi"))).toBe("not_friends");
    expect(refusal(chat.read("sam", "robin"))).toBe("not_friends");
    expect(refusal(chat.takeBack("sam", "robin", 1))).toBe("not_friends");
    expect(refusal(chat.mute("sam", "robin", true))).toBe("not_friends");
    expect(refusal(chat.lastLines("sam", "robin"))).toBe("not_friends");
  });

  it("is a profile with friends turned on, to a friend with friends turned on", () => {
    const { chat, off } = trio();
    off.add("sam");
    expect(refusal(chat.send("alex", "sam", "hi"))).toBe("chat_off"); // (a friend who has turned friends off takes nothing)
    off.delete("sam");
    off.add("alex");
    expect(refusal(chat.send("alex", "sam", "hi"))).toBe("friends_off");
    off.delete("alex");
    expect(refusal(chat.send("alex", "sam", "hi"))).toBeUndefined();
  });

  it("is a friend who takes messages: one who does not is told so, and the chat can still be read", () => {
    const { chat, quiet } = trio();
    value(chat.send("alex", "sam", "hi"));
    quiet.add("sam");
    expect(refusal(chat.send("alex", "sam", "are you there?"))).toBe("chat_off");
    const view = value(chat.read("alex", "sam"));
    expect(view.open).toBe(false);
    expect(texts(view)).toEqual(["hi"]);
    // (and the switch is about messages to them: they can still write, as a profile that takes no titles can still send some)
    expect(refusal(chat.send("sam", "alex", "hello"))).toBeUndefined();
    quiet.delete("sam");
    expect(value(chat.read("alex", "sam")).open).toBe(true);
    expect(refusal(chat.send("alex", "sam", "are you there?"))).toBeUndefined();
  });
});

describe("what may be written", () => {
  it("is kept as plain text made fit to show: trimmed, in one line, without characters that hide or turn text around", () => {
    const { chat } = trio();
    const view = value(chat.send("alex", "sam", "  hello\n\tthere ‮evil​  "));
    expect(texts(view)).toEqual(["hello there evil"]);
  });

  it("is not empty, or only blanks, or only what cannot be seen", () => {
    const { chat, written } = trio();
    for (const text of ["", "   ", "\n\t", "​‮"]) expect(refusal(chat.send("alex", "sam", text))).toBe("empty");
    expect(written.size).toBe(0);
  });

  it("is at most 500 characters once cleaned, and one that is longer is refused whole", () => {
    const { chat } = trio();
    expect(refusal(chat.send("alex", "sam", "x".repeat(CHAT_TEXT_MAX)))).toBeUndefined();
    expect(refusal(chat.send("alex", "sam", "x".repeat(CHAT_TEXT_MAX + 1)))).toBe("too_long");
    expect(value(chat.read("alex", "sam")).lines).toHaveLength(1);
  });
});

describe("a chat", () => {
  it("shows each side its own messages as theirs, oldest first, with a number that names each", () => {
    const { chat, clock } = trio();
    value(chat.send("alex", "sam", "one"));
    clock.now += 1000;
    value(chat.send("sam", "alex", "two"));
    clock.now += 1000;
    const last = value(chat.send("alex", "sam", "three"));
    expect(last.lines.map((line) => [line.text, line.mine])).toEqual([["one", true], ["two", false], ["three", true]]);
    expect(new Set(last.lines.map((line) => line.id)).size).toBe(3);
    expect([...last.lines].sort((a, b) => a.id - b.id)).toEqual(last.lines);
    expect(value(chat.read("sam", "alex")).lines.map((line) => [line.text, line.mine])).toEqual([["one", false], ["two", true], ["three", false]]);
    expect(last.lines.map((line) => line.at)).toEqual([1_700_000_000_000, 1_700_000_001_000, 1_700_000_002_000]);
  });

  it("has a revision that goes up with every change and stays the same when there is none", () => {
    const { chat, clock } = trio();
    const empty = value(chat.read("alex", "sam"));
    expect(empty).toEqual({ rev: 0, open: true, muted: false, lines: [] });
    const first = value(chat.send("alex", "sam", "one"));
    expect(first.rev).toBeGreaterThan(empty.rev);
    expect(value(chat.read("sam", "alex")).rev).toBe(first.rev);
    expect(value(chat.read("alex", "sam")).rev).toBe(first.rev);
    clock.now += 5;
    const second = value(chat.send("sam", "alex", "two"));
    expect(second.rev).toBeGreaterThan(first.rev);
    // (two in one instant are still two numbers)
    const third = value(chat.send("sam", "alex", "three"));
    expect(third.rev).toBeGreaterThan(second.rev);
    expect(new Set(third.lines.map((line) => line.id)).size).toBe(3);
  });

  it("is a different chat for each pair of friends", () => {
    const { chat } = trio();
    value(chat.send("alex", "sam", "for Sam"));
    value(chat.send("alex", "robin", "for Robin"));
    expect(texts(value(chat.read("alex", "sam")))).toEqual(["for Sam"]);
    expect(texts(value(chat.read("robin", "alex")))).toEqual(["for Robin"]);
  });

  it("is kept in one document for the pair, whichever of them is asked", () => {
    const { chat, written } = trio();
    value(chat.send("sam", "alex", "one"));
    value(chat.send("alex", "sam", "two"));
    expect([...written]).toEqual(["chat:alex:sam"]);
  });
});

describe("how much is kept", () => {
  it("is the newest 200 messages of a pair", () => {
    const { chat, clock } = trio();
    for (let i = 1; i <= CHAT_KEEP_MAX + 5; i++) {
      value(chat.send(i % 2 ? "alex" : "sam", i % 2 ? "sam" : "alex", `message ${i}`));
      clock.now += 4000;
    }
    const view = value(chat.read("alex", "sam"));
    expect(view.lines).toHaveLength(CHAT_KEEP_MAX);
    expect(view.lines[0]?.text).toBe("message 6");
    expect(view.lines.at(-1)?.text).toBe(`message ${CHAT_KEEP_MAX + 5}`);
  });

  it("is thirty days of them: an older message is let go, a newer one stays", () => {
    const { chat, clock, dropped } = trio();
    value(chat.send("alex", "sam", "old"));
    clock.now += 10 * 24 * 3600 * 1000;
    const before = value(chat.send("sam", "alex", "newer"));
    clock.now += CHAT_KEEP_MS - 10 * 24 * 3600 * 1000 - 1;
    expect(texts(value(chat.read("alex", "sam")))).toEqual(["old", "newer"]);
    clock.now += 1;
    const after = value(chat.read("alex", "sam"));
    expect(texts(after)).toEqual(["newer"]);
    expect(after.rev).toBeGreaterThan(before.rev); // (a screen that has the old one is told)
    clock.now += 10 * 24 * 3600 * 1000;
    expect(value(chat.read("alex", "sam")).lines).toEqual([]);
    expect(dropped.has("chat:alex:sam")).toBe(true); // (a chat with nothing in it is not kept)
  });

  it("lets go of what ran out while the server was off, when it starts, and keeps the rest", () => {
    const first = trio();
    value(first.chat.send("alex", "sam", "old"));
    first.clock.now += 20 * 24 * 3600 * 1000;
    value(first.chat.send("sam", "alex", "recent"));
    const doc = JSON.parse(JSON.stringify(first.chat.docFor("chat:alex:sam")));

    const later = trio();
    later.clock.now = first.clock.now + 15 * 24 * 3600 * 1000;
    later.chat.load("chat:alex:sam", doc);
    expect(texts(value(later.chat.read("alex", "sam")))).toEqual(["recent"]);
    expect(later.written.has("chat:alex:sam")).toBe(true);

    const gone = trio();
    gone.clock.now = first.clock.now + 60 * 24 * 3600 * 1000;
    gone.chat.load("chat:alex:sam", doc);
    expect(gone.dropped.has("chat:alex:sam")).toBe(true);
    expect(value(gone.chat.read("alex", "sam")).lines).toEqual([]);
  });
});

describe("how often", () => {
  it("is twenty messages a minute from one sender, and then it says how long to wait", () => {
    const { chat, clock } = trio();
    for (let i = 0; i < CHAT_SENDS_PER_MINUTE; i++) value(chat.send("alex", "sam", `message ${i}`));
    const refused = chat.send("alex", "sam", "one too many");
    expect(refused).toEqual({ ok: false, error: "rate_limited", waitMs: 60_000 });
    expect(value(chat.read("sam", "alex")).lines).toHaveLength(CHAT_SENDS_PER_MINUTE);
    clock.now += 59_999;
    expect(refusal(chat.send("alex", "sam", "still too soon"))).toBe("rate_limited");
    clock.now += 1;
    expect(refusal(chat.send("alex", "sam", "now"))).toBeUndefined();
  });

  it("is counted for each sender: one who is quick does not slow the friend who answers", () => {
    const { chat } = trio();
    for (let i = 0; i < CHAT_SENDS_PER_MINUTE; i++) value(chat.send("alex", "sam", `message ${i}`));
    expect(refusal(chat.send("alex", "robin", "to somebody else"))).toBe("rate_limited"); // (the sender's, not the chat's)
    expect(refusal(chat.send("sam", "alex", "hi"))).toBeUndefined();
  });

  it("is not used up by a message that was refused", () => {
    const { chat, quiet } = trio();
    for (let i = 0; i < 3 * CHAT_SENDS_PER_MINUTE; i++) chat.send("alex", "sam", "   ");
    quiet.add("sam");
    for (let i = 0; i < 3 * CHAT_SENDS_PER_MINUTE; i++) chat.send("alex", "sam", "hello");
    quiet.delete("sam");
    for (let i = 0; i < CHAT_SENDS_PER_MINUTE; i++) expect(refusal(chat.send("alex", "sam", "hello"))).toBeUndefined();
  });
});

describe("taking a message back", () => {
  it("is for the one who wrote it, and it is gone for both", () => {
    const { chat } = trio();
    const sent = value(chat.send("alex", "sam", "oops"));
    value(chat.send("sam", "alex", "fine"));
    const id = sent.lines[0]!.id;
    expect(refusal(chat.takeBack("sam", "alex", id))).toBe("gone"); // (not Sam's to take back)
    const after = value(chat.takeBack("alex", "sam", id));
    expect(texts(after)).toEqual(["fine"]);
    expect(texts(value(chat.read("sam", "alex")))).toEqual(["fine"]);
    expect(after.rev).toBeGreaterThan(sent.rev); // (a screen that has it is told)
    expect(refusal(chat.takeBack("alex", "sam", id))).toBe("gone");
    expect(refusal(chat.takeBack("alex", "sam", 12345))).toBe("gone");
  });

  it("takes the chat with it when it was the only message", () => {
    const { chat, dropped } = trio();
    const sent = value(chat.send("alex", "sam", "oops"));
    value(chat.takeBack("alex", "sam", sent.lines[0]!.id));
    expect(dropped.has("chat:alex:sam")).toBe(true);
    expect(value(chat.read("alex", "sam")).lines).toEqual([]);
  });

  it("does not make what Sam has not read count for Alex any more", () => {
    const { chat } = trio();
    const sent = value(chat.send("alex", "sam", "oops"));
    expect(chat.unread("sam")).toHaveLength(1);
    value(chat.takeBack("alex", "sam", sent.lines[0]!.id));
    expect(chat.unread("sam")).toEqual([]);
  });
});

describe("what waits to be read", () => {
  it("is what a friend wrote that was not looked at, a friend at a time, the newest first", () => {
    const { chat, clock } = trio();
    value(chat.send("sam", "alex", "one"));
    clock.now += 1000;
    value(chat.send("robin", "alex", "two"));
    clock.now += 1000;
    value(chat.send("sam", "alex", "three"));
    expect(chat.unread("alex")).toEqual([
      { friend: "sam", count: 2, at: clock.now },
      { friend: "robin", count: 1, at: clock.now - 1000 },
    ]);
    expect(chat.unread("sam")).toEqual([]); // (what you wrote yourself does not wait)
  });

  it("is nothing once the chat was looked at, and what comes after counts again", () => {
    const { chat, clock, written } = trio();
    value(chat.send("sam", "alex", "one"));
    chat.markSeen("alex", "sam");
    expect(chat.unread("alex")).toEqual([]);
    expect(written.has("chat:alex:sam")).toBe(true);
    clock.now += 1000;
    value(chat.send("sam", "alex", "two"));
    expect(chat.unread("alex")).toEqual([{ friend: "sam", count: 1, at: clock.now }]);
    expect(chat.unread("alex")).toEqual([{ friend: "sam", count: 1, at: clock.now }]); // (asking does not look)
  });

  it("is nothing for the one who answers: the chat was open to write", () => {
    const { chat } = trio();
    value(chat.send("sam", "alex", "one"));
    value(chat.send("alex", "sam", "answer"));
    expect(chat.unread("alex")).toEqual([]);
  });

  it("is not written down again when there is nothing new to have looked at", () => {
    const { chat, written } = trio();
    value(chat.send("sam", "alex", "one"));
    chat.markSeen("alex", "sam");
    written.clear();
    chat.markSeen("alex", "sam");
    chat.markSeen("alex", "robin"); // (no chat with Robin)
    expect(written.size).toBe(0);
  });

  it("is not counted from somebody who is not a friend any more", () => {
    const { chat, friends } = trio();
    value(chat.send("sam", "alex", "one"));
    friends.delete(pair("alex", "sam"));
    expect(chat.unread("alex")).toEqual([]);
  });
});

describe("muting a friend", () => {
  it("stops the notices and nothing else: the messages come and the chat can be read, and the friend is not told", () => {
    const { chat } = trio();
    value(chat.send("sam", "alex", "one"));
    expect(value(chat.mute("alex", "sam", true))).toBe(true);
    value(chat.send("sam", "alex", "two"));
    expect(chat.unread("alex")).toEqual([]);
    const mine = value(chat.read("alex", "sam"));
    expect(mine.muted).toBe(true);
    expect(texts(mine)).toEqual(["one", "two"]);
    const theirs = value(chat.read("sam", "alex"));
    expect(theirs.muted).toBe(false); // (it is Alex's choice only)
    expect(theirs.open).toBe(true);
    expect(refusal(chat.send("sam", "alex", "three"))).toBeUndefined();
  });

  it("brings the notices back when it is undone, for what was not looked at", () => {
    const { chat } = trio();
    value(chat.mute("alex", "sam", true));
    value(chat.send("sam", "alex", "one"));
    expect(chat.unread("alex")).toEqual([]);
    expect(value(chat.mute("alex", "sam", false))).toBe(false);
    expect(chat.unread("alex")).toHaveLength(1);
    expect(value(chat.read("alex", "sam")).muted).toBe(false);
  });

  it("may be done before anything was written, and is not kept once undone with nothing in the chat", () => {
    const { chat, written, dropped } = trio();
    expect(value(chat.mute("alex", "sam", true))).toBe(true);
    expect(written.has("chat:alex:sam")).toBe(true);
    expect(value(chat.read("alex", "sam")).muted).toBe(true);
    expect(value(chat.mute("alex", "sam", false))).toBe(false);
    expect(dropped.has("chat:alex:sam")).toBe(true);
    expect(value(chat.mute("alex", "sam", false))).toBe(false); // (undoing what was never done)
  });

  it("is each side's own: both can mute, and the one is not the other", () => {
    const { chat } = trio();
    value(chat.mute("alex", "sam", true));
    value(chat.mute("sam", "alex", true));
    value(chat.mute("alex", "sam", false));
    expect(value(chat.read("alex", "sam")).muted).toBe(false);
    expect(value(chat.read("sam", "alex")).muted).toBe(true);
  });
});

describe("when friends part", () => {
  it("takes the chat with it, and a new friendship starts with nothing", () => {
    const { chat, friends, dropped } = trio();
    value(chat.send("alex", "sam", "hi"));
    value(chat.mute("sam", "alex", true));
    chat.dropChat("sam", "alex");
    expect(dropped.has("chat:alex:sam")).toBe(true);
    friends.add(pair("alex", "sam"));
    const fresh = value(chat.read("alex", "sam"));
    expect(fresh.lines).toEqual([]);
    expect(value(chat.read("sam", "alex")).muted).toBe(false);
  });

  it("is noticed even when nobody said so: a chat of two who are not friends is gone when looked at", () => {
    const { chat, friends, dropped } = trio();
    value(chat.send("alex", "sam", "hi"));
    friends.delete(pair("alex", "sam"));
    expect(refusal(chat.read("alex", "sam"))).toBe("not_friends");
    expect(dropped.has("chat:alex:sam")).toBe(true);
    friends.add(pair("alex", "sam"));
    expect(value(chat.read("alex", "sam")).lines).toEqual([]);
  });

  it("is a profile going: every chat it was in goes", () => {
    const { chat, dropped } = trio();
    value(chat.send("alex", "sam", "hi"));
    value(chat.send("robin", "alex", "hi"));
    chat.forget("alex");
    expect([...dropped].sort()).toEqual(["chat:alex:robin", "chat:alex:sam"]);
    expect(chat.unread("alex")).toEqual([]);
    expect(chat.unread("sam")).toEqual([]);
    chat.forget("nobody");
  });
});

describe("what a report would hold", () => {
  it("is the last twenty messages and the revision they are of", () => {
    const { chat, clock } = trio();
    let last = 0;
    for (let i = 1; i <= 25; i++) {
      last = value(chat.send(i % 2 ? "alex" : "sam", i % 2 ? "sam" : "alex", `message ${i}`)).rev;
      clock.now += 4000;
    }
    const held = value(chat.lastLines("alex", "sam"));
    expect(held.rev).toBe(last);
    expect(held.lines).toHaveLength(CHAT_REPORT_LINES);
    expect(held.lines[0]?.text).toBe("message 6");
    expect(held.lines.at(-1)?.text).toBe("message 25");
    expect(held.lines.at(-1)?.mine).toBe(true);
    expect(value(chat.lastLines("alex", "sam", 3)).lines.map((line) => line.text)).toEqual(["message 23", "message 24", "message 25"]);
  });
});

describe("keeping it between starts", () => {
  it("writes down each chat as a document of its own, and reads it back as it was", () => {
    const { chat, clock, written, host } = trio();
    value(chat.send("alex", "sam", "one"));
    clock.now += 1000;
    value(chat.send("sam", "alex", "two"));
    value(chat.mute("alex", "sam", true));
    chat.markSeen("alex", "sam");
    value(chat.send("robin", "alex", "three"));
    expect([...written].sort()).toEqual(["chat:alex:robin", "chat:alex:sam"]);
    expect(ChatBook.owns("chat:alex:sam")).toBe(true);
    expect(ChatBook.owns("friends:alex")).toBe(false);

    const back = new ChatBook(host);
    for (const key of written) back.load(key, JSON.parse(JSON.stringify(chat.docFor(key))));
    for (const friend of ["sam", "robin"]) {
      expect(value(back.read("alex", friend))).toEqual(value(chat.read("alex", friend)));
      expect(value(back.read(friend, "alex"))).toEqual(value(chat.read(friend, "alex")));
    }
    expect(back.unread("alex")).toEqual(chat.unread("alex"));
    expect(back.unread("alex")).toHaveLength(1); // (Robin's: Sam is muted)
    // ...and goes on from there
    const more = value(back.send("alex", "sam", "four"));
    expect(more.lines).toHaveLength(3);
    expect(more.rev).toBeGreaterThan(value(chat.read("alex", "sam")).rev);
  });

  it("does not take a document that is not a chat", () => {
    const { chat } = trio();
    expect(() => chat.load("chat:x:y", { v: 1 })).toThrow();
    expect(() => chat.load("chat:x:y", { a: "x", b: "y", lines: "no", muted: [] })).toThrow();
    const good = { v: 1, a: "x", b: "y", rev: 5, lines: [{ n: 5, from: "x", at: 1, text: "hi" }], seen: {}, muted: [] };
    for (const broken of [{ ...good, seen: undefined }, { ...good, seen: null }, { ...good, rev: "5" }, { ...good, lines: [{ n: 5, from: "x", at: 1 }] }, { ...good, lines: [null] }, null, "chat"]) {
      expect(() => chat.load("chat:x:y", broken), JSON.stringify(broken)).toThrow();
    }
  });
});
