import { randomBytes, randomInt } from "node:crypto";
import {
  CODE_ALPHABET,
  INBOX_KEEP_MS,
  INBOX_MAX,
  INBOX_PER_SENDER,
  INVITE_CODE_LENGTH,
  INVITE_TTL_MS,
  MAX_FRIENDS,
  MAX_OPEN_INVITES,
  PARTY_INVITE_KEEP_MS,
  type InboxItem,
  type Message,
} from "../../shared";
import { normalise } from "./links";

/**
 * Who is whose friend, the codes that make friends, and what friends have sent each other. A friend is a profile (not an
 * account): each person in a family has their own. The book only knows about ids; whether a friend may see something is for the
 * routes to decide from the other profile's settings, which the account store keeps.
 *
 * It is kept the way everything else is: a document for each profile's friends and inbox and for each code, written by the
 * store behind the scenes (`host.touch`), read back at start (`load`).
 */

/** The store, as far as this needs it. */
export interface FriendHost {
  touch(key: string): void;
  drop(key: string): void;
  now(): number;
}

export type FriendError = "invite_gone" | "own_invite" | "already_friends" | "friends_full";
export type Outcome<T> = { ok: true; value: T } | { ok: false; error: FriendError };

interface FriendsDoc {
  v: 1;
  friends: Array<{ id: string; since: number }>;
}
interface InboxDoc {
  v: 1;
  items: InboxItem[];
}
export interface Invite {
  v: 1;
  code: string;
  /** The profile that made it. */
  from: string;
  expiresAt: number;
}

const PREFIXES = ["friends:", "inbox:", "finvite:"] as const;

const newItemId = () => `m_${randomBytes(9).toString("base64url")}`;
const newCode = () => Array.from({ length: INVITE_CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");

export class FriendBook {
  /** profile -> its friends -> since when. Always both ways. */
  private readonly friends = new Map<string, Map<string, number>>();
  private readonly inboxes = new Map<string, InboxItem[]>();
  private readonly invites = new Map<string, Invite>();

  constructor(private readonly host: FriendHost) {}

  /* ------------------------------ persistence ------------------------------ */

  /** Whether a stored document is the book's. */
  static owns(key: string): boolean {
    return PREFIXES.some((prefix) => key.startsWith(prefix));
  }

  load(key: string, value: unknown): void {
    if (key.startsWith("friends:")) {
      const doc = value as FriendsDoc;
      const map = new Map(doc.friends.map((friend) => [friend.id, friend.since] as const));
      if (map.size > 0) this.friends.set(key.slice("friends:".length), map);
    } else if (key.startsWith("inbox:")) {
      const doc = value as InboxDoc;
      if (doc.items.length > 0) this.inboxes.set(key.slice("inbox:".length), doc.items);
    } else if (key.startsWith("finvite:")) {
      const doc = value as Invite;
      // (A code that ran out while the server was off is no use to anybody: its row goes, instead of staying in the store for ever.)
      if (doc.expiresAt > this.host.now()) this.invites.set(doc.code, doc);
      else this.host.drop(key);
    }
  }

  docFor(key: string): unknown {
    if (key.startsWith("friends:")) {
      const map = this.friends.get(key.slice("friends:".length));
      return map && ({ v: 1, friends: [...map].map(([id, since]) => ({ id, since })) } satisfies FriendsDoc);
    }
    if (key.startsWith("inbox:")) {
      const items = this.inboxes.get(key.slice("inbox:".length));
      return items && ({ v: 1, items } satisfies InboxDoc);
    }
    if (key.startsWith("finvite:")) return this.invites.get(key.slice("finvite:".length));
    return undefined;
  }

  /* ------------------------------ friends ------------------------------ */

  /** The profiles this one is a friend of, with since when. */
  friendsOf(profileId: string): Array<{ id: string; since: number }> {
    return [...(this.friends.get(profileId) ?? [])].map(([id, since]) => ({ id, since }));
  }

  areFriends(a: string, b: string): boolean {
    return this.friends.get(a)?.has(b) === true;
  }

  private count(profileId: string): number {
    return this.friends.get(profileId)?.size ?? 0;
  }

  private add(owner: string, friend: string, since: number): void {
    const map = this.friends.get(owner) ?? new Map<string, number>();
    map.set(friend, since);
    this.friends.set(owner, map);
    this.host.touch(`friends:${owner}`);
  }

  private remove(owner: string, friend: string): boolean {
    const map = this.friends.get(owner);
    if (!map?.delete(friend)) return false;
    if (map.size === 0) {
      this.friends.delete(owner);
      this.host.drop(`friends:${owner}`);
    } else this.host.touch(`friends:${owner}`);
    return true;
  }

  /**
   * Stop being friends, on both sides: `a` is the one who ended it. What they had sent each other goes too, and so do the codes `a`
   * still has out: one that `b` was given (or saw on a screen) would otherwise bring them straight back. Whether they were friends.
   */
  unfriend(a: string, b: string): boolean {
    const was = this.remove(a, b);
    const back = this.remove(b, a);
    this.without(a, b);
    this.without(b, a);
    if (was || back) for (const invite of this.invitesOf(a)) this.removeInvite(invite.code);
    return was || back;
  }

  /** A profile is gone: it is nobody's friend, nothing of it is in an inbox, and its codes are void. */
  forget(profileId: string): void {
    for (const friend of [...(this.friends.get(profileId)?.keys() ?? [])]) this.remove(friend, profileId);
    if (this.friends.delete(profileId)) this.host.drop(`friends:${profileId}`);
    if (this.inboxes.delete(profileId)) this.host.drop(`inbox:${profileId}`);
    for (const owner of [...this.inboxes.keys()]) this.without(owner, profileId);
    for (const invite of [...this.invites.values()]) if (invite.from === profileId) this.removeInvite(invite.code);
  }

  /* ------------------------------ codes ------------------------------ */

  private live(code: string): Invite | undefined {
    const invite = this.invites.get(code);
    if (!invite) return undefined;
    if (invite.expiresAt <= this.host.now()) {
      this.removeInvite(code);
      return undefined;
    }
    return invite;
  }

  private removeInvite(code: string): void {
    if (this.invites.delete(code)) this.host.drop(`finvite:${code}`);
  }

  /** The codes a profile has out, the oldest first. */
  invitesOf(profileId: string): Invite[] {
    return [...this.invites.values()]
      .filter((invite) => invite.from === profileId && this.live(invite.code))
      .sort((a, b) => a.expiresAt - b.expiresAt);
  }

  /** A new code for one friend to use. A profile with too many out takes back the oldest. */
  createInvite(profileId: string): Invite {
    const mine = this.invitesOf(profileId);
    for (const old of mine.slice(0, Math.max(0, mine.length - MAX_OPEN_INVITES + 1))) this.removeInvite(old.code);
    let code = newCode();
    while (this.invites.has(code)) code = newCode();
    const invite: Invite = { v: 1, code, from: profileId, expiresAt: this.host.now() + INVITE_TTL_MS };
    this.invites.set(code, invite);
    this.host.touch(`finvite:${code}`);
    return invite;
  }

  /** Take back a code its maker gave out. Whether there was one. */
  revokeInvite(profileId: string, code: string): boolean {
    const invite = this.live(normalise(code));
    if (!invite || invite.from !== profileId) return false;
    this.removeInvite(invite.code);
    return true;
  }

  /** Who made a code, if it can still be used. */
  peekInvite(code: string): Invite | undefined {
    return this.live(normalise(code));
  }

  /** Use a code: the profile and its maker are friends, and the code is spent. */
  redeem(profileId: string, code: string): Outcome<{ friend: string; since: number }> {
    const invite = this.live(normalise(code));
    if (!invite) return { ok: false, error: "invite_gone" };
    if (invite.from === profileId) return { ok: false, error: "own_invite" };
    if (this.areFriends(profileId, invite.from)) return { ok: false, error: "already_friends" };
    if (this.count(profileId) >= MAX_FRIENDS || this.count(invite.from) >= MAX_FRIENDS) return { ok: false, error: "friends_full" };
    this.removeInvite(invite.code);
    const since = this.host.now();
    this.add(profileId, invite.from, since);
    this.add(invite.from, profileId, since);
    return { ok: true, value: { friend: invite.from, since } };
  }

  /* ------------------------------ the inbox ------------------------------ */

  private setInbox(owner: string, items: InboxItem[]): void {
    if (items.length === 0) {
      this.inboxes.delete(owner);
      this.host.drop(`inbox:${owner}`);
    } else {
      this.inboxes.set(owner, items);
      this.host.touch(`inbox:${owner}`);
    }
  }

  /** What is in a profile's inbox, newest first, with what has gone stale (old things, and invitations to parties that are over) let go. */
  inboxOf(profileId: string): InboxItem[] {
    const items = this.inboxes.get(profileId);
    if (!items) return [];
    const now = this.host.now();
    const fresh = items.filter((item) => now - item.at < (item.kind === "party" ? PARTY_INVITE_KEEP_MS : INBOX_KEEP_MS));
    if (fresh.length !== items.length) this.setInbox(profileId, fresh);
    return fresh;
  }

  /**
   * Put something in an inbox. The same title from the same friend, or a newer invitation from them to a party, replaces the old one and
   * is new again; but one that has not been looked at yet keeps its id, so that sending it over and over is not announced over and over
   * (a screen announces what it has not seen the id of). A friend has only so many things in an inbox (the newest): they cannot fill it
   * and push out what the others sent.
   */
  deliver(to: string, from: string, message: Message): InboxItem {
    const sameThing = (old: InboxItem) => old.from === from && old.kind === message.kind && (message.kind === "party" || (old.kind === "recommend" && old.url === message.url));
    const items = this.inboxOf(to);
    const before = items.find(sameThing);
    const item = { ...message, id: before && !before.read ? before.id : newItemId(), at: this.host.now(), from, read: false } as InboxItem;
    let theirs = 1; // (this one is the first of the friend's)
    const kept = items.filter((old) => !sameThing(old) && (old.from !== from || ++theirs <= INBOX_PER_SENDER));
    this.setInbox(to, [item, ...kept].slice(0, INBOX_MAX));
    return item;
  }

  /** Everything in the inbox has been seen. How many were not. */
  markRead(profileId: string): number {
    const items = this.inboxOf(profileId);
    const unread = items.filter((item) => !item.read).length;
    if (unread > 0) this.setInbox(profileId, items.map((item) => (item.read ? item : { ...item, read: true })));
    return unread;
  }

  /** Throw one thing away. Whether it was there. */
  dismiss(profileId: string, itemId: string): boolean {
    const items = this.inboxOf(profileId);
    const kept = items.filter((item) => item.id !== itemId);
    if (kept.length === items.length) return false;
    this.setInbox(profileId, kept);
    return true;
  }

  /** Throw away what one friend sent. */
  private without(owner: string, sender: string): void {
    const items = this.inboxes.get(owner);
    if (!items) return;
    const kept = items.filter((item) => item.from !== sender);
    if (kept.length !== items.length) this.setInbox(owner, kept);
  }
}
