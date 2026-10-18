import { CHAT_KEEP_MAX, CHAT_KEEP_MS, CHAT_REPORT_LINES, CHAT_SENDS_PER_MINUTE, checkChatText, type ChatLine, type ChatNotice, type ChatTextProblem } from "../../shared/chat";
import { RateLimiter } from "./rateLimit";

/**
 * What two friends have written to each other, and the rules of it, all in one place so that nothing depends on what a page says: only friends
 * write to each other, and only to one who takes messages; a message is plain text of so many characters; so many a minute; a pair keeps the newest
 * of them and for so long; taking a friend off, or a profile going, takes the chat with it; a message can be taken back by the one who wrote it.
 *
 * It is kept the way friends and inboxes are: a document for each pair, written by the store behind the scenes (`host.touch`), read back at start
 * (`load`). Nothing is encrypted: whoever runs the server could read it.
 */

/** The store and the friends, as far as this needs them. */
export interface ChatHost {
  touch(key: string): void;
  drop(key: string): void;
  now(): number;
  areFriends(a: string, b: string): boolean;
  /** Friends are turned on for the profile (the master switch), whatever else it has chosen. */
  on(profileId: string): boolean;
  /** The profile takes messages: friends are on, and "Friends can message me" is (it is on until it is turned off). */
  takes(profileId: string): boolean;
}

export type ChatError = "not_friends" | "friends_off" | "chat_off" | ChatTextProblem | "rate_limited" | "gone";
export type ChatOutcome<T> = { ok: true; value: T } | { ok: false; error: ChatError; /** Of `rate_limited`: how long until the next message may go. */ waitMs?: number };

/** A chat as one of the two sees it (the same as `ChatThread`, always with its messages). */
export interface ChatView {
  rev: number;
  open: boolean;
  muted: boolean;
  lines: ChatLine[];
}

interface Written {
  /** Names the message in its chat: the number the chat was at when it was written. */
  n: number;
  from: string;
  at: number;
  text: string;
}

/** What is kept of a pair. */
interface ChatDoc {
  v: 1;
  /** The two profiles, in the order of the key. */
  a: string;
  b: string;
  /** Goes up with every change to the messages, and never below the clock: a chat that is taken off and made again does not repeat a number. */
  rev: number;
  lines: Written[];
  /** Who has seen up to which message (the `n` of the newest they have seen). */
  seen: Record<string, number>;
  /** Who has muted the other. */
  muted: string[];
}

const PREFIX = "chat:";
const keyOf = (a: string, b: string) => (a < b ? `${PREFIX}${a}:${b}` : `${PREFIX}${b}:${a}`);
const no = (error: ChatError, waitMs?: number): { ok: false; error: ChatError; waitMs?: number } => ({ ok: false, error, ...(waitMs ? { waitMs } : {}) });

export class ChatBook {
  private readonly chats = new Map<string, ChatDoc>();
  /** profile -> the keys of its chats. */
  private readonly of = new Map<string, Set<string>>();
  private readonly sends: RateLimiter;

  constructor(private readonly host: ChatHost) {
    this.sends = new RateLimiter(CHAT_SENDS_PER_MINUTE, 60_000, () => host.now());
  }

  /* ------------------------------ persistence ------------------------------ */

  /** Whether a stored document is a chat's. */
  static owns(key: string): boolean {
    return key.startsWith(PREFIX);
  }

  load(key: string, value: unknown): void {
    const doc = value as ChatDoc;
    const well = (line: Written) => typeof line?.n === "number" && typeof line.from === "string" && typeof line.at === "number" && typeof line.text === "string";
    if (typeof doc?.a !== "string" || typeof doc.b !== "string" || typeof doc.rev !== "number" || !Array.isArray(doc.lines) || !doc.lines.every(well) || !Array.isArray(doc.muted) || typeof doc.seen !== "object" || doc.seen === null) {
      throw new Error("not a chat"); // (the store skips it and says so: one record that is not right must not stop the others from loading)
    }
    this.chats.set(key, doc);
    for (const profile of [doc.a, doc.b]) this.of.set(profile, (this.of.get(profile) ?? new Set()).add(key));
    // (What ran out while the server was off is let go now, not whenever somebody next looks.)
    this.tidy(key, doc);
  }

  docFor(key: string): unknown {
    return this.chats.get(key);
  }

  /* ------------------------------ the pair ------------------------------ */

  /** Take a chat out of the book, and out of the store. */
  private discard(key: string): void {
    const doc = this.chats.get(key);
    if (!doc) return;
    this.chats.delete(key);
    for (const profile of [doc.a, doc.b]) {
      const keys = this.of.get(profile);
      keys?.delete(key);
      if (keys?.size === 0) this.of.delete(profile);
    }
    this.host.drop(key);
  }

  /** The next number of a chat. */
  private next(doc: ChatDoc): number {
    return Math.max(doc.rev + 1, this.host.now());
  }

  /**
   * Let go of what has been kept too long, and of what there are too many of. A chat with nothing in it and nothing muted is not kept at all.
   * Whether the chat is still there.
   */
  private tidy(key: string, doc: ChatDoc): boolean {
    const now = this.host.now();
    const kept = doc.lines.filter((line) => now - line.at < CHAT_KEEP_MS).slice(-CHAT_KEEP_MAX);
    if (kept.length !== doc.lines.length) {
      doc.lines = kept;
      doc.rev = this.next(doc);
      this.host.touch(key);
    }
    if (doc.lines.length === 0 && doc.muted.length === 0) {
      this.discard(key);
      return false;
    }
    return true;
  }

  /** The chat of two profiles, if there is one. */
  private find(a: string, b: string): ChatDoc | undefined {
    const key = keyOf(a, b);
    const doc = this.chats.get(key);
    return doc && this.tidy(key, doc) ? doc : undefined;
  }

  private make(a: string, b: string): ChatDoc {
    const key = keyOf(a, b);
    const found = this.find(a, b);
    if (found) return found;
    const [first, second] = a < b ? [a, b] : [b, a];
    const doc: ChatDoc = { v: 1, a: first, b: second, rev: 0, lines: [], seen: {}, muted: [] };
    this.chats.set(key, doc);
    for (const profile of [first, second]) this.of.set(profile, (this.of.get(profile) ?? new Set()).add(key));
    return doc;
  }

  private view(doc: ChatDoc | undefined, me: string, friend: string): ChatView {
    return {
      rev: doc?.rev ?? 0,
      open: this.host.takes(friend),
      muted: doc?.muted.includes(me) ?? false,
      lines: (doc?.lines ?? []).map((line) => ({ id: line.n, at: line.at, mine: line.from === me, text: line.text })),
    };
  }

  /** Two profiles that are not friends have no chat: whatever is left of one (the friendship ended some other way) goes. */
  private friendly(me: string, friend: string): boolean {
    if (me !== friend && this.host.areFriends(me, friend)) return true;
    this.dropChat(me, friend);
    return false;
  }

  /* ------------------------------ reading and writing ------------------------------ */

  /** The chat of `me` with `friend`, as `me` sees it: empty before anything was written. */
  read(me: string, friend: string): ChatOutcome<ChatView> {
    if (!this.friendly(me, friend)) return no("not_friends");
    return { ok: true, value: this.view(this.find(me, friend), me, friend) };
  }

  /** Everything in the chat has been looked at by `me`. */
  markSeen(me: string, friend: string): void {
    const doc = this.find(me, friend);
    const newest = doc?.lines.at(-1)?.n;
    if (!doc || newest === undefined || (doc.seen[me] ?? 0) >= newest) return;
    doc.seen[me] = newest;
    this.host.touch(keyOf(me, friend));
  }

  /**
   * `from` writes to `to`. Friends only, and only to one who takes messages; the text is made fit to show and measured; so many a minute from one
   * sender. A message counts as seen by its writer, who had the chat open to write it.
   */
  send(from: string, to: string, raw: string): ChatOutcome<ChatView> {
    if (!this.friendly(from, to)) return no("not_friends");
    if (!this.host.on(from)) return no("friends_off");
    if (!this.host.takes(to)) return no("chat_off");
    const checked = checkChatText(raw);
    if (!checked.ok) return no(checked.error);
    const wait = this.sends.wait(from);
    if (wait > 0) return no("rate_limited", wait);
    this.sends.hit(from);
    const doc = this.make(from, to);
    const n = this.next(doc);
    doc.rev = n;
    doc.lines = [...doc.lines, { n, from, at: this.host.now(), text: checked.text }].slice(-CHAT_KEEP_MAX);
    doc.seen[from] = n;
    this.host.touch(keyOf(from, to));
    return { ok: true, value: this.view(doc, from, to) };
  }

  /** `me` takes back a message of their own: it is gone for both. (One of the friend's, or one that is gone already, is "gone".) */
  takeBack(me: string, friend: string, id: number): ChatOutcome<ChatView> {
    if (!this.friendly(me, friend)) return no("not_friends");
    const doc = this.find(me, friend);
    const at = doc?.lines.findIndex((line) => line.n === id && line.from === me) ?? -1;
    if (!doc || at < 0) return no("gone");
    doc.lines = doc.lines.filter((_, index) => index !== at);
    doc.rev = this.next(doc);
    this.host.touch(keyOf(me, friend));
    this.tidy(keyOf(me, friend), doc);
    return { ok: true, value: this.view(doc, me, friend) };
  }

  /** `me` stops hearing of `friend`'s messages (or hears of them again): the friend is not told, and can go on writing. */
  mute(me: string, friend: string, muted: boolean): ChatOutcome<boolean> {
    if (!this.friendly(me, friend)) return no("not_friends");
    const doc = muted ? this.make(me, friend) : this.find(me, friend);
    if (!doc || doc.muted.includes(me) === muted) return { ok: true, value: muted };
    doc.muted = muted ? [...doc.muted, me] : doc.muted.filter((profile) => profile !== me);
    this.host.touch(keyOf(me, friend));
    this.tidy(keyOf(me, friend), doc);
    return { ok: true, value: muted };
  }

  /**
   * What the report of a chat would hold, as it stands now: the last of the messages (the `rev` says which state of the chat that is), and the
   * messages that are being reported are the ones both of them saw.
   */
  lastLines(me: string, friend: string, count = CHAT_REPORT_LINES): ChatOutcome<{ rev: number; lines: ChatLine[] }> {
    const read = this.read(me, friend);
    if (!read.ok) return read;
    return { ok: true, value: { rev: read.value.rev, lines: read.value.lines.slice(-count) } };
  }

  /* ------------------------------ what waits ------------------------------ */

  /** The messages from friends that `me` has not looked at, a friend at a time, the newest first. Not the ones from a friend that is muted. */
  unread(me: string): ChatNotice[] {
    const waiting: ChatNotice[] = [];
    for (const key of [...(this.of.get(me) ?? [])]) {
      const doc = this.chats.get(key);
      if (!doc || !this.tidy(key, doc)) continue;
      const friend = doc.a === me ? doc.b : doc.a;
      if (doc.muted.includes(me) || !this.host.areFriends(me, friend)) continue;
      const seen = doc.seen[me] ?? 0;
      const fresh = doc.lines.filter((line) => line.from === friend && line.n > seen);
      const newest = fresh.at(-1);
      if (newest) waiting.push({ friend, count: fresh.length, at: newest.at });
    }
    return waiting.sort((x, y) => y.at - x.at);
  }

  /* ------------------------------ ending ------------------------------ */

  /** Two profiles stop being friends: what they wrote to each other goes. */
  dropChat(a: string, b: string): void {
    this.discard(keyOf(a, b));
  }

  /** A profile is gone: so is every chat it was in. */
  forget(profileId: string): void {
    for (const key of [...(this.of.get(profileId) ?? [])]) this.discard(key);
  }
}
