import {
  CHAT_KEEP_MAX,
  CHAT_KEEP_MS,
  CHAT_REACTS_PER_MINUTE,
  CHAT_REPORT_LINES,
  CHAT_SENDS_PER_MINUTE,
  checkChatText,
  isChatReaction,
  isStickerId,
  PERSONAL_STICKER_TEXT,
  type ChatLine,
  type ChatNotice,
  type ChatReaction,
  type ChatTextProblem,
  type ChatThread,
} from "../../shared";
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
  /** `from` wrote to `to`, who has not muted them (what the app's notifications are told of: push/push.ts). */
  wrote?(from: string, to: string): void;
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
  /** The reactions on it: profile -> one of `CHAT_REACTIONS`. Not there when it has none. */
  r?: Record<string, string>;
  /** The `rev` of the last change to its reactions (see `readSince`): a line from before it was kept has the chat's `rev` of when it was read in. */
  rr?: number;
  /** A personal sticker (shared/stickers.ts): its name; the text is then `PERSONAL_STICKER_TEXT`. The line keeps no hold on the picture (stickers.ts). */
  s?: string;
}

/** What is kept of a pair. (`said` and the reactions came later, and are optional: a server from before them still reads the document, and ignores them.) */
interface ChatDoc {
  v: 1;
  /** The two profiles, in the order of the key. */
  a: string;
  b: string;
  /** Goes up with every change to the messages, and never below the clock: a chat that is taken off and made again does not repeat a number. */
  rev: number;
  /**
   * The `rev` of the last change to what was said (a message sent, taken back, or let go), not to the reactions. A report is checked against it: a reaction
   * put on and taken off does not make what was shown "changed", so the one reported cannot hold a report off that way (the advisor, 17 Nov).
   */
  said?: number;
  lines: Written[];
  /** Who has seen up to which message (the `n` of the newest they have seen). */
  seen: Record<string, number>;
  /** Who has muted the other. */
  muted: string[];
}

/** How long a chat with nothing left in it is still there as a revision (see `tidy`). */
export const EMPTY_CHAT_KEEP_MS = 24 * 3600 * 1000;

const PREFIX = "chat:";
const keyOf = (a: string, b: string) => (a < b ? `${PREFIX}${a}:${b}` : `${PREFIX}${b}:${a}`);
const no = (error: ChatError, waitMs?: number): { ok: false; error: ChatError; waitMs?: number } => ({ ok: false, error, ...(waitMs ? { waitMs } : {}) });

export class ChatBook {
  private readonly chats = new Map<string, ChatDoc>();
  /** profile -> the keys of its chats. */
  private readonly of = new Map<string, Set<string>>();
  private readonly sends: RateLimiter;
  private readonly reacts: RateLimiter;

  constructor(private readonly host: ChatHost) {
    this.sends = new RateLimiter(CHAT_SENDS_PER_MINUTE, 60_000, () => host.now());
    this.reacts = new RateLimiter(CHAT_REACTS_PER_MINUTE, 60_000, () => host.now());
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
    // (Reactions that are not right are let go, not the chat: they are the least of it.)
    for (const line of doc.lines) {
      if (line.r === undefined) continue;
      const kept = typeof line.r === "object" && line.r !== null ? Object.entries(line.r).filter(([profile, reaction]) => (profile === doc.a || profile === doc.b) && isChatReaction(reaction)) : [];
      if (kept.length > 0) line.r = Object.fromEntries(kept);
      else delete line.r;
    }
    // (A sticker's name that is not one is let go: the line is then its words.)
    for (const line of doc.lines) if (line.s !== undefined && !isStickerId(line.s)) delete line.s;
    if (typeof doc.said !== "number") doc.said = doc.rev;
    // (A line whose reactions last changed nobody knows when, as of now: a screen that has an older revision is told its reactions, which is a few bytes and
    // never wrong. See `readSince`.)
    for (const line of doc.lines) if (typeof line.rr !== "number" || line.rr > doc.rev) line.rr = doc.rev;
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
   * Let go of what has been kept too long, and of what there are too many of. A chat with nothing in it and nothing muted is not kept for long:
   * for a day after its last change it stays as a revision and nothing else, so that a screen which has the chat open, and shows a message that
   * was just taken back, is told that it is gone (an empty chat that was already forgotten would read as revision 0, older than what the
   * screen has, and would be taken for a late answer). Whether the chat is still there.
   */
  private tidy(key: string, doc: ChatDoc): boolean {
    const now = this.host.now();
    const kept = doc.lines.filter((line) => now - line.at < CHAT_KEEP_MS).slice(-CHAT_KEEP_MAX);
    if (kept.length !== doc.lines.length) {
      doc.lines = kept;
      doc.rev = this.next(doc);
      doc.said = doc.rev;
      this.host.touch(key);
    }
    if (doc.lines.length === 0 && doc.muted.length === 0 && now - doc.rev >= EMPTY_CHAT_KEEP_MS) {
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
    const doc: ChatDoc = { v: 1, a: first, b: second, rev: 0, said: 0, lines: [], seen: {}, muted: [] };
    this.chats.set(key, doc);
    for (const profile of [first, second]) this.of.set(profile, (this.of.get(profile) ?? new Set()).add(key));
    return doc;
  }

  private view(doc: ChatDoc | undefined, me: string, friend: string): ChatView {
    return {
      rev: doc?.rev ?? 0,
      open: this.host.takes(friend),
      muted: doc?.muted.includes(me) ?? false,
      lines: (doc?.lines ?? []).map((line) => {
        const mineOn = line.r?.[me];
        const theirsOn = line.r?.[friend];
        return {
          id: line.n,
          at: line.at,
          mine: line.from === me,
          text: line.text,
          ...(isChatReaction(mineOn) ? { myReaction: mineOn } : {}),
          ...(isChatReaction(theirsOn) ? { theirReaction: theirsOn } : {}),
          ...(line.s ? { sticker: line.s } : {}),
        };
      }),
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

  /**
   * The chat of `me` with `friend`, for a screen that has it at revision `since` (`ChatThread`): only its state when nothing changed since; when only
   * reactions changed (nothing was said since: `said`) and the screen takes such an answer (`compact`), the messages whose reactions changed, with their
   * reactions as they are now; else every message. (A friend who puts reactions on and takes them off again cannot make each of the other's looks bring
   * the whole chat, two hundred messages, many times a minute: the judge, 17 Nov.)
   */
  readSince(me: string, friend: string, since: number | undefined, compact: boolean): ChatOutcome<ChatThread> {
    const read = this.read(me, friend);
    if (!read.ok) return read;
    const { lines, ...state } = read.value;
    if (since === state.rev) return { ok: true, value: state };
    const doc = this.find(me, friend);
    if (!compact || !doc || since === undefined || since < (doc.said ?? doc.rev) || since > doc.rev) return { ok: true, value: read.value };
    const changed = new Set(doc.lines.filter((line) => (line.rr ?? doc.rev) > since).map((line) => line.n));
    const reactions = lines
      .filter((line) => changed.has(line.id))
      .map(({ id, myReaction, theirReaction }) => ({ id, ...(myReaction ? { myReaction } : {}), ...(theirReaction ? { theirReaction } : {}) }));
    return { ok: true, value: { ...state, reactions } };
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
    const checked = checkChatText(raw);
    return this.write(from, to, checked.ok ? { text: checked.text } : checked.error);
  }

  /**
   * `from` sends `to` one of its personal stickers (the routes have checked that it has it: see stickers.ts). It is a message as any other (the same rules,
   * the same count a minute), whose words are `PERSONAL_STICKER_TEXT`.
   */
  sendSticker(from: string, to: string, id: string): ChatOutcome<ChatView> {
    return this.write(from, to, isStickerId(id) ? { text: PERSONAL_STICKER_TEXT, s: id } : "gone");
  }

  /** Whether a personal sticker was sent in the chat of two friends (and is still in it): only then may either of them see it there, or save it. */
  hasSticker(me: string, friend: string, id: string): boolean {
    if (me === friend || !this.host.areFriends(me, friend)) return false;
    return this.find(me, friend)?.lines.some((line) => line.s === id) ?? false;
  }

  private write(from: string, to: string, said: { text: string; s?: string } | ChatError): ChatOutcome<ChatView> {
    if (!this.friendly(from, to)) return no("not_friends");
    if (!this.host.on(from)) return no("friends_off");
    if (!this.host.takes(to)) return no("chat_off");
    if (typeof said === "string") return no(said);
    const wait = this.sends.wait(from);
    if (wait > 0) return no("rate_limited", wait);
    this.sends.hit(from);
    const doc = this.make(from, to);
    const n = this.next(doc);
    doc.rev = n;
    doc.lines = [...doc.lines, { n, from, at: this.host.now(), ...said, rr: n }].slice(-CHAT_KEEP_MAX);
    doc.said = n;
    doc.seen[from] = n;
    this.host.touch(keyOf(from, to));
    if (!doc.muted.includes(to)) this.host.wrote?.(from, to);
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
    doc.said = doc.rev;
    this.host.touch(keyOf(me, friend));
    this.tidy(keyOf(me, friend), doc);
    return { ok: true, value: this.view(doc, me, friend) };
  }

  /**
   * `me` puts a reaction on a message (theirs or the friend's), changes it, or takes it away (`null`). The friend sees it at their next look; nothing waits for
   * them because of it (it is no message). Putting one on is writing to the friend, so it needs what a message needs: friends on, and a friend who takes
   * messages; taking one away is always possible. So many changes a minute.
   */
  react(me: string, friend: string, id: number, reaction: ChatReaction | null): ChatOutcome<ChatView> {
    if (!this.friendly(me, friend)) return no("not_friends");
    if (!this.host.on(me)) return no("friends_off");
    if (reaction !== null && !this.host.takes(friend)) return no("chat_off");
    const doc = this.find(me, friend);
    const line = doc?.lines.find((written) => written.n === id);
    if (!doc || !line) return no("gone");
    if ((line.r?.[me] ?? null) === reaction) return { ok: true, value: this.view(doc, me, friend) };
    const wait = this.reacts.wait(me);
    if (wait > 0) return no("rate_limited", wait);
    this.reacts.hit(me);
    const others = Object.entries(line.r ?? {}).filter(([profile]) => profile !== me);
    const now = reaction === null ? others : [...others, [me, reaction] as const];
    if (now.length > 0) line.r = Object.fromEntries(now);
    else delete line.r;
    doc.rev = this.next(doc); // (the screens that have the chat open see it at their next look; `said` does not move)
    line.rr = doc.rev;
    this.host.touch(keyOf(me, friend));
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
    // (What was said, and its revision: the reactions are not part of a report, and do not make one "changed". See `said`.)
    const doc = this.find(me, friend);
    // (A personal sticker's name goes with its line: the team is sent the picture with the report, see chatRoutes.ts.)
    const lines = read.value.lines.slice(-count).map(({ id, at, mine, text, sticker }) => ({ id, at, mine, text, ...(sticker ? { sticker } : {}) }));
    return { ok: true, value: { rev: doc ? (doc.said ?? doc.rev) : read.value.rev, lines } };
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
