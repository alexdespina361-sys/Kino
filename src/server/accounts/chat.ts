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
  type ChatTalk,
  type ChatTextProblem,
  type ChatThread,
} from "../../shared";
import { RateLimiter } from "./rateLimit";

export interface ChatHost {
  touch(key: string): void;
  drop(key: string): void;
  now(): number;
  areFriends(a: string, b: string): boolean;
  on(profileId: string): boolean;
  takes(profileId: string): boolean;
  wrote?(from: string, to: string): void;
}

export type ChatError = "not_friends" | "friends_off" | "chat_off" | ChatTextProblem | "rate_limited" | "gone";
export type ChatOutcome<T> = { ok: true; value: T } | { ok: false; error: ChatError; waitMs?: number };

export interface ChatView {
  rev: number;
  open: boolean;
  muted: boolean;
  theirSeen?: number;
  theirGot?: number;
  lines: ChatLine[];
}

interface Written {
  n: number;
  from: string;
  at: number;
  text: string;
  r?: Record<string, string>;
  rr?: number;
  s?: string;
  q?: number;
}

interface ChatDoc {
  v: 1;
  a: string;
  b: string;
  rev: number;
  said?: number;
  lines: Written[];
  seen: Record<string, number>;
  got?: Record<string, number>;
  muted: string[];
}

export const EMPTY_CHAT_KEEP_MS = 24 * 3600 * 1000;

const PREFIX = "chat:";
const keyOf = (a: string, b: string) => (a < b ? `${PREFIX}${a}:${b}` : `${PREFIX}${b}:${a}`);
const no = (error: ChatError, waitMs?: number): { ok: false; error: ChatError; waitMs?: number } => ({ ok: false, error, ...(waitMs ? { waitMs } : {}) });

export class ChatBook {
  private readonly chats = new Map<string, ChatDoc>();
  private readonly of = new Map<string, Set<string>>();
  private readonly sends: RateLimiter;
  private readonly reacts: RateLimiter;

  constructor(private readonly host: ChatHost) {
    this.sends = new RateLimiter(CHAT_SENDS_PER_MINUTE, 60_000, () => host.now());
    this.reacts = new RateLimiter(CHAT_REACTS_PER_MINUTE, 60_000, () => host.now());
  }

  static owns(key: string): boolean {
    return key.startsWith(PREFIX);
  }

  load(key: string, value: unknown): void {
    const doc = value as ChatDoc;
    const well = (line: Written) => typeof line?.n === "number" && typeof line.from === "string" && typeof line.at === "number" && typeof line.text === "string";
    if (typeof doc?.a !== "string" || typeof doc.b !== "string" || typeof doc.rev !== "number" || !Array.isArray(doc.lines) || !doc.lines.every(well) || !Array.isArray(doc.muted) || typeof doc.seen !== "object" || doc.seen === null) {
      throw new Error("not a chat");
    }
    for (const line of doc.lines) {
      if (line.r === undefined) continue;
      const kept = typeof line.r === "object" && line.r !== null ? Object.entries(line.r).filter(([profile, reaction]) => (profile === doc.a || profile === doc.b) && isChatReaction(reaction)) : [];
      if (kept.length > 0) line.r = Object.fromEntries(kept);
      else delete line.r;
    }
    for (const line of doc.lines) if (line.s !== undefined && !isStickerId(line.s)) delete line.s;
    for (const line of doc.lines) if (line.q !== undefined && !(Number.isSafeInteger(line.q) && line.q >= 0 && line.q < line.n)) delete line.q;
    if (typeof doc.said !== "number") doc.said = doc.rev;
    if (doc.got !== undefined) {
      const got = typeof doc.got === "object" && doc.got !== null ? Object.entries(doc.got).filter(([profile, n]) => (profile === doc.a || profile === doc.b) && Number.isSafeInteger(n) && n >= 0) : [];
      if (got.length > 0) doc.got = Object.fromEntries(got);
      else delete doc.got;
    }
    for (const line of doc.lines) if (typeof line.rr !== "number" || line.rr > doc.rev) line.rr = doc.rev;
    this.chats.set(key, doc);
    for (const profile of [doc.a, doc.b]) this.of.set(profile, (this.of.get(profile) ?? new Set()).add(key));
    this.tidy(key, doc);
  }

  docFor(key: string): unknown {
    return this.chats.get(key);
  }

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

  private next(doc: ChatDoc): number {
    return Math.max(doc.rev + 1, this.host.now());
  }

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
    const theirSeen = doc?.seen[friend] ?? 0;
    const theirGot = Math.max(theirSeen, doc?.got?.[friend] ?? 0);
    return {
      rev: doc?.rev ?? 0,
      open: this.host.takes(friend),
      muted: doc?.muted.includes(me) ?? false,
      ...(theirSeen > 0 ? { theirSeen } : {}),
      ...(theirGot > 0 ? { theirGot } : {}),
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
          ...(line.q !== undefined ? { replyTo: line.q } : {}),
        };
      }),
    };
  }

  private friendly(me: string, friend: string): boolean {
    if (me !== friend && this.host.areFriends(me, friend)) return true;
    this.dropChat(me, friend);
    return false;
  }

  read(me: string, friend: string): ChatOutcome<ChatView> {
    if (!this.friendly(me, friend)) return no("not_friends");
    return { ok: true, value: this.view(this.find(me, friend), me, friend) };
  }

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

  markSeen(me: string, friend: string): void {
    const doc = this.find(me, friend);
    const newest = doc?.lines.at(-1)?.n;
    if (!doc || newest === undefined || (doc.seen[me] ?? 0) >= newest) return;
    doc.seen[me] = newest;
    this.host.touch(keyOf(me, friend));
  }

  send(from: string, to: string, raw: string, replyTo?: number): ChatOutcome<ChatView> {
    const checked = checkChatText(raw);
    return this.write(from, to, checked.ok ? { text: checked.text } : checked.error, replyTo);
  }

  sendSticker(from: string, to: string, id: string, replyTo?: number): ChatOutcome<ChatView> {
    return this.write(from, to, isStickerId(id) ? { text: PERSONAL_STICKER_TEXT, s: id } : "gone", replyTo);
  }

  hasSticker(me: string, friend: string, id: string): boolean {
    if (me === friend || !this.host.areFriends(me, friend)) return false;
    return this.find(me, friend)?.lines.some((line) => line.s === id) ?? false;
  }

  private write(from: string, to: string, said: { text: string; s?: string } | ChatError, replyTo?: number): ChatOutcome<ChatView> {
    if (!this.friendly(from, to)) return no("not_friends");
    if (!this.host.on(from)) return no("friends_off");
    if (!this.host.takes(to)) return no("chat_off");
    if (typeof said === "string") return no(said);
    const wait = this.sends.wait(from);
    if (wait > 0) return no("rate_limited", wait);
    this.sends.hit(from);
    const doc = this.make(from, to);
    const n = this.next(doc);
    const quoted = replyTo !== undefined && doc.lines.some((line) => line.n === replyTo);
    doc.rev = n;
    doc.lines = [...doc.lines, { n, from, at: this.host.now(), ...said, ...(quoted ? { q: replyTo } : {}), rr: n }].slice(-CHAT_KEEP_MAX);
    doc.said = n;
    doc.seen[from] = n;
    this.host.touch(keyOf(from, to));
    if (!doc.muted.includes(to)) this.host.wrote?.(from, to);
    return { ok: true, value: this.view(doc, from, to) };
  }

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
    doc.rev = this.next(doc);
    line.rr = doc.rev;
    this.host.touch(keyOf(me, friend));
    return { ok: true, value: this.view(doc, me, friend) };
  }

  mute(me: string, friend: string, muted: boolean): ChatOutcome<boolean> {
    if (!this.friendly(me, friend)) return no("not_friends");
    const doc = muted ? this.make(me, friend) : this.find(me, friend);
    if (!doc || doc.muted.includes(me) === muted) return { ok: true, value: muted };
    doc.muted = muted ? [...doc.muted, me] : doc.muted.filter((profile) => profile !== me);
    this.host.touch(keyOf(me, friend));
    this.tidy(keyOf(me, friend), doc);
    return { ok: true, value: muted };
  }

  lastLines(me: string, friend: string, count = CHAT_REPORT_LINES): ChatOutcome<{ rev: number; lines: ChatLine[] }> {
    const read = this.read(me, friend);
    if (!read.ok) return read;
    const doc = this.find(me, friend);
    const lines = read.value.lines.slice(-count).map(({ id, at, mine, text, sticker }) => ({ id, at, mine, text, ...(sticker ? { sticker } : {}) }));
    return { ok: true, value: { rev: doc ? (doc.said ?? doc.rev) : read.value.rev, lines } };
  }

  unread(me: string, received = true): ChatNotice[] {
    const waiting: ChatNotice[] = [];
    for (const key of [...(this.of.get(me) ?? [])]) {
      const doc = this.chats.get(key);
      if (!doc || !this.tidy(key, doc)) continue;
      const friend = doc.a === me ? doc.b : doc.a;
      if (!this.host.areFriends(me, friend)) continue;
      const seen = doc.seen[me] ?? 0;
      const fresh = doc.lines.filter((line) => line.from === friend && line.n > seen);
      const newest = fresh.at(-1);
      if (received && newest && (doc.got?.[me] ?? 0) < newest.n) {
        doc.got = { ...doc.got, [me]: newest.n };
        this.host.touch(key);
      }
      if (newest && !doc.muted.includes(me)) waiting.push({ friend, count: fresh.length, at: newest.at });
    }
    return waiting.sort((x, y) => y.at - x.at);
  }

  talks(me: string): ChatTalk[] {
    const talks: ChatTalk[] = [];
    for (const key of [...(this.of.get(me) ?? [])]) {
      const doc = this.chats.get(key);
      if (!doc || !this.tidy(key, doc)) continue;
      const friend = doc.a === me ? doc.b : doc.a;
      const last = doc.lines.at(-1);
      if (!last || !this.host.areFriends(me, friend)) continue;
      const seen = doc.seen[me] ?? 0;
      const unread = doc.lines.filter((line) => line.from === friend && line.n > seen).length;
      talks.push({
        friend,
        last: { id: last.n, at: last.at, mine: last.from === me, text: last.text, ...(last.s ? { sticker: last.s } : {}) },
        unread,
        ...(doc.muted.includes(me) ? { muted: true } : {}),
      });
    }
    return talks.sort((x, y) => y.last.at - x.last.at);
  }

  dropChat(a: string, b: string): void {
    this.discard(keyOf(a, b));
  }

  forget(profileId: string): void {
    for (const key of [...(this.of.get(profileId) ?? [])]) this.discard(key);
  }
}
