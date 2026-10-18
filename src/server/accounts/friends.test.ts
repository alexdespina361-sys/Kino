import { describe, expect, it } from "vitest";
import {
  CODE_ALPHABET,
  INBOX_KEEP_MS,
  INBOX_MAX,
  INBOX_PER_SENDER,
  INVITE_TTL_MS,
  MAX_FRIENDS,
  MAX_OPEN_INVITES,
  MAX_REQUESTS,
  PARTY_INVITE_KEEP_MS,
  PLAN_KEEP_AFTER_MS,
  PLAN_MAX_AHEAD_MS,
  PLAN_MIN_AHEAD_MS,
  PLAN_OPEN_PER_PAIR,
  PLAN_OPEN_PER_SENDER,
  PLAN_SETTLE_AHEAD_MS,
  REQUEST_KEEP_MS,
  type Message,
} from "../../shared";
import { FriendBook, type Outcome, type StoredItem } from "./friends";

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

describe("plans to watch together", () => {
  const HOUR = 3_600_000;
  type PlanMessage = Extract<Message, { kind: "plan" }>;
  const plan = (when: number, note?: string): PlanMessage => ({ kind: "plan", when, ...(note ? { note } : {}) });
  /** The id of what `propose` put (or found). */
  const idOf = (outcome: Outcome<StoredItem>) => {
    expect(outcome.ok).toBe(true);
    return outcome.ok ? outcome.value.id : "";
  };
  /** What the plans in an inbox say, newest first: the time (from the start of the test) and the answer, if there is one. */
  const plansIn = (world: ReturnType<typeof befriended>, who: string, start: number) =>
    world.friends.inboxOf(who).map((item) => (item.kind === "plan" ? [item.when - start, item.answer] : null));
  /** Alex puts a plan to Sam; this is the question as Sam has it. */
  function asked(world: ReturnType<typeof befriended>, when: number) {
    const put = world.friends.propose("sam", "alex", plan(when));
    expect(put.ok).toBe(true);
    return world.friends.openPlan("sam", idOf(put))!;
  }

  it("puts a plan in a friend's inbox, unread, with its time and a few words; the same time put again takes its place and, while unread, keeps its id", () => {
    const { friends, clock } = befriended();
    const when = clock.now + HOUR;
    const first = friends.propose("sam", "alex", plan(when, "after dinner"));
    expect(first).toMatchObject({ ok: true, value: { kind: "plan", from: "alex", when, note: "after dinner", read: false, at: clock.now } });
    expect(friends.inboxOf("sam")).toHaveLength(1);
    expect(friends.inboxOf("sam")[0]).not.toHaveProperty("answer");
    expect(friends.inboxOf("alex")).toEqual([]);

    clock.now += 1000;
    const again = friends.propose("sam", "alex", plan(when, "or later"));
    expect(again).toMatchObject({ ok: true, value: { note: "or later" } });
    expect(idOf(again)).toBe(idOf(first));
    expect(friends.inboxOf("sam")).toHaveLength(1);

    friends.markRead("sam");
    expect(idOf(friends.propose("sam", "alex", plan(when)))).not.toBe(idOf(first)); // (it has been seen: this is news again)
    expect(friends.inboxOf("sam")).toHaveLength(1);
  });

  it("refuses a time less than five minutes away, one that has gone, or one more than thirty days off, to the millisecond, and puts nothing in the inbox", () => {
    const { friends, clock } = befriended();
    expect(friends.propose("sam", "alex", plan(clock.now + PLAN_MIN_AHEAD_MS - 1))).toEqual({ ok: false, error: "plan_soon" });
    expect(friends.propose("sam", "alex", plan(clock.now - HOUR))).toEqual({ ok: false, error: "plan_soon" });
    expect(friends.propose("sam", "alex", plan(clock.now + PLAN_MAX_AHEAD_MS + 1))).toEqual({ ok: false, error: "plan_far" });
    expect(friends.inboxOf("sam")).toEqual([]);
    expect(friends.propose("sam", "alex", plan(clock.now + PLAN_MIN_AHEAD_MS)).ok).toBe(true);
    expect(friends.propose("sam", "alex", plan(clock.now + PLAN_MAX_AHEAD_MS)).ok).toBe(true);
  });

  it("holds a profile to three plans that wait on one friend and ten in all; the same time again is not another, and one that was answered no longer waits", () => {
    const world = befriended();
    const { friends, clock } = world;
    const when = (i: number) => clock.now + (i + 1) * HOUR;
    for (let i = 0; i < PLAN_OPEN_PER_PAIR; i++) expect(friends.propose("sam", "alex", plan(when(i))).ok).toBe(true);
    expect(friends.propose("sam", "alex", plan(when(PLAN_OPEN_PER_PAIR)))).toEqual({ ok: false, error: "plan_full" });
    expect(friends.propose("sam", "alex", plan(when(1), "again")).ok).toBe(true); // (the same time takes the old one's place)
    expect(friends.inboxOf("sam")).toHaveLength(PLAN_OPEN_PER_PAIR);

    friends.answerPlan("sam", friends.openPlan("sam", friends.inboxOf("sam")[0]!.id)!, "no", true);
    expect(friends.propose("sam", "alex", plan(when(PLAN_OPEN_PER_PAIR))).ok).toBe(true); // (an answered one frees a place)

    // Ten in all: Sam has three waiting; the other friends take the rest, and the eleventh waits for nobody.
    const others = ["b", "c", "d"];
    for (const name of others) expect(friends.redeem(name, friends.createInvite("alex").code).ok).toBe(true);
    let waiting = PLAN_OPEN_PER_PAIR;
    for (const name of others) {
      for (let i = 0; i < PLAN_OPEN_PER_PAIR && waiting < PLAN_OPEN_PER_SENDER; i++, waiting++) {
        expect(friends.propose(name, "alex", plan(when(20 + waiting))).ok).toBe(true);
      }
    }
    expect(waiting).toBe(PLAN_OPEN_PER_SENDER);
    expect(friends.propose("d", "alex", plan(when(40)))).toEqual({ ok: false, error: "plan_full" });
    expect(friends.propose("sam", "alex", plan(when(41)))).toEqual({ ok: false, error: "plan_full" });
    // The same time again is not one more, even now.
    const theirs = friends.inboxOf("b").find((item) => item.kind === "plan");
    expect(friends.propose("b", "alex", plan((theirs as PlanMessage).when, "changed")).ok).toBe(true);
    // What somebody else has put is not counted against Alex.
    expect(friends.redeem("sam", friends.createInvite("robin").code).ok).toBe(true);
    expect(friends.propose("sam", "robin", plan(when(50))).ok).toBe(true);
  });

  it("is answered: yes keeps it in the inbox as a plan that is on, already seen, and tells the friend in theirs; no takes it away and tells the friend", () => {
    const world = befriended();
    const { friends, clock } = world;
    const start = clock.now;
    const yes = asked(world, start + HOUR);
    const no = asked(world, start + 2 * HOUR);

    friends.answerPlan("sam", yes, "yes", true);
    friends.answerPlan("sam", no, "no", true);
    expect(friends.inboxOf("sam")).toMatchObject([{ kind: "plan", from: "alex", when: start + HOUR, answer: "yes", read: true, id: yes.id }]);
    const told = friends.inboxOf("alex");
    expect(told).toMatchObject([
      { kind: "plan", from: "sam", when: start + 2 * HOUR, answer: "no", read: false },
      { kind: "plan", from: "sam", when: start + HOUR, answer: "yes", read: false },
    ]);
    // An answered plan is no question any more, for either of them.
    expect(friends.openPlan("sam", yes.id)).toBeUndefined();
    expect(friends.openPlan("sam", no.id)).toBeUndefined();
    expect(friends.openPlan("alex", told[0]!.id)).toBeUndefined();
    expect(friends.openPlan("alex", told[1]!.id)).toBeUndefined();
  });

  it("does not tell a friend who takes nothing just now, and a plan put again for a time they said yes to is already on", () => {
    const world = befriended();
    const { friends, clock } = world;
    const when = clock.now + HOUR;
    friends.answerPlan("sam", asked(world, when), "yes", false);
    expect(friends.inboxOf("alex")).toEqual([]);
    expect(friends.inboxOf("sam")).toMatchObject([{ answer: "yes" }]);

    expect(friends.propose("sam", "alex", plan(when))).toMatchObject({ ok: true, value: { answer: "yes" } });
    expect(friends.inboxOf("sam")).toHaveLength(1); // (not a question again)
  });

  it("lets go of a plan at its time if nobody answered, a little after if it is on, and half a day after the news that it is off", () => {
    const world = befriended();
    const { friends, clock } = world;
    const start = clock.now;
    const open = asked(world, start + HOUR);
    friends.answerPlan("sam", asked(world, start + 2 * HOUR), "yes", true);
    friends.answerPlan("sam", asked(world, start + 3 * HOUR), "no", true);
    expect(plansIn(world, "sam", start)).toEqual([[2 * HOUR, "yes"], [HOUR, undefined]]);

    clock.now = start + HOUR - 1;
    expect(friends.openPlan("sam", open.id)).toBeDefined();
    clock.now = start + HOUR;
    expect(friends.openPlan("sam", open.id)).toBeUndefined(); // (its time has come: nobody can say yes to it now, and it goes)
    expect(plansIn(world, "sam", start)).toEqual([[2 * HOUR, "yes"]]);

    clock.now = start + 2 * HOUR + PLAN_KEEP_AFTER_MS - 1;
    expect(friends.inboxOf("sam")).toHaveLength(1);
    expect(friends.inboxOf("alex")).toHaveLength(2);
    clock.now = start + 2 * HOUR + PLAN_KEEP_AFTER_MS;
    expect(friends.inboxOf("sam")).toEqual([]);
    expect(plansIn(world, "alex", start)).toEqual([[3 * HOUR, "no"]]); // (the news that it was turned down is kept for half a day)
    clock.now = start + PARTY_INVITE_KEEP_MS - 1;
    expect(friends.inboxOf("alex")).toHaveLength(1);
    clock.now = start + PARTY_INVITE_KEEP_MS;
    expect(friends.inboxOf("alex")).toEqual([]);
  });

  it("is not pushed out by what the same friend sends after it", () => {
    const world = befriended();
    const { friends, clock } = world;
    asked(world, clock.now + 24 * HOUR);
    for (let i = 0; i < INBOX_PER_SENDER + 5; i++) {
      clock.now += 1;
      friends.deliver("sam", "alex", { kind: "recommend", title: `Film ${i}`, url: `https://filmpire.sc/watch/${i}` });
    }
    const items = friends.inboxOf("sam");
    expect(items.filter((item) => item.kind === "recommend")).toHaveLength(INBOX_PER_SENDER);
    expect(items.filter((item) => item.kind === "plan")).toHaveLength(1);
  });

  it("is done, in both inboxes, when the two go to a party, if it is on and its time has come or is near; one for later, and a question, stay", () => {
    const world = befriended();
    const { friends, clock } = world;
    const start = clock.now;
    const soon = asked(world, start + HOUR);
    const later = asked(world, start + 24 * HOUR);
    asked(world, start + 48 * HOUR); // (a question)
    friends.answerPlan("sam", soon, "yes", true);
    friends.answerPlan("sam", later, "yes", true);

    friends.settlePlans("alex", "sam");
    expect(friends.inboxOf("sam")).toHaveLength(3); // (nothing has come yet)
    expect(friends.inboxOf("alex")).toHaveLength(2);

    clock.now = start + HOUR - PLAN_SETTLE_AHEAD_MS - 1; // (a little too early for a party to be this plan)
    friends.settlePlans("alex", "sam");
    expect(friends.inboxOf("sam")).toHaveLength(3);
    expect(friends.inboxOf("alex")).toHaveLength(2);

    clock.now = start + HOUR - PLAN_SETTLE_AHEAD_MS; // (a party that is started a little early is this plan)
    friends.settlePlans("alex", "sam");
    expect(plansIn(world, "sam", start)).toEqual([[48 * HOUR, undefined], [24 * HOUR, "yes"]]);
    expect(plansIn(world, "alex", start)).toEqual([[24 * HOUR, "yes"]]);

    clock.now = start + 24 * HOUR + 60_000; // (and one whose time has come)
    friends.settlePlans("alex", "sam");
    expect(plansIn(world, "sam", start)).toEqual([[48 * HOUR, undefined]]);
    expect(plansIn(world, "alex", start)).toEqual([]);
  });

  it("goes when the friends part, from both inboxes", () => {
    const world = befriended();
    const { friends, clock } = world;
    friends.answerPlan("sam", asked(world, clock.now + HOUR), "yes", true);
    asked(world, clock.now + 2 * HOUR);
    expect(friends.inboxOf("sam")).toHaveLength(2);
    expect(friends.inboxOf("alex")).toHaveLength(1);
    friends.unfriend("sam", "alex");
    expect(friends.inboxOf("sam")).toEqual([]);
    expect(friends.inboxOf("alex")).toEqual([]);
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
    // (A plan with its answer, and one still waiting for it.)
    const when = first.clock.now + 3_600_000;
    const asked = first.friends.propose("sam", "alex", { kind: "plan", when, note: "after dinner" });
    expect(asked.ok).toBe(true);
    first.friends.answerPlan("sam", first.friends.openPlan("sam", asked.ok ? asked.value.id : "")!, "yes", true);
    expect(first.friends.propose("sam", "alex", { kind: "plan", when: when + 3_600_000 }).ok).toBe(true);
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
