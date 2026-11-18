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
  MAX_REQUESTS,
  PARTY_INVITE_KEEP_MS,
  PLAN_KEEP_AFTER_MS,
  PLAN_OPEN_PER_PAIR,
  PLAN_OPEN_PER_SENDER,
  PLAN_SETTLE_AHEAD_MS,
  REQUEST_KEEP_MS,
  planAsks,
  planTimeProblem,
  type InboxItem,
  type Message,
  type PlanAnswer,
  type PlanItem,
} from "../../shared";
import { normalise } from "./links";

export interface FriendHost {
  touch(key: string): void;
  drop(key: string): void;
  now(): number;
  delivered?(to: string, from: string, what: "recommend" | "party" | "together" | "plan" | "planYes" | "planNo"): void;
}

export type FriendError = "invite_gone" | "own_invite" | "already_friends" | "friends_full" | "own_request" | "request_gone" | "plan_soon" | "plan_far" | "plan_full" | "plan_gone";
export type Outcome<T> = { ok: true; value: T } | { ok: false; error: FriendError };

interface FriendsDoc {
  v: 1;
  friends: Array<{ id: string; since: number }>;
}
interface RequestsDoc {
  v: 1;
  items: Array<{ from: string; at: number }>;
}
export type StoredItem = InboxItem & { host?: string; party?: string };
interface InboxDoc {
  v: 1;
  items: StoredItem[];
}
export interface Invite {
  v: 1;
  code: string;
  from: string;
  expiresAt: number;
}
export interface PlanReply {
  kind: "plan";
  when: number;
  answer: PlanAnswer;
}

const PREFIXES = ["friends:", "inbox:", "finvite:", "frequests:"] as const;

const keptUntil = (item: StoredItem): number => {
  if (item.kind === "recommend") return item.at + INBOX_KEEP_MS;
  if (item.kind !== "plan") return item.at + PARTY_INVITE_KEEP_MS;
  if (item.answer === "yes") return item.when + PLAN_KEEP_AFTER_MS;
  return item.answer === "no" ? item.at + PARTY_INVITE_KEEP_MS : item.when;
};

const newItemId = () => `m_${randomBytes(9).toString("base64url")}`;
const newCode = () => Array.from({ length: INVITE_CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");

export class FriendBook {
  private readonly friends = new Map<string, Map<string, number>>();
  private readonly inboxes = new Map<string, StoredItem[]>();
  private readonly invites = new Map<string, Invite>();
  private readonly requests = new Map<string, Map<string, number>>();

  constructor(private readonly host: FriendHost) {}

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
      if (doc.expiresAt > this.host.now()) this.invites.set(doc.code, doc);
      else this.host.drop(key);
    } else if (key.startsWith("frequests:")) {
      const doc = value as RequestsDoc;
      const map = new Map(doc.items.map((item) => [item.from, item.at] as const));
      if (map.size > 0) this.requests.set(key.slice("frequests:".length), map);
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
    if (key.startsWith("frequests:")) {
      const map = this.requests.get(key.slice("frequests:".length));
      return map && ({ v: 1, items: [...map].map(([from, at]) => ({ from, at })) } satisfies RequestsDoc);
    }
    return undefined;
  }

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

  unfriend(a: string, b: string): boolean {
    const was = this.remove(a, b);
    const back = this.remove(b, a);
    this.without(a, b);
    this.without(b, a);
    if (was || back) for (const invite of this.invitesOf(a)) this.removeInvite(invite.code);
    return was || back;
  }

  forget(profileId: string): void {
    for (const friend of [...(this.friends.get(profileId)?.keys() ?? [])]) this.remove(friend, profileId);
    if (this.friends.delete(profileId)) this.host.drop(`friends:${profileId}`);
    if (this.inboxes.delete(profileId)) this.host.drop(`inbox:${profileId}`);
    for (const owner of [...this.inboxes.keys()]) this.without(owner, profileId);
    for (const invite of [...this.invites.values()]) if (invite.from === profileId) this.removeInvite(invite.code);
    if (this.requests.delete(profileId)) this.host.drop(`frequests:${profileId}`);
    for (const recipient of [...this.requests.keys()]) this.dropRequest(recipient, profileId);
  }

  private befriend(a: string, b: string, since: number): void {
    this.add(a, b, since);
    this.add(b, a, since);
    this.dropRequest(a, b);
    this.dropRequest(b, a);
  }

  private setRequests(recipient: string, map: Map<string, number>): void {
    if (map.size === 0) {
      this.requests.delete(recipient);
      this.host.drop(`frequests:${recipient}`);
    } else {
      this.requests.set(recipient, map);
      this.host.touch(`frequests:${recipient}`);
    }
  }

  private dropRequest(recipient: string, sender: string): boolean {
    const map = this.requests.get(recipient);
    if (!map?.delete(sender)) return false;
    this.setRequests(recipient, map);
    return true;
  }

  requestsTo(profileId: string): Array<{ from: string; at: number }> {
    const map = this.requests.get(profileId);
    if (!map) return [];
    const now = this.host.now();
    const fresh = new Map([...map].filter(([, at]) => now - at < REQUEST_KEEP_MS));
    if (fresh.size !== map.size) this.setRequests(profileId, fresh);
    return [...fresh].map(([from, at]) => ({ from, at })).sort((a, b) => b.at - a.at);
  }

  requestsBy(profileId: string): Array<{ to: string; at: number }> {
    const asked: Array<{ to: string; at: number }> = [];
    for (const recipient of [...this.requests.keys()]) {
      const at = this.requestsTo(recipient).find((request) => request.from === profileId)?.at;
      if (at !== undefined) asked.push({ to: recipient, at });
    }
    return asked.sort((a, b) => b.at - a.at);
  }

  request(from: string, to: string): Outcome<{ friends: boolean; at: number }> {
    if (from === to) return { ok: false, error: "own_request" };
    if (this.areFriends(from, to)) return { ok: false, error: "already_friends" };
    if (this.count(from) >= MAX_FRIENDS || this.count(to) >= MAX_FRIENDS) return { ok: false, error: "friends_full" };
    const at = this.host.now();
    if (this.requestsTo(from).some((asked) => asked.from === to)) {
      this.befriend(from, to, at);
      return { ok: true, value: { friends: true, at } };
    }
    const waiting = new Map(this.requests.get(to));
    waiting.set(from, at);
    this.setRequests(to, new Map([...waiting].sort((a, b) => b[1] - a[1]).slice(0, MAX_REQUESTS)));
    return { ok: true, value: { friends: false, at } };
  }

  acceptRequest(profileId: string, from: string): Outcome<{ since: number }> {
    if (!this.requestsTo(profileId).some((asked) => asked.from === from)) return { ok: false, error: "request_gone" };
    if (this.count(profileId) >= MAX_FRIENDS || this.count(from) >= MAX_FRIENDS) return { ok: false, error: "friends_full" };
    const since = this.host.now();
    this.befriend(profileId, from, since);
    return { ok: true, value: { since } };
  }

  declineRequest(profileId: string, from: string): boolean {
    return this.dropRequest(profileId, from);
  }

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

  invitesOf(profileId: string): Invite[] {
    return [...this.invites.values()]
      .filter((invite) => invite.from === profileId && this.live(invite.code))
      .sort((a, b) => a.expiresAt - b.expiresAt);
  }

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

  revokeInvite(profileId: string, code: string): boolean {
    const invite = this.live(normalise(code));
    if (!invite || invite.from !== profileId) return false;
    this.removeInvite(invite.code);
    return true;
  }

  peekInvite(code: string): Invite | undefined {
    return this.live(normalise(code));
  }

  redeem(profileId: string, code: string): Outcome<{ friend: string; since: number }> {
    const invite = this.live(normalise(code));
    if (!invite) return { ok: false, error: "invite_gone" };
    if (invite.from === profileId) return { ok: false, error: "own_invite" };
    if (this.areFriends(profileId, invite.from)) return { ok: false, error: "already_friends" };
    if (this.count(profileId) >= MAX_FRIENDS || this.count(invite.from) >= MAX_FRIENDS) return { ok: false, error: "friends_full" };
    this.removeInvite(invite.code);
    const since = this.host.now();
    this.befriend(profileId, invite.from, since);
    return { ok: true, value: { friend: invite.from, since } };
  }

  private setInbox(owner: string, items: StoredItem[]): void {
    if (items.length === 0) {
      this.inboxes.delete(owner);
      this.host.drop(`inbox:${owner}`);
    } else {
      this.inboxes.set(owner, items);
      this.host.touch(`inbox:${owner}`);
    }
  }

  inboxOf(profileId: string): StoredItem[] {
    const items = this.inboxes.get(profileId);
    if (!items) return [];
    const now = this.host.now();
    const fresh = items.filter((item) => now < keptUntil(item));
    if (fresh.length !== items.length) this.setInbox(profileId, fresh);
    return fresh;
  }

  deliver(to: string, from: string, message: Message | PlanReply, party?: { host: string; party: string }): StoredItem {
    const sameThing = (old: InboxItem) => {
      if (old.from !== from || old.kind !== message.kind) return false;
      if (message.kind === "recommend") return old.kind === "recommend" && old.url === message.url;
      if (message.kind === "plan") return old.kind === "plan" && old.when === message.when && ("answer" in message || old.answer === undefined);
      return true;
    };
    const items = this.inboxOf(to);
    const before = items.find(sameThing);
    const item = { ...message, ...(party ? { host: party.host, party: party.party } : {}), id: before && !before.read ? before.id : newItemId(), at: this.host.now(), from, read: false } as StoredItem;
    let theirs = 1;
    const kept = items.filter((old) => !sameThing(old) && (old.kind === "plan" || old.from !== from || ++theirs <= INBOX_PER_SENDER));
    this.setInbox(to, [item, ...kept].slice(0, INBOX_MAX));
    if (!before || before.read) {
      const what = message.kind === "plan" && "answer" in message ? (message.answer === "yes" ? "planYes" : "planNo") : message.kind;
      this.host.delivered?.(to, from, what);
    }
    return item;
  }

  private waitingFor(owner: string, from: string): Array<StoredItem & PlanItem> {
    const now = this.host.now();
    return this.inboxOf(owner).filter((item): item is StoredItem & PlanItem => item.kind === "plan" && item.from === from && planAsks(item, now));
  }

  propose(to: string, from: string, plan: Extract<Message, { kind: "plan" }>): Outcome<StoredItem> {
    const problem = planTimeProblem(plan.when, this.host.now());
    if (problem) return { ok: false, error: problem === "too_soon" ? "plan_soon" : "plan_far" };
    const on = this.inboxOf(to).find((item) => item.kind === "plan" && item.from === from && item.when === plan.when && item.answer === "yes");
    if (on) return { ok: true, value: on };
    const waiting = this.waitingFor(to, from);
    if (!waiting.some((item) => item.when === plan.when)) {
      if (waiting.length >= PLAN_OPEN_PER_PAIR) return { ok: false, error: "plan_full" };
      const inAll = this.friendsOf(from).reduce((sum, friend) => sum + this.waitingFor(friend.id, from).length, 0);
      if (inAll >= PLAN_OPEN_PER_SENDER) return { ok: false, error: "plan_full" };
    }
    return { ok: true, value: this.deliver(to, from, plan) };
  }

  openPlan(owner: string, itemId: string): (StoredItem & PlanItem) | undefined {
    const now = this.host.now();
    return this.inboxOf(owner).find((item): item is StoredItem & PlanItem => item.id === itemId && item.kind === "plan" && planAsks(item, now));
  }

  answerPlan(owner: string, plan: PlanItem, answer: PlanAnswer, tell: boolean): void {
    const items = this.inboxOf(owner);
    this.setInbox(owner, answer === "yes" ? items.map((item) => (item.id === plan.id && item.kind === "plan" ? { ...item, answer, read: true } : item)) : items.filter((item) => item.id !== plan.id));
    if (tell) this.deliver(plan.from, owner, { kind: "plan", when: plan.when, answer });
  }

  settlePlans(a: string, b: string): void {
    const now = this.host.now();
    for (const [owner, other] of [[a, b], [b, a]] as const) {
      const items = this.inboxOf(owner);
      const kept = items.filter((item) => !(item.kind === "plan" && item.from === other && item.answer === "yes" && item.when <= now + PLAN_SETTLE_AHEAD_MS));
      if (kept.length !== items.length) this.setInbox(owner, kept);
    }
  }

  answerTogether(owner: string, asker: string): boolean {
    const items = this.inboxOf(owner);
    const kept = items.filter((item) => !(item.kind === "together" && item.from === asker));
    if (kept.length === items.length) return false;
    this.setInbox(owner, kept);
    return true;
  }

  markRead(profileId: string): number {
    const items = this.inboxOf(profileId);
    const unread = items.filter((item) => !item.read).length;
    if (unread > 0) this.setInbox(profileId, items.map((item) => (item.read ? item : { ...item, read: true })));
    return unread;
  }

  dismiss(profileId: string, itemId: string): boolean {
    const items = this.inboxOf(profileId);
    const kept = items.filter((item) => item.id !== itemId);
    if (kept.length === items.length) return false;
    this.setInbox(profileId, kept);
    return true;
  }

  private without(owner: string, sender: string): void {
    const items = this.inboxes.get(owner);
    if (!items) return;
    const kept = items.filter((item) => item.from !== sender);
    if (kept.length !== items.length) this.setInbox(owner, kept);
  }
}
