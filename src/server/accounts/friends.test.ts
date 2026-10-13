import { describe, expect, it } from "vitest";
import { CODE_ALPHABET, INBOX_KEEP_MS, INBOX_MAX, INBOX_PER_SENDER, INVITE_TTL_MS, MAX_FRIENDS, MAX_OPEN_INVITES, MAX_REQUESTS, PARTY_INVITE_KEEP_MS, REQUEST_KEEP_MS, type Message } from "../../shared";
import { FriendBook } from "./friends";

/** A book with a clock to move, and a record of what it asked the store to write down. */
function book() {
  const clock = { now: 1_000_000 };
  const written = new Set<string>();
  const dropped = new Set<string>();
  const friends = new FriendBook({
    now: () => clock.now,
    touch: (key) => {
      written.add(key);
      dropped.delete(key);
    },
    drop: (key) => {
      dropped.add(key);
      written.delete(key);
    },
  });
  return { friends, clock, written, dropped };
}

const dune: Message = { kind: "recommend", title: "Dune", url: "https://filmpire.sc/watch/438631", year: 2021, note: "The sound!" };
const alien: Message = { kind: "recommend", title: "Alien", url: "https://filmpire.sc/watch/348" };
const party: Message = { kind: "party", code: "482731", endsAt: 2_000_000 };
const together: Message = { kind: "together" };

/** Two profiles that are friends already. */
function befriended() {
  const world = book();
  const { code } = world.friends.createInvite("alex");
  const joined = world.friends.redeem("sam", code);
  expect(joined.ok).toBe(true);
  return world;
}

describe("making friends with a code", () => {
  it("makes a code of eight letters and digits that are easy to read aloud, good for a week", () => {
    const { friends, clock } = book();
    const invite = friends.createInvite("alex");
    expect(invite.code).toMatch(new RegExp(`^[${CODE_ALPHABET}]{8}$`));
    expect(invite.from).toBe("alex");
    expect(invite.expiresAt).toBe(clock.now + INVITE_TTL_MS);
    expect(friends.peekInvite(invite.code)?.from).toBe("alex");
  });

  it("makes friends of whoever uses it and whoever made it, on both sides, and the code is spent", () => {
    const { friends, clock } = book();
    const { code } = friends.createInvite("alex");
    clock.now += 5000;
    const joined = friends.redeem("sam", code);
    expect(joined).toEqual({ ok: true, value: { friend: "alex", since: clock.now } });
    expect(friends.areFriends("alex", "sam")).toBe(true);
    expect(friends.areFriends("sam", "alex")).toBe(true);
    expect(friends.friendsOf("alex")).toEqual([{ id: "sam", since: clock.now }]);
    expect(friends.friendsOf("sam")).toEqual([{ id: "alex", since: clock.now }]);
    expect(friends.redeem("robin", code)).toEqual({ ok: false, error: "invite_gone" });
    expect(friends.peekInvite(code)).toBeUndefined();
  });

  it("takes the code however it was typed", () => {
    const { friends } = book();
    const { code } = friends.createInvite("alex");
    const typed = `${code.slice(0, 4).toLowerCase()}-${code.slice(4).toLowerCase()}`;
    expect(friends.peekInvite(typed)?.from).toBe("alex");
    expect(friends.redeem("sam", ` ${typed} `).ok).toBe(true);
  });

  it("does not take a code that was never made, that ran out, or that was taken back", () => {
    const { friends, clock } = book();
    expect(friends.redeem("sam", "ABCD2345")).toEqual({ ok: false, error: "invite_gone" });

    const old = friends.createInvite("alex");
    clock.now += INVITE_TTL_MS;
    expect(friends.peekInvite(old.code)).toBeUndefined();
    expect(friends.redeem("sam", old.code)).toEqual({ ok: false, error: "invite_gone" });

    const taken = friends.createInvite("alex");
    expect(friends.revokeInvite("sam", taken.code)).toBe(false); // only its maker takes it back
    expect(friends.revokeInvite("alex", taken.code)).toBe(true);
    expect(friends.revokeInvite("alex", taken.code)).toBe(false);
    expect(friends.redeem("sam", taken.code)).toEqual({ ok: false, error: "invite_gone" });
  });

  it("is not a way to befriend oneself, or somebody who already is a friend, and a code that was refused stays good", () => {
    const { friends } = book();
    const { code } = friends.createInvite("alex");
    expect(friends.redeem("alex", code)).toEqual({ ok: false, error: "own_invite" });
    expect(friends.peekInvite(code)).toBeDefined();

    expect(friends.redeem("sam", code).ok).toBe(true);
    const again = friends.createInvite("alex");
    expect(friends.redeem("sam", again.code)).toEqual({ ok: false, error: "already_friends" });
    const theirs = friends.createInvite("sam");
    expect(friends.redeem("alex", theirs.code)).toEqual({ ok: false, error: "already_friends" });
    expect(friends.peekInvite(again.code)).toBeDefined();
  });

  it("keeps a few codes out at a time: another takes back the oldest", () => {
    const { friends, clock } = book();
    const codes: string[] = [];
    for (let i = 0; i < MAX_OPEN_INVITES + 2; i++) {
      codes.push(friends.createInvite("alex").code);
      clock.now += 1000;
    }
    expect(friends.invitesOf("alex").map((invite) => invite.code)).toEqual(codes.slice(-MAX_OPEN_INVITES));
    expect(friends.peekInvite(codes[0]!)).toBeUndefined();
    expect(friends.invitesOf("sam")).toEqual([]);
  });

  it("stops at as many friends as it holds, on either side", () => {
    const { friends } = book();
    for (let i = 0; i < MAX_FRIENDS; i++) expect(friends.redeem(`p${i}`, friends.createInvite("alex").code).ok).toBe(true);
    const full = friends.createInvite("alex");
    expect(friends.redeem("late", full.code)).toEqual({ ok: false, error: "friends_full" });
    expect(friends.redeem("alex", friends.createInvite("late").code)).toEqual({ ok: false, error: "friends_full" });
    expect(friends.friendsOf("alex")).toHaveLength(MAX_FRIENDS);
  });

  it("ends a friendship on both sides, and what they had sent each other goes with it", () => {
    const { friends } = befriended();
    friends.deliver("sam", "alex", dune);
    friends.deliver("alex", "sam", alien);
    expect(friends.unfriend("sam", "alex")).toBe(true);
    expect(friends.areFriends("alex", "sam")).toBe(false);
    expect(friends.areFriends("sam", "alex")).toBe(false);
    expect(friends.inboxOf("sam")).toEqual([]);
    expect(friends.inboxOf("alex")).toEqual([]);
    expect(friends.unfriend("sam", "alex")).toBe(false);
  });

  it("takes back the codes the one who ended it still has out, so that nobody they removed can come back by one they were shown", () => {
    const { friends, dropped } = befriended();
    const shown = friends.createInvite("alex");
    const second = friends.createInvite("alex");
    const robins = friends.createInvite("robin");
    expect(friends.unfriend("alex", "sam")).toBe(true);
    expect(friends.invitesOf("alex")).toEqual([]);
    expect(friends.peekInvite(shown.code)).toBeUndefined();
    expect(friends.redeem("sam", second.code)).toEqual({ ok: false, error: "invite_gone" });
    expect(friends.areFriends("alex", "sam")).toBe(false);
    expect(dropped.has(`finvite:${shown.code}`) && dropped.has(`finvite:${second.code}`)).toBe(true);
    expect(friends.peekInvite(robins.code)?.from).toBe("robin"); // (the codes of somebody else are theirs)
  });

  it("leaves the codes alone when what was removed was no friend", () => {
    const { friends } = book();
    const mine = friends.createInvite("alex");
    expect(friends.unfriend("alex", "nobody")).toBe(false);
    expect(friends.peekInvite(mine.code)?.from).toBe("alex");
  });
});

describe("asking to be friends", () => {
  it("waits for an answer: the one asked sees who asked, the one who asked sees who they asked, and nobody is a friend yet", () => {
    const { friends, clock } = book();
    clock.now += 1000;
    expect(friends.request("alex", "sam")).toEqual({ ok: true, value: { friends: false, at: clock.now } });
    clock.now += 1000;
    expect(friends.request("robin", "sam")).toEqual({ ok: true, value: { friends: false, at: clock.now } });
    expect(friends.requestsTo("sam")).toEqual([
      { from: "robin", at: clock.now },
      { from: "alex", at: clock.now - 1000 },
    ]);
    expect(friends.requestsBy("alex")).toEqual([{ to: "sam", at: clock.now - 1000 }]);
    expect(friends.requestsTo("alex")).toEqual([]);
    expect(friends.areFriends("alex", "sam")).toBe(false);
  });

  it("asks anew, not twice, when it is asked again", () => {
    const { friends, clock } = book();
    friends.request("alex", "sam");
    clock.now += 5000;
    friends.request("alex", "sam");
    expect(friends.requestsTo("sam")).toEqual([{ from: "alex", at: clock.now }]);
  });

  it("makes friends of the two on both sides when the one asked says yes, and the request is gone", () => {
    const { friends, clock } = book();
    friends.request("alex", "sam");
    clock.now += 3000;
    expect(friends.acceptRequest("sam", "alex")).toEqual({ ok: true, value: { since: clock.now } });
    expect(friends.areFriends("alex", "sam") && friends.areFriends("sam", "alex")).toBe(true);
    expect(friends.requestsTo("sam")).toEqual([]);
    expect(friends.requestsBy("alex")).toEqual([]);
    expect(friends.acceptRequest("sam", "alex")).toEqual({ ok: false, error: "request_gone" });
  });

  it("lets the one asked turn it down, and says nothing to the one who asked", () => {
    const { friends } = book();
    friends.request("alex", "sam");
    expect(friends.declineRequest("sam", "alex")).toBe(true);
    expect(friends.declineRequest("sam", "alex")).toBe(false);
    expect(friends.requestsTo("sam")).toEqual([]);
    expect(friends.acceptRequest("sam", "alex")).toEqual({ ok: false, error: "request_gone" });
    expect(friends.areFriends("alex", "sam")).toBe(false);
  });

  it("takes two who ask each other as a yes from both: they are friends at once", () => {
    const { friends, clock } = book();
    friends.request("alex", "sam");
    clock.now += 2000;
    expect(friends.request("sam", "alex")).toEqual({ ok: true, value: { friends: true, at: clock.now } });
    expect(friends.areFriends("alex", "sam")).toBe(true);
    expect(friends.requestsTo("sam")).toEqual([]);
    expect(friends.requestsTo("alex")).toEqual([]);
  });

  it("is not a way to ask oneself, or a friend, or anybody when either has as many friends as it holds", () => {
    const { friends } = book();
    expect(friends.request("alex", "alex")).toEqual({ ok: false, error: "own_request" });
    const pair = befriended().friends;
    expect(pair.request("alex", "sam")).toEqual({ ok: false, error: "already_friends" });

    for (let i = 0; i < MAX_FRIENDS; i++) expect(friends.redeem(`p${i}`, friends.createInvite("alex").code).ok).toBe(true);
    expect(friends.request("late", "alex")).toEqual({ ok: false, error: "friends_full" });
    expect(friends.request("alex", "late")).toEqual({ ok: false, error: "friends_full" });
    // A yes that would go over is refused too (somebody asked before the friends were full).
    const open = book();
    open.friends.request("late", "alex");
    for (let i = 0; i < MAX_FRIENDS; i++) open.friends.redeem(`p${i}`, open.friends.createInvite("alex").code);
    expect(open.friends.acceptRequest("alex", "late")).toEqual({ ok: false, error: "friends_full" });
  });

  it("keeps the newest requests a profile is sent, so nobody can fill it, and lets go of one that has waited too long", () => {
    const { friends, clock } = book();
    for (let i = 0; i < MAX_REQUESTS + 5; i++) {
      friends.request(`p${i}`, "sam");
      clock.now += 1000;
    }
    const waiting = friends.requestsTo("sam");
    expect(waiting).toHaveLength(MAX_REQUESTS);
    expect(waiting[0]!.from).toBe(`p${MAX_REQUESTS + 4}`);
    expect(waiting.some((request) => request.from === "p0")).toBe(false);

    const newest = clock.now - 1000; // (when the last was asked)
    clock.now = newest + REQUEST_KEEP_MS - 500;
    expect(friends.requestsTo("sam").map((request) => request.from)).toEqual([`p${MAX_REQUESTS + 4}`]); // (the one before it has waited too long, the last has not)
    clock.now += 1000;
    expect(friends.requestsTo("sam")).toEqual([]);
  });

  it("is answered by a code that makes the same two friends", () => {
    const { friends } = book();
    friends.request("alex", "sam");
    expect(friends.redeem("alex", friends.createInvite("sam").code).ok).toBe(true);
    expect(friends.requestsTo("sam")).toEqual([]);
  });

  it("goes with a profile that goes, whichever way it was asked", () => {
    const { friends, dropped } = book();
    friends.request("alex", "sam");
    friends.request("robin", "alex");
    friends.forget("alex");
    expect(friends.requestsTo("sam")).toEqual([]);
    expect(friends.requestsTo("alex")).toEqual([]);
    expect(friends.requestsBy("robin")).toEqual([]);
    expect(dropped.has("frequests:sam") && dropped.has("frequests:alex")).toBe(true);
  });

  it("is written down, comes back as it was, and lets go of what was too old while the server was off", () => {
    const first = book();
    first.friends.request("alex", "sam");
    first.clock.now += 1000;
    first.friends.request("robin", "sam");
    expect([...first.written].sort()).toEqual(["frequests:sam"]);
    expect(FriendBook.owns("frequests:sam")).toBe(true);

    const second = book();
    second.clock.now = first.clock.now + 1000;
    second.friends.load("frequests:sam", JSON.parse(JSON.stringify(first.friends.docFor("frequests:sam"))));
    expect(second.friends.requestsTo("sam")).toEqual(first.friends.requestsTo("sam"));

    const later = book();
    later.clock.now = first.clock.now + REQUEST_KEEP_MS + 1;
    later.friends.load("frequests:sam", JSON.parse(JSON.stringify(first.friends.docFor("frequests:sam"))));
    expect(later.friends.requestsTo("sam")).toEqual([]);
    expect(later.dropped.has("frequests:sam")).toBe(true);
  });
});

describe("the inbox", () => {
  it("holds what friends sent, the newest first and unread", () => {
    const { friends, clock } = befriended();
    friends.deliver("sam", "alex", dune);
    clock.now += 1000;
    friends.deliver("sam", "alex", party);
    const items = friends.inboxOf("sam");
    expect(items.map((item) => item.kind)).toEqual(["party", "recommend"]);
    expect(items[1]).toMatchObject({ from: "alex", title: "Dune", note: "The sound!", read: false, at: 1_000_000 });
    expect(items[0]).toMatchObject({ code: "482731", endsAt: 2_000_000, read: false, at: 1_001_000 });
    expect(new Set(items.map((item) => item.id)).size).toBe(2);
    expect(friends.inboxOf("alex")).toEqual([]);
  });

  it("does not pile up the same thing: a title sent again, or a newer invitation, replaces the old one and is new again", () => {
    const { friends, clock } = befriended();
    friends.deliver("sam", "alex", dune);
    friends.deliver("sam", "alex", alien);
    friends.markRead("sam");
    clock.now += 1000;
    friends.deliver("sam", "alex", { ...dune, note: "Seriously." });
    friends.deliver("sam", "alex", party);
    friends.deliver("sam", "alex", { ...party, code: "111222" });
    const items = friends.inboxOf("sam");
    expect(items.map((item) => (item.kind === "party" ? item.code : item.kind === "recommend" ? item.title : ""))).toEqual(["111222", "Dune", "Alien"]);
    expect(items.map((item) => item.read)).toEqual([false, false, true]);
    expect(items[1]).toMatchObject({ note: "Seriously." });
  });

  it("keeps what two friends sent apart", () => {
    const world = befriended();
    const { friends } = world;
    const other = friends.createInvite("robin");
    friends.redeem("sam", other.code);
    friends.deliver("sam", "alex", dune);
    friends.deliver("sam", "robin", dune);
    expect(friends.inboxOf("sam").map((item) => item.from).sort()).toEqual(["alex", "robin"]);
  });

  it("announces something once while it is unread: sent again it keeps its id, but once it has been seen it is a new thing", () => {
    const { friends, clock } = befriended();
    const first = friends.deliver("sam", "alex", dune);
    clock.now += 1000;
    const again = friends.deliver("sam", "alex", { ...dune, note: "Again!" });
    expect(again.id).toBe(first.id);
    expect(friends.inboxOf("sam")).toEqual([{ ...again, note: "Again!", at: 1_001_000, read: false }]);

    const invitation = friends.deliver("sam", "alex", party);
    expect(friends.deliver("sam", "alex", { ...party, code: "111222" }).id).toBe(invitation.id);

    friends.markRead("sam");
    expect(friends.deliver("sam", "alex", dune).id).not.toBe(first.id);
    expect(friends.deliver("sam", "alex", { ...party, code: "333444" }).id).not.toBe(invitation.id);
    expect(friends.inboxOf("sam")).toHaveLength(2);
  });

  it("keeps one friend from filling an inbox: of what they sent the newest twenty stay, and what the others sent is still there", () => {
    const { friends, clock } = befriended();
    const other = friends.createInvite("robin");
    friends.redeem("sam", other.code);
    friends.deliver("sam", "robin", alien);
    for (let i = 0; i < INBOX_PER_SENDER + 7; i++) {
      clock.now += 1;
      friends.deliver("sam", "alex", { kind: "recommend", title: `Film ${i}`, url: `https://filmpire.sc/watch/${i}` });
    }
    const items = friends.inboxOf("sam");
    const alexs = items.filter((item) => item.from === "alex");
    expect(alexs).toHaveLength(INBOX_PER_SENDER);
    expect(alexs[0]).toMatchObject({ title: `Film ${INBOX_PER_SENDER + 6}` });
    expect(alexs.at(-1)).toMatchObject({ title: "Film 7" });
    expect(items.filter((item) => item.from === "robin")).toHaveLength(1);
    expect(items).toHaveLength(INBOX_PER_SENDER + 1);
  });

  it("marks everything as seen, says how much was new, and lets one thing go", () => {
    const { friends } = befriended();
    friends.deliver("sam", "alex", dune);
    friends.deliver("sam", "alex", alien);
    expect(friends.markRead("sam")).toBe(2);
    expect(friends.markRead("sam")).toBe(0);
    expect(friends.inboxOf("sam").every((item) => item.read)).toBe(true);

    const [first, second] = friends.inboxOf("sam");
    expect(friends.dismiss("sam", first!.id)).toBe(true);
    expect(friends.dismiss("sam", first!.id)).toBe(false);
    expect(friends.dismiss("alex", second!.id)).toBe(false); // somebody else's
    expect(friends.inboxOf("sam")).toEqual([second]);
  });

  it("lets go of what is old, and of an invitation to a party that must be over", () => {
    const { friends, clock } = befriended();
    friends.deliver("sam", "alex", dune);
    friends.deliver("sam", "alex", party);
    clock.now += PARTY_INVITE_KEEP_MS;
    expect(friends.inboxOf("sam").map((item) => item.kind)).toEqual(["recommend"]);
    clock.now += INBOX_KEEP_MS;
    expect(friends.inboxOf("sam")).toEqual([]);
  });

  it("keeps a friend's request to watch together once, and a request is let go when it is answered or when the party's time is up", () => {
    const { friends, clock } = befriended();
    const first = friends.deliver("sam", "alex", together);
    expect(friends.deliver("sam", "alex", together).id).toBe(first.id);
    expect(friends.inboxOf("sam").map((item) => item.kind)).toEqual(["together"]);
    expect(friends.answerTogether("sam", "robin")).toBe(false); // (somebody else's request is not this one)
    expect(friends.answerTogether("sam", "alex")).toBe(true);
    expect(friends.inboxOf("sam")).toEqual([]);
    expect(friends.answerTogether("sam", "alex")).toBe(false);

    friends.deliver("sam", "alex", together);
    clock.now += PARTY_INVITE_KEEP_MS;
    expect(friends.inboxOf("sam")).toEqual([]);
  });

  it("remembers which screen an invitation's party is on, for the server only", () => {
    const { friends } = befriended();
    friends.deliver("sam", "alex", party, "tv_host");
    friends.deliver("sam", "alex", dune);
    expect(friends.inboxOf("sam").find((item) => item.kind === "party")).toMatchObject({ code: "482731", host: "tv_host" });
    expect(friends.inboxOf("sam").find((item) => item.kind === "recommend")).not.toHaveProperty("host");
  });

  it("keeps the newest hundred, whoever sent them", () => {
    const { friends, clock } = book();
    const senders = ["a", "b", "c", "d", "e", "f"]; // (each has only INBOX_PER_SENDER in the inbox: it takes more than five friends to fill a hundred)
    for (const sender of senders) expect(friends.redeem("sam", friends.createInvite(sender).code).ok).toBe(true);
    const sent = senders.length * INBOX_PER_SENDER;
    for (let i = 0; i < sent; i++) {
      friends.deliver("sam", senders[Math.floor(i / INBOX_PER_SENDER)]!, { kind: "recommend", title: `Film ${i}`, url: `https://filmpire.sc/watch/${i}` });
      clock.now += 1;
    }
    const items = friends.inboxOf("sam");
    expect(items).toHaveLength(INBOX_MAX);
    expect(items[0]).toMatchObject({ title: `Film ${sent - 1}` });
    expect(items.at(-1)).toMatchObject({ title: `Film ${sent - INBOX_MAX}` });
    expect(items.some((item) => item.from === "a")).toBe(false);
  });
});

describe("a profile that goes", () => {
  it("is nobody's friend any more, has nothing left in an inbox, and its codes are void", () => {
    const { friends } = befriended();
    const robin = friends.createInvite("robin");
    friends.redeem("alex", robin.code);
    friends.deliver("sam", "alex", dune);
    friends.deliver("robin", "alex", alien);
    friends.deliver("alex", "sam", alien);
    const open = friends.createInvite("alex");

    friends.forget("alex");
    expect(friends.friendsOf("sam")).toEqual([]);
    expect(friends.friendsOf("robin")).toEqual([]);
    expect(friends.friendsOf("alex")).toEqual([]);
    expect(friends.inboxOf("sam")).toEqual([]);
    expect(friends.inboxOf("robin")).toEqual([]);
    expect(friends.inboxOf("alex")).toEqual([]);
    expect(friends.peekInvite(open.code)).toBeUndefined();
  });
});

describe("being kept", () => {
  it("asks for what changed to be written, and for what is gone to be forgotten", () => {
    const { friends, written, dropped } = book();
    const invite = friends.createInvite("alex");
    expect([...written]).toEqual([`finvite:${invite.code}`]);

    friends.redeem("sam", invite.code);
    expect(dropped.has(`finvite:${invite.code}`)).toBe(true);
    expect([...written].sort()).toEqual(["friends:alex", "friends:sam"]);

    friends.deliver("sam", "alex", dune);
    expect(written.has("inbox:sam")).toBe(true);
    const [item] = friends.inboxOf("sam");
    friends.dismiss("sam", item!.id);
    expect(dropped.has("inbox:sam")).toBe(true);

    friends.unfriend("alex", "sam");
    expect(dropped.has("friends:alex")).toBe(true);
    expect(dropped.has("friends:sam")).toBe(true);
  });

  it("comes back as it was from what it wrote down", () => {
    const first = befriended();
    first.friends.deliver("sam", "alex", dune);
    first.friends.deliver("alex", "sam", party);
    const open = first.friends.createInvite("alex");

    const second = book();
    second.clock.now = first.clock.now;
    for (const key of first.written) {
      expect(FriendBook.owns(key)).toBe(true);
      // (What is written is plain JSON: it is read back after a round through a string, as a database or a file would.)
      second.friends.load(key, JSON.parse(JSON.stringify(first.friends.docFor(key))));
    }
    expect(second.friends.friendsOf("alex")).toEqual(first.friends.friendsOf("alex"));
    expect(second.friends.friendsOf("sam")).toEqual(first.friends.friendsOf("sam"));
    expect(second.friends.inboxOf("sam")).toEqual(first.friends.inboxOf("sam"));
    expect(second.friends.inboxOf("alex")).toEqual(first.friends.inboxOf("alex"));
    expect(second.friends.peekInvite(open.code)?.from).toBe("alex");
  });

  it("does not bring back a code that ran out while the server was off, lets its row go, and knows only its own documents", () => {
    const first = book();
    const invite = first.friends.createInvite("alex");
    const second = book();
    second.clock.now = first.clock.now + INVITE_TTL_MS + 1;
    second.friends.load(`finvite:${invite.code}`, JSON.parse(JSON.stringify(first.friends.docFor(`finvite:${invite.code}`))));
    expect(second.friends.peekInvite(invite.code)).toBeUndefined();
    expect(second.dropped.has(`finvite:${invite.code}`)).toBe(true);

    expect(FriendBook.owns("account:acc_1")).toBe(false);
    expect(FriendBook.owns("pdata:pro_1")).toBe(false);
    expect(FriendBook.owns("session:abc")).toBe(false);
    expect(first.friends.docFor("friends:nobody")).toBeUndefined();
    expect(first.friends.docFor("inbox:nobody")).toBeUndefined();
  });
});
