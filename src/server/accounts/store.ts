import { createHash, randomBytes } from "node:crypto";
import {
  AVATAR_IDS,
  COLLECTIONS,
  fillListItem,
  fillProgress,
  friendChoices,
  LIMITS,
  MAX_PROFILES,
  mergeCollection,
  nameFromEmail,
  nameKey,
  newerOf,
  nextAvatar,
  plainText,
  resolveSettings,
  SETTING_SCHEMAS,
  takesMessages,
  type AvatarId,
  type CollectionName,
  type DeviceKind,
  type LiveListItem,
  type LiveProgress,
  type Profile,
  type SessionInfo,
  type SettingKey,
  type Settings,
  type SyncItem,
  type SyncRequest,
  type SyncResponse,
} from "../../shared";
import { gifOf } from "../../shared/gifs";
import { ChatBook } from "./chat";
import { FriendBook } from "./friends";
import type { Persistence } from "./persistence";
import { MemoryStickerFiles, type StickerFiles } from "./stickerFiles";
import { StickerBook } from "./stickers";

/* ------------------------------ what is kept ------------------------------ */

interface ProfileMeta extends Profile {
  createdAt: number;
  /**
   * When a screen of this profile last looked after its friends (what friends are told as "Last online", see `markSeen`), as last written down: up to
   * `SEEN_WRITE_MS` older than the last look while the server runs, to the moment once it has stopped. Absent: never, or not since it chose not to be seen.
   */
  seenAt?: number;
}
interface AccountDoc {
  v: 1;
  id: string;
  email: string;
  hash: string;
  createdAt: number;
  profiles: ProfileMeta[];
  /**
   * The Google account that signs in to this one (see google.ts): Google's own number for the person (`sub`) and nothing else of theirs. `only`: the account was made by
   * signing in with Google, so its name is one the server made up and nobody knows its password (the hash is of a random secret that was never kept).
   */
  google?: { sub: string; only?: true };
  /** The scrypt hash of the PIN asked before a child's profile is left on the account's screens (see `CHILD_PIN_LENGTH`). Absent: there is none. */
  childPin?: string;
}
/** An item with the server's counter at the moment it last changed: what lets a screen ask only for what is new. */
interface Stamped {
  item: SyncItem;
  rev: number;
}
type DataDoc = { v: 1; rev: number } & Record<CollectionName, Stamped[]>;
interface SessionDoc {
  v: 1;
  /** sha256 of the token: the token itself is only ever in the cookie. */
  id: string;
  accountId: string;
  kind: DeviceKind;
  label: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  /** Until when the person on this device has just proved again who they are (by signing in to Google again: what an account without a known password is deleted with). */
  reauthUntil?: number;
  /**
   * The Android app on this device (push/push.ts): where Firebase reaches it, and the profile it is on, whose friends' messages it is told of. It is the session's, so
   * signing out, or the sign-in ending any way, forgets it; choosing another profile in the app says so again.
   */
  push?: { token: string; profileId: string; at: number };
}

/** Something a profile is told of on its phones (push/push.ts): a friend wrote, or put something in its inbox. */
export type StoreNotice = { kind: "chat"; from: string; to: string } | { kind: "inbox"; from: string; to: string; what: "recommend" | "party" | "together" | "plan" | "planYes" | "planNo" };

/** How long a device token can be (Firebase's are about 160 characters) and what it is made of. */
export const PUSH_TOKEN_PATTERN = /^[A-Za-z0-9:_-]{20,4096}$/;
interface ProfileData {
  rev: number;
  collections: Record<CollectionName, Map<string, Stamped>>;
  /** What its live items weigh (bytes of JSON), as last weighed: see `SYNC_ACCOUNT_BYTES`. */
  weight?: number;
}

/**
 * What all the profiles of one account may keep together, and every account of the site, before a new item is not kept (what is kept stays, and changes
 * to it are taken). Each profile's own budgets (`BYTE_BUDGET`) come to about 1.9 MB, five profiles to 9.2 MB, and 500 accounts to some gigabytes, held
 * in memory by a server that may use one (the review of 18 Nov: nothing said how much the whole site keeps). On 18 Nov the largest profile weighed 42 KB
 * and all of them together 67 KB, so these are hundreds of times what anybody keeps. The site's is env SYNC_SITE_MB.
 */
export const SYNC_ACCOUNT_BYTES = 2 * 1024 * 1024;
export const SYNC_SITE_BYTES = 64 * 1024 * 1024;

/** A sign-in lasts this long after the device was last used (a browser will not keep a cookie longer than about 400 days). Signing out, or clearing the browser's cookies, is what ends it sooner. */
export const SESSION_TTL_MS = 400 * 24 * 3600 * 1000;
const SESSION_TOUCH_MS = 3600 * 1000;
/** A sign-in that ran out this long ago is let go of when the server starts (see `load`). */
const SESSION_GONE_MS = 7 * 24 * 3600 * 1000;
/** A profile's last look is written down at most this often (a screen looks every half minute): "Last online" after a restart is at most this much early. */
export const SEEN_WRITE_MS = 10 * 60 * 1000;
const MAX_SESSIONS = 20;
/** A clock that runs ahead must not make its items win for ever. */
const FUTURE_SLACK_MS = 60_000;
/** When a write fails (the database is waking up, the network blinked), try again after this. */
const RETRY_MS = 10_000;
/**
 * The most the live items of one part of a profile may weigh (their JSON, in bytes as it is written down: a letter that is not ASCII is two or three of them, and the
 * schemas count letters), the newest first. The counts in `LIMITS` alone leave room for items of some kilobytes each, which is about 8 MB for one profile and some
 * dozens of MB for one account. These are far above what anybody keeps (400 titles in the lists, or 500 ratings, of a kilobyte each use 60% and 75% of theirs), so they
 * only ever hold back a profile that is filled with text on purpose. The saved pictures' never does: 60 GIFs at the longest a key can be (about 845 bytes each)
 * are 50 KB (what goes past a budget goes without a removal to say so, and the screens would then differ, the judge, 17 Nov).
 */
const BYTE_BUDGET: Record<CollectionName, number> = { progress: 192 * 1024, watched: 256 * 1024, list: 640 * 1024, listNames: 32 * 1024, ratings: 640 * 1024, settings: 64 * 1024, saved: 56 * 1024 };

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const newId = (prefix: string) => `${prefix}_${randomBytes(9).toString("base64url")}`;
/** What an account made by signing in with Google is called where a name is needed: `g-` and 12 lower-case letters and digits (60 bits) nobody chose. */
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
const googleLogin = () => `g-${[...randomBytes(12)].map((byte) => BASE32[byte & 31]).join("")}`;
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const canonicalName = (name: string) => name.normalize("NFC").trim().toLowerCase();
/** A profile as it is told to others: who it is, and the tag that names it (kept apart from `createdAt`, which is the server's). */
const publicProfile = ({ id, name, avatar, tag }: ProfileMeta): Profile => ({ id, name, avatar, ...(tag !== undefined ? { tag } : {}) });
/** A profile as its own account is told of it: also whether it is still to be set up (see `ProfileSchema.setup`), which is nobody else's to know. */
const ownProfile = (profile: ProfileMeta): Profile => ({ ...publicProfile(profile), ...(profile.setup ? { setup: profile.setup } : {}) });
/** The part of a session id that is shown and used to ask for it to be ended: enough to tell sessions apart, and no use as a token. */
const shortId = (id: string) => id.slice(0, 16);

export type StoreError = "email_taken" | "google_taken" | "profile_limit" | "name_taken" | "last_profile" | "not_found";
export type Result<T> = { ok: true; value: T } | { ok: false; error: StoreError };
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: StoreError): Result<never> => ({ ok: false, error });

/** How the accounts are used, in numbers and moments only (what the owner's stats are made of): nothing here says who anyone is. */
export interface AccountUsage {
  profiles: number;
  /** When each account was made (ms), the oldest first. */
  madeAt: number[];
  /** For each account with a device signed in: when the most recently used of its devices was last used (ms), the oldest first. A device that signed out is not here. */
  lastUsedAt: number[];
  /** The devices signed in, by what they are (`tv`, `remote`, `browser`). */
  devices: Record<string, number>;
}

export interface StoreOptions {
  persistence: Persistence;
  now?: () => number;
  /** How long changes wait before they are written; they are also written when the server stops. */
  flushMs?: number;
  log?: { warn(message: string): void };
  /**
   * Personal stickers (shared/stickers.ts): where their pictures are kept (memory unless set), whether the host turned them on (off unless it did:
   * env PERSONAL_STICKERS) and stickers that move (env MOVING_STICKERS), and how many bytes of pictures the site keeps.
   */
  stickers?: { files?: StickerFiles; on?: boolean; moving?: boolean; maxBytes?: number; uploadMs?: number };
  /**
   * A new profile is still to be set up by whoever uses it (`Profile.setup`: its name and picture, its subtitles, what it watches). Off unless set:
   * the site turns it on (index.ts; env PROFILE_SETUP=off turns it off again), and what only makes accounts to try something else is asked nothing.
   */
  askSetup?: boolean;
  /** What one account's profiles and the whole site's may keep (`SYNC_ACCOUNT_BYTES`, `SYNC_SITE_BYTES` unless set). */
  syncAccountBytes?: number;
  syncSiteBytes?: number;
}

/**
 * Accounts, profiles, sessions and everything a profile keeps. All of it lives in memory (a personal server's worth is a
 * few megabytes) and is written behind the scenes through a `Persistence`, a moment after it changes and again when the
 * server stops.
 */
export class AccountStore {
  private readonly accounts = new Map<string, AccountDoc>();
  private readonly emails = new Map<string, string>();
  /** Google's number for a person -> the account it signs in to (one account for each, and one Google account for each account). */
  private readonly googles = new Map<string, string>();
  private readonly data = new Map<string, ProfileData>();
  private readonly profileOwner = new Map<string, string>();
  private readonly sessions = new Map<string, SessionDoc>();
  /** What a profile is called by name -> the tags in use with it -> whose they are (see `takeTag`). */
  private readonly tags = new Map<string, Map<number, string>>();
  /** Who is whose friend, the codes that make friends and the inboxes (see friends.ts); kept and written like the rest. */
  private readonly book = new FriendBook({
    touch: (key) => this.touch(key),
    drop: (key) => this.drop(key),
    now: () => this.now(),
    delivered: (to, from, what) => this.tell({ kind: "inbox", from, to, what }),
  });
  /** What friends have written to each other (see chat.ts); kept and written like the rest. Who may write to whom is read from the friends and the settings as they are. */
  private readonly talk = new ChatBook({
    touch: (key) => this.touch(key),
    drop: (key) => this.drop(key),
    now: () => this.now(),
    areFriends: (a, b) => this.book.areFriends(a, b),
    on: (profileId) => friendChoices(this.settingsOf(profileId)).friends,
    takes: (profileId) => takesMessages(this.settingsOf(profileId)),
    wrote: (from, to) => this.tell({ kind: "chat", from, to }),
  });

  /** Who hears of what a profile is told of (push/push.ts): nobody unless the app's notifications are on. */
  private listener: ((notice: StoreNotice) => void) | undefined;
  /** `listener` hears of every message and inbox item a profile gets from now on (one listener: the last one given). */
  onNotice(listener: ((notice: StoreNotice) => void) | undefined): void {
    this.listener = listener;
  }
  private tell(notice: StoreNotice): void {
    try {
      this.listener?.(notice);
    } catch (error) {
      this.options.log?.warn(`A notice was not passed on: ${(error as Error).message}`);
    }
  }

  /** When a screen of each profile last looked, to the moment (see `markSeen`): what is written down of it is a little older. */
  private readonly seen = new Map<string, number>();

  private readonly dirty = new Set<string>();
  private readonly removed = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flushing: Promise<void> = Promise.resolve();

  /** The personal stickers (see stickers.ts); kept and written like the rest, their pictures apart. */
  private readonly stickerBook: StickerBook;

  private constructor(private readonly options: Required<Omit<StoreOptions, "log" | "stickers">> & Pick<StoreOptions, "log" | "stickers">) {
    const stickers = options.stickers ?? {};
    this.stickerBook = new StickerBook(
      { touch: (key) => this.touch(key), drop: (key) => this.drop(key), now: () => this.now(), on: (profileId) => this.profileOwner.has(profileId) && friendChoices(this.settingsOf(profileId)).friends },
      stickers.files ?? new MemoryStickerFiles(),
      { on: stickers.on ?? false, moving: stickers.moving ?? false, ...(stickers.maxBytes ? { maxBytes: stickers.maxBytes } : {}), ...(stickers.uploadMs ? { uploadMs: stickers.uploadMs } : {}), ...(options.log ? { log: options.log } : {}) },
    );
  }

  static async open(options: StoreOptions): Promise<AccountStore> {
    const store = new AccountStore({ now: Date.now, flushMs: 1500, askSetup: false, syncAccountBytes: SYNC_ACCOUNT_BYTES, syncSiteBytes: SYNC_SITE_BYTES, ...options });
    await store.load();
    for (const profile of store.data.values()) store.weigh(profile);
    // (A picture whose record was never written, or a record whose picture is not there, is let go: the two are kept in different places. Only where they are
    // on: a host that has them off is not asked anything about them, its database not even given their table; nothing can be made there to tidy.)
    if (store.stickerBook.on) await store.stickerBook.reconcile();
    return store;
  }

  private now() {
    return this.options.now();
  }

  /* ------------------------------ persistence ------------------------------ */

  private async load() {
    for (const [key, value] of await this.options.persistence.load()) {
      try {
        if (key.startsWith("account:")) {
          const doc = value as AccountDoc;
          this.accounts.set(doc.id, doc);
          this.emails.set(doc.email, doc.id);
          for (const profile of doc.profiles) this.profileOwner.set(profile.id, doc.id);
          if (doc.google) {
            // (Two accounts with one Google account cannot be made here; one written by hand signs in nowhere rather than in the wrong place.)
            if (this.googles.has(doc.google.sub)) this.options.log?.warn(`Two accounts have the same Google account: ${doc.id} is not signed in to with it.`);
            else this.googles.set(doc.google.sub, doc.id);
          }
        } else if (key.startsWith("pdata:")) {
          const doc = value as DataDoc;
          this.data.set(key.slice("pdata:".length), {
            rev: doc.rev,
            collections: Object.fromEntries(COLLECTIONS.map((name) => [name, new Map((doc[name] ?? []).map((stamped) => [stamped.item.key, stamped]))])) as ProfileData["collections"],
          });
        } else if (key.startsWith("session:")) {
          const doc = value as SessionDoc;
          // (One that ran out a week ago or more is let go for good, and with it where its device was reached, the judge, 17 Nov; one that ran out since is only
          // not used, as before: a clock that is wrong for a moment as the server starts signs nobody out for good.)
          if (doc.expiresAt > this.now()) this.sessions.set(doc.id, doc);
          else if (doc.expiresAt <= this.now() - SESSION_GONE_MS) this.drop(key);
        } else if (FriendBook.owns(key)) {
          this.book.load(key, value);
        } else if (ChatBook.owns(key)) {
          this.talk.load(key, value);
        } else if (StickerBook.owns(key)) {
          this.stickerBook.load(key, value);
        }
      } catch {
        this.options.log?.warn(`Skipped an unreadable record (${key}).`);
      }
    }
    this.indexTags();
  }

  /** Every profile has a tag. The ones made before there were tags (or whose tag somebody else has) are given theirs now, the older first. */
  private indexTags(): void {
    const missing: Array<{ account: AccountDoc; profile: ProfileMeta }> = [];
    for (const account of this.accounts.values()) {
      for (const profile of account.profiles) {
        const key = nameKey(profile.name);
        const used = this.tags.get(key) ?? new Map<number, string>();
        if (profile.tag !== undefined && !used.has(profile.tag)) {
          used.set(profile.tag, profile.id);
          this.tags.set(key, used);
        } else missing.push({ account, profile });
      }
    }
    for (const { account, profile } of missing.sort((a, b) => a.profile.createdAt - b.profile.createdAt)) {
      this.takeTag(profile);
      this.touch(`account:${account.id}`);
    }
  }

  /** The tag a profile has (see `tagLabel`): the number it has (`keep`) if that is free, else the lowest number nobody with that name has. */
  private takeTag(profile: ProfileMeta, keep?: number): void {
    const key = nameKey(profile.name);
    const used = this.tags.get(key) ?? new Map<number, string>();
    let tag = keep !== undefined && !used.has(keep) ? keep : 1;
    while (used.has(tag)) tag++;
    used.set(tag, profile.id);
    this.tags.set(key, used);
    profile.tag = tag;
  }

  /** Give a profile's tag back (its name is about to change, or it is going). */
  private freeTag(profile: ProfileMeta): void {
    if (profile.tag === undefined) return;
    const key = nameKey(profile.name);
    const used = this.tags.get(key);
    if (used?.get(profile.tag) !== profile.id) return;
    used.delete(profile.tag);
    if (used.size === 0) this.tags.delete(key);
  }

  /** The profile with this name and this tag (names are compared as `nameKey` does). */
  profileByTag(name: string, tag: number): string | undefined {
    return this.tags.get(nameKey(name))?.get(tag);
  }

  /** Something changed: write it soon. (`flushMs: 0` leaves the writing to whoever calls `flush`, which is what tests do.) */
  private schedule(delay = this.options.flushMs) {
    if (this.options.flushMs <= 0) return;
    this.timer ??= setTimeout(() => void this.flush(), delay);
    this.timer.unref?.();
  }
  private touch(key: string) {
    this.removed.delete(key);
    this.dirty.add(key);
    this.schedule();
  }
  private drop(key: string) {
    this.dirty.delete(key);
    this.removed.add(key);
    this.schedule();
  }

  private docFor(key: string): unknown {
    if (key.startsWith("account:")) return this.accounts.get(key.slice("account:".length));
    if (key.startsWith("session:")) return this.sessions.get(key.slice("session:".length));
    if (FriendBook.owns(key)) return this.book.docFor(key);
    if (ChatBook.owns(key)) return this.talk.docFor(key);
    if (StickerBook.owns(key)) return this.stickerBook.docFor(key);
    if (key.startsWith("pdata:")) {
      const profileData = this.data.get(key.slice("pdata:".length));
      if (!profileData) return undefined;
      const doc = { v: 1, rev: profileData.rev, ...Object.fromEntries(COLLECTIONS.map((name) => [name, [...profileData.collections[name].values()]])) } as DataDoc;
      return doc;
    }
    return undefined;
  }

  /** Write what changed. Resolves when it is written; a failure is kept to try again with the next change. */
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.flushing = this.flushing.catch(() => {}).then(async () => {
      if (this.dirty.size === 0 && this.removed.size === 0) return;
      const put = new Map<string, unknown>();
      for (const key of this.dirty) {
        const doc = this.docFor(key);
        if (doc !== undefined) put.set(key, doc);
      }
      const remove = new Set(this.removed);
      this.dirty.clear();
      this.removed.clear();
      try {
        await this.options.persistence.save({ put, remove });
      } catch (error) {
        // Keep it for the next try, unless it changed again while this one was running (the newer change is already queued).
        for (const key of put.keys()) if (!this.removed.has(key)) this.dirty.add(key);
        for (const key of remove) if (!this.dirty.has(key)) this.removed.add(key);
        this.options.log?.warn(`Could not save accounts: ${(error as Error).message}`);
        this.schedule(RETRY_MS);
      }
    });
    return this.flushing;
  }

  async close() {
    // (The last looks as they were to the moment: after a restart a friend is told when the profile was last online, and not up to ten minutes before.)
    for (const [profileId, at] of this.seen) {
      const found = this.metaOf(profileId);
      if (!found || found.profile.seenAt === at) continue;
      found.profile.seenAt = at;
      this.touch(`account:${found.account.id}`);
    }
    await this.flush();
    await this.options.persistence.close?.();
  }

  /* ------------------------------ accounts ------------------------------ */

  countAccounts() {
    return this.accounts.size;
  }
  /** Every profile there is (for what looks after all of them: the notices of new episodes, server/titleNotices). */
  profileIds(): string[] {
    return [...this.profileOwner.keys()];
  }
  usage(): AccountUsage {
    const now = this.now();
    const lastUsed = new Map<string, number>();
    const devices: Record<string, number> = {};
    for (const session of this.sessions.values()) {
      if (session.expiresAt <= now || !this.accounts.has(session.accountId)) continue;
      devices[session.kind] = (devices[session.kind] ?? 0) + 1;
      lastUsed.set(session.accountId, Math.max(lastUsed.get(session.accountId) ?? 0, session.lastSeenAt));
    }
    const accounts = [...this.accounts.values()];
    return {
      profiles: accounts.reduce((sum, account) => sum + account.profiles.length, 0),
      madeAt: accounts.map((account) => account.createdAt).sort((a, b) => a - b),
      lastUsedAt: [...lastUsed.values()].sort((a, b) => a - b),
      devices,
    };
  }
  findByEmail(email: string): AccountDoc | undefined {
    const id = this.emails.get(email);
    return id ? this.accounts.get(id) : undefined;
  }
  getAccount(id: string): AccountDoc | undefined {
    return this.accounts.get(id);
  }

  /** A new account with its first profile, named after the address. */
  createAccount(email: string, hash: string): Result<AccountDoc> {
    if (this.emails.has(email)) return fail("email_taken");
    return ok(this.make(email, hash, nameFromEmail(email)));
  }

  /**
   * A new account for a person who signed in with Google and has none: it signs in with that Google account only. Its name is made up (`g-` and 12 letters
   * and digits nobody chose), its password is the hash given (of a secret nobody keeps), and its first profile is called `name`.
   */
  createGoogleAccount(sub: string, name: string, hash: string): Result<AccountDoc> {
    if (this.googles.has(sub)) return fail("google_taken");
    let login = googleLogin();
    while (this.emails.has(login)) login = googleLogin();
    return ok(this.make(login, hash, name, { sub, only: true }));
  }

  private make(email: string, hash: string, name: string, google?: AccountDoc["google"]): AccountDoc {
    // The first profile's picture goes round the twelve, one account after another: every new account was a fox, so friends looked the same in the
    // friends' list, the chat and the bell (the judge, 16 Nov). Its owner can change it as before.
    // (The first profile of a new account is still to be set up: its name was made from the e-mail, or is Google's, and nobody chose its picture.)
    const first = this.newProfile(name, AVATAR_IDS[this.accounts.size % AVATAR_IDS.length]!, "all");
    this.takeTag(first);
    const account: AccountDoc = { v: 1, id: newId("acc"), email, hash, createdAt: this.now(), profiles: [first], ...(google ? { google } : {}) };
    this.accounts.set(account.id, account);
    this.emails.set(email, account.id);
    if (google) this.googles.set(google.sub, account.id);
    this.profileOwner.set(first.id, account.id);
    this.data.set(first.id, emptyProfileData());
    this.touch(`account:${account.id}`);
    this.touch(`pdata:${first.id}`);
    return account;
  }

  /** The account a Google account signs in to, if it has one. */
  findByGoogle(sub: string): AccountDoc | undefined {
    const id = this.googles.get(sub);
    return id ? this.accounts.get(id) : undefined;
  }

  /** Let a Google account sign in to this account too (the account keeps its name and password). Not one that signs in to another account, nor a second one. */
  linkGoogle(accountId: string, sub: string): Result<null> {
    const account = this.accounts.get(accountId);
    if (!account) return fail("not_found");
    const owner = this.googles.get(sub);
    if (owner === accountId) return ok(null);
    if (owner !== undefined || account.google) return fail("google_taken");
    account.google = { sub };
    this.googles.set(sub, accountId);
    this.touch(`account:${accountId}`);
    return ok(null);
  }

  private newProfile(name: string, avatar: AvatarId, setup: NonNullable<Profile["setup"]>): ProfileMeta {
    return { id: newId("pro"), name, avatar, createdAt: this.now(), ...(this.options.askSetup ? { setup } : {}) };
  }

  setPasswordHash(accountId: string, hash: string) {
    const account = this.accounts.get(accountId);
    if (!account) return;
    account.hash = hash;
    this.touch(`account:${accountId}`);
  }

  /** The child-profile PIN's hash, or none (`undefined` takes it off). */
  setChildPin(accountId: string, hash: string | undefined) {
    const account = this.accounts.get(accountId);
    if (!account) return;
    if (hash === undefined) delete account.childPin;
    else account.childPin = hash;
    this.touch(`account:${accountId}`);
  }

  /** A proof from `confirmSession` is used up: it was given for one thing (deleting the account, or taking off the PIN), not for the minutes after. */
  spendConfirmation(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session?.reauthUntil) return;
    delete session.reauthUntil;
    this.touch(`session:${session.id}`);
  }

  deleteAccount(accountId: string) {
    const account = this.accounts.get(accountId);
    if (!account) return;
    this.revokeAll(accountId);
    for (const profile of account.profiles) {
      this.freeTag(profile);
      this.unweigh(profile.id);
      this.data.delete(profile.id);
      this.profileOwner.delete(profile.id);
      this.drop(`pdata:${profile.id}`);
      this.book.forget(profile.id);
      this.talk.forget(profile.id);
      this.stickerBook.forget(profile.id);
      this.seen.delete(profile.id);
    }
    this.emails.delete(account.email);
    if (account.google && this.googles.get(account.google.sub) === accountId) this.googles.delete(account.google.sub);
    this.accounts.delete(accountId);
    this.drop(`account:${accountId}`);
  }

  /* ------------------------------ profiles ------------------------------ */

  profilesOf(accountId: string): Profile[] {
    return (this.accounts.get(accountId)?.profiles ?? []).map(ownProfile);
  }

  private nameTaken(account: AccountDoc, name: string, exceptId?: string) {
    return account.profiles.some((profile) => profile.id !== exceptId && canonicalName(profile.name) === canonicalName(name));
  }

  addProfile(accountId: string, name: string, avatar: AvatarId): Result<Profile> {
    const account = this.accounts.get(accountId);
    if (!account) return fail("not_found");
    if (account.profiles.length >= MAX_PROFILES) return fail("profile_limit");
    if (this.nameTaken(account, name)) return fail("name_taken");
    // (One that is added was named and given its picture by whoever added it: what is left is what it watches, and its subtitles.)
    const profile = this.newProfile(name.trim(), avatar, "more");
    this.takeTag(profile);
    account.profiles.push(profile);
    this.profileOwner.set(profile.id, accountId);
    this.data.set(profile.id, emptyProfileData());
    this.touch(`account:${accountId}`);
    this.touch(`pdata:${profile.id}`);
    return ok(ownProfile(profile));
  }

  updateProfile(accountId: string, profileId: string, patch: { name?: string | undefined; avatar?: AvatarId | undefined; setup?: "done" | undefined }): Result<Profile> {
    const account = this.accounts.get(accountId);
    const profile = account?.profiles.find((candidate) => candidate.id === profileId);
    if (!account || !profile) return fail("not_found");
    if (patch.name !== undefined && this.nameTaken(account, patch.name, profileId)) return fail("name_taken");
    if (patch.name !== undefined) {
      // (A new name starts at the lowest free number as any other would, so the first "Trebert" is Trebert#1 whatever the profile was called before;
      // the same name in other capitals is still the same name, and keeps its number.)
      const sameName = nameKey(patch.name) === nameKey(profile.name);
      this.freeTag(profile);
      profile.name = patch.name.trim();
      this.takeTag(profile, sameName ? profile.tag : undefined);
    }
    if (patch.avatar !== undefined) profile.avatar = patch.avatar;
    if (patch.setup === "done") delete profile.setup;
    this.touch(`account:${accountId}`);
    return ok(ownProfile(profile));
  }

  deleteProfile(accountId: string, profileId: string): Result<null> {
    const account = this.accounts.get(accountId);
    if (!account || !account.profiles.some((profile) => profile.id === profileId)) return fail("not_found");
    if (account.profiles.length <= 1) return fail("last_profile");
    for (const profile of account.profiles) if (profile.id === profileId) this.freeTag(profile);
    account.profiles = account.profiles.filter((profile) => profile.id !== profileId);
    this.unweigh(profileId);
    this.data.delete(profileId);
    this.profileOwner.delete(profileId);
    this.touch(`account:${accountId}`);
    this.drop(`pdata:${profileId}`);
    this.book.forget(profileId);
    this.talk.forget(profileId);
    this.stickerBook.forget(profileId);
    this.seen.delete(profileId);
    // (A phone that was told of this profile's messages keeps no note of it: where it is reached, and the profile, are let go.)
    for (const session of this.sessions.values()) if (session.push?.profileId === profileId) this.clearPush(session.id);
    return ok(null);
  }

  /** The profile with this id and the account it is on; nothing for a profile that is gone. */
  private metaOf(profileId: string): { account: AccountDoc; profile: ProfileMeta } | undefined {
    const account = this.accounts.get(this.profileOwner.get(profileId) ?? "");
    const profile = account?.profiles.find((candidate) => candidate.id === profileId);
    return account && profile ? { account, profile } : undefined;
  }

  /**
   * A screen of this profile looked after its friends just now: what its friends are told as "Last online" (only a profile that lets itself be seen is
   * marked, see friendRoutes.ts). The moment is kept in memory; it is written down when it is `SEEN_WRITE_MS` newer than what was, and as the server stops.
   */
  markSeen(profileId: string): void {
    const found = this.metaOf(profileId);
    if (!found) return;
    const at = this.now();
    this.seen.set(profileId, at);
    if (found.profile.seenAt !== undefined && at - found.profile.seenAt < SEEN_WRITE_MS && at >= found.profile.seenAt) return;
    found.profile.seenAt = at;
    this.touch(`account:${found.account.id}`);
  }

  /** When a screen of this profile last looked (see `markSeen`); nothing when it never has, or not since it last chose not to be seen. */
  seenAt(profileId: string): number | undefined {
    return this.seen.get(profileId) ?? this.metaOf(profileId)?.profile.seenAt;
  }

  /** A profile that chose not to be seen as online is not remembered as having looked at all: what was kept of it goes. */
  forgetSeen(profileId: string): void {
    this.seen.delete(profileId);
    const found = this.metaOf(profileId);
    if (found?.profile.seenAt === undefined) return;
    delete found.profile.seenAt;
    this.touch(`account:${found.account.id}`);
  }

  ownsProfile(accountId: string, profileId: string) {
    return this.profileOwner.get(profileId) === accountId;
  }

  /** Friendships, the codes that make them and the inboxes (see friends.ts). */
  get friends(): FriendBook {
    return this.book;
  }

  /** What friends have written to each other (see chat.ts). */
  get chats(): ChatBook {
    return this.talk;
  }

  /** The personal stickers (see stickers.ts). */
  get stickers(): StickerBook {
    return this.stickerBook;
  }

  /** The time as the store keeps it (what tests move). */
  clock(): number {
    return this.now();
  }

  /** Who a profile is, as a friend sees them (the name made fit to show to somebody else: see `plainText`); nothing for a profile that is gone. */
  profileCard(profileId: string): Profile | undefined {
    const profile = this.accounts.get(this.profileOwner.get(profileId) ?? "")?.profiles.find((candidate) => candidate.id === profileId);
    return profile && { ...publicProfile(profile), name: plainText(profile.name) || "?" };
  }

  /** The first picture nobody on this account is using, for a profile made without choosing one. */
  freeAvatar(accountId: string): AvatarId {
    return nextAvatar((this.accounts.get(accountId)?.profiles ?? []).map((profile) => profile.avatar));
  }

  /* ------------------------------ sessions ------------------------------ */

  /** A new sign-in. The token goes to the device once, in a cookie; only its hash is kept. */
  createSession(accountId: string, kind: DeviceKind, label: string): { token: string; session: SessionDoc } {
    const token = randomBytes(32).toString("base64url");
    const now = this.now();
    const session: SessionDoc = { v: 1, id: sha256(token), accountId, kind, label, createdAt: now, lastSeenAt: now, expiresAt: now + SESSION_TTL_MS };
    this.sessions.set(session.id, session);
    this.touch(`session:${session.id}`);
    const mine = [...this.sessions.values()].filter((other) => other.accountId === accountId).sort((a, b) => a.lastSeenAt - b.lastSeenAt);
    for (const old of mine.slice(0, Math.max(0, mine.length - MAX_SESSIONS))) this.endSession(old.id);
    return { token, session };
  }

  /** Whoever holds this token, or nobody. Using it keeps it alive: a device in use stays signed in. */
  getSession(token: string): SessionDoc | undefined {
    const session = this.sessions.get(sha256(token));
    if (!session) return undefined;
    const now = this.now();
    if (session.expiresAt <= now || !this.accounts.has(session.accountId)) {
      this.endSession(session.id);
      return undefined;
    }
    if (now - session.lastSeenAt > SESSION_TOUCH_MS) {
      session.lastSeenAt = now;
      session.expiresAt = now + SESSION_TTL_MS;
      this.touch(`session:${session.id}`);
    }
    return session;
  }

  private endSession(id: string) {
    if (this.sessions.delete(id)) this.drop(`session:${id}`);
  }

  /** The person on this device has just proved again who they are: it counts until `until`. */
  confirmSession(sessionId: string, until: number) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.reauthUntil = until;
    this.touch(`session:${session.id}`);
  }

  /** Whether the person on this device proved again who they are a moment ago (see `confirmSession`). */
  confirmedNow(sessionId: string): boolean {
    return (this.sessions.get(sessionId)?.reauthUntil ?? 0) > this.now();
  }

  listSessions(accountId: string, currentId?: string): SessionInfo[] {
    return [...this.sessions.values()]
      .filter((session) => session.accountId === accountId)
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .map((session) => ({ id: shortId(session.id), label: session.label, kind: session.kind, createdAt: session.createdAt, lastSeenAt: session.lastSeenAt, current: session.id === currentId }));
  }

  private sessionOf(accountId: string, short: string): SessionDoc | undefined {
    return [...this.sessions.values()].find((candidate) => candidate.accountId === accountId && shortId(candidate.id) === short);
  }

  /** End one session of this account, named by the short id from the list. */
  revokeSession(accountId: string, short: string): boolean {
    const session = this.sessionOf(accountId, short);
    if (!session) return false;
    this.endSession(session.id);
    return true;
  }

  /** Call one session of this account something else (the short id is from the list). */
  renameSession(accountId: string, short: string, label: string): boolean {
    const session = this.sessionOf(accountId, short);
    if (!session) return false;
    session.label = label;
    this.touch(`session:${session.id}`);
    return true;
  }

  /** End every session of the account, except one if given (the device that asked). */
  revokeAll(accountId: string, exceptId?: string) {
    for (const session of [...this.sessions.values()]) if (session.accountId === accountId && session.id !== exceptId) this.endSession(session.id);
  }

  endSessionByToken(token: string) {
    this.endSession(sha256(token));
  }

  /* ------------------------------ the app's notifications ------------------------------ */

  /**
   * The Android app on this session's device is reached by Firebase at `token`, and is on `profileId` (one of the account's). A token is one device's: if another
   * session of the account had it (the app signed in again, and the old session was not ended), that one has it no more. (Only of the same account: what one account
   * says must not take away what another's devices are told of, the authorization sweep's finding.)
   */
  setPush(sessionId: string, token: string, profileId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !PUSH_TOKEN_PATTERN.test(token) || this.profileOwner.get(profileId) !== session.accountId) return false;
    for (const other of this.sessions.values()) {
      if (other !== session && other.accountId === session.accountId && other.push?.token === token) {
        delete other.push;
        this.touch(`session:${other.id}`);
      }
    }
    if (session.push?.token === token && session.push.profileId === profileId) return true;
    session.push = { token, profileId, at: this.now() };
    this.touch(`session:${session.id}`);
    return true;
  }

  /** The app on this session's device is told of nothing any more (it said so, or its notifications were turned off). */
  clearPush(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session?.push) return;
    delete session.push;
    this.touch(`session:${session.id}`);
  }

  /** Firebase no longer knows this token: whichever session has it forgets it. */
  dropPushToken(token: string): void {
    for (const session of this.sessions.values()) if (session.push?.token === token) this.clearPush(session.id);
  }

  /** Where the phones of a profile are reached: the tokens of the sessions that are on it, still signed in, of the account that has it. */
  pushTokensOf(profileId: string): string[] {
    const accountId = this.profileOwner.get(profileId);
    if (!accountId) return [];
    const now = this.now();
    return [...this.sessions.values()].filter((session) => session.accountId === accountId && session.expiresAt > now && session.push?.profileId === profileId).map((session) => session.push!.token);
  }

  /** How many devices have the app's notifications on (the owner's stats): the ones that would be told, still signed in and on a profile of their account. */
  countPushDevices(): number {
    const now = this.now();
    return [...this.sessions.values()].filter((session) => session.push && session.expiresAt > now && this.profileOwner.get(session.push.profileId) === session.accountId).length;
  }

  /* ------------------------------ what a profile keeps ------------------------------ */

  private watchedTell: ((seconds: number) => void) | undefined;
  /** When each profile's watching was last counted, by this server's clock: it is counted no faster than time goes. */
  private readonly watchedAt = new Map<string, number>();
  /**
   * Who is told how many seconds of film a profile played, as its progress comes in (the owner's stats add them up by day: stats/visits.ts). Only the
   * number is told: not the profile, not the film.
   */
  onWatched(tell: (seconds: number) => void): void {
    this.watchedTell = tell;
  }

  /** Bring a profile's data up to date with what a screen sends, and answer with what that screen has missed. */
  sync(profileId: string, request: SyncRequest): SyncResponse | undefined {
    const profile = this.data.get(profileId);
    if (!profile) return undefined;
    const now = this.now();
    // The screen has seen a later state than this server has (the server lost some): it is told to send everything again.
    const reset = request.since > profile.rev;
    const since = reset ? 0 : request.since;
    const rev = profile.rev + 1;
    let stamped = false;
    let pruned = false;
    // What the screen sent and the server kept exactly as it was sent: the screen has it already, so it is not sent back.
    const echo = new Set<string>();
    let played = 0;
    // (At what the account or the site may keep, a new item is not kept: what is kept stays, and changes to it are taken. See SYNC_ACCOUNT_BYTES.)
    const full = this.syncFull(profileId);
    let weight = 0;

    for (const name of COLLECTIONS) {
      const map = profile.collections[name];
      const sentItems: readonly SyncItem[] = request[name] ?? [];
      for (const sent of sentItems) {
        const candidate: SyncItem = { ...sent, at: Math.min(sent.at, now + FUTURE_SLACK_MS) };
        if (name === "settings" && !candidate.deleted && !validSetting(candidate)) continue;
        if (name === "saved" && !candidate.deleted && !validSaved(candidate)) continue;
        const have = map.get(candidate.key)?.item;
        if (full && !have && !candidate.deleted) continue;
        if (name === "progress" && this.watchedTell && have) played += playedBetween(have, candidate);
        let winner = have ? newerOf(have, candidate) : candidate;
        if (have && !have.deleted && !candidate.deleted) winner = borrow(name, winner, winner === have ? candidate : have);
        if (have && sameJson(winner, have)) continue;
        map.set(winner.key, { item: winner, rev });
        stamped = true;
        if (sameJson(winner, sent)) echo.add(`${name}:${winner.key}`);
      }
      const pruning = this.prune(map, name, now);
      pruned = pruning.changed || pruned;
      weight += pruning.weight;
    }
    this.siteWeight += weight - (profile.weight ?? 0);
    profile.weight = weight;
    if (played > 0 && this.watchedTell) {
      // (No more than the time that went by on this server's clock since the profile's watching was last counted, and a quarter of an hour at most at once:
      // what a screen says of its own clock cannot make the number grow faster than a film plays.)
      const last = this.watchedAt.get(profileId);
      const most = last === undefined ? WATCHED_AT_ONCE_S : Math.min(WATCHED_AT_ONCE_S, (now - last) / 1000 + 60);
      this.watchedAt.set(profileId, now);
      if (most > 0) this.watchedTell(Math.min(played, most));
    }
    if (stamped) profile.rev = rev;
    if (stamped || pruned) this.touch(`pdata:${profileId}`);

    const answer = (name: CollectionName) => [...profile.collections[name].values()].filter((entry) => entry.rev > since && !echo.has(`${name}:${entry.item.key}`)).map((entry) => entry.item);
    return {
      rev: profile.rev,
      ...(reset ? { reset: true } : {}),
      progress: answer("progress") as SyncResponse["progress"],
      watched: answer("watched") as SyncResponse["watched"],
      list: answer("list") as SyncResponse["list"],
      listNames: answer("listNames") as SyncResponse["listNames"],
      ratings: answer("ratings") as SyncResponse["ratings"],
      settings: answer("settings") as SyncResponse["settings"],
      saved: answer("saved") as SyncResponse["saved"],
    };
  }

  /**
   * Keep the newest items up to the limit and up to the budget (the first that does not fit goes, and every older one with it), and forget removals once everyone
   * has had time to hear of them (they weigh nothing: their count is bounded already). Whether anything went, and what is kept weighs.
   */
  private prune(map: Map<string, Stamped>, name: CollectionName, now: number): { changed: boolean; weight: number } {
    let weight = 0;
    let over = false;
    const kept = mergeCollection([...map.values()].map((entry) => entry.item), [], { limit: LIMITS[name], now }).filter((item) => {
      if (item.deleted) return true;
      // (What is past the budget is not weighed: it goes whatever it weighs.)
      if (!over) {
        const size = Buffer.byteLength(JSON.stringify(item));
        over = weight + size > BYTE_BUDGET[name];
        if (!over) weight += size;
      }
      return !over;
    });
    if (kept.length === map.size) return { changed: false, weight };
    const keep = new Set(kept.map((item) => item.key));
    for (const key of [...map.keys()]) if (!keep.has(key)) map.delete(key);
    return { changed: true, weight };
  }

  /** What all the live items of every profile weigh, as last weighed. */
  private siteWeight = 0;

  /** Weighs a profile's live items (as it is loaded: a sync weighs them as it prunes). */
  private weigh(profile: ProfileData): void {
    let weight = 0;
    for (const name of COLLECTIONS) for (const { item } of profile.collections[name].values()) if (!item.deleted) weight += Buffer.byteLength(JSON.stringify(item));
    this.siteWeight += weight - (profile.weight ?? 0);
    profile.weight = weight;
  }

  private unweigh(profileId: string): void {
    this.siteWeight -= this.data.get(profileId)?.weight ?? 0;
  }

  /** Whether this profile's account, or the whole site, keeps as much as it may (`SYNC_ACCOUNT_BYTES`). */
  private syncFull(profileId: string): boolean {
    if (this.siteWeight >= this.options.syncSiteBytes) return true;
    const accountId = this.profileOwner.get(profileId);
    let account = 0;
    for (const profile of accountId ? (this.accounts.get(accountId)?.profiles ?? []) : []) account += this.data.get(profile.id)?.weight ?? 0;
    return account >= this.options.syncAccountBytes;
  }

  /** What the profiles keep, in bytes (the owner's numbers, and tests). */
  syncWeight(accountId?: string): number {
    if (!accountId) return this.siteWeight;
    return (this.accounts.get(accountId)?.profiles ?? []).reduce((all, profile) => all + (this.data.get(profile.id)?.weight ?? 0), 0);
  }

  /** One part of what a profile keeps, as the server has it, removals included (what a friend is shown is picked from this). */
  items<K extends CollectionName>(profileId: string, name: K): SyncResponse[K] {
    const collection = this.data.get(profileId)?.collections[name];
    return [...(collection?.values() ?? [])].map((entry) => entry.item) as SyncResponse[K];
  }

  /** What a profile has chosen in its settings. */
  settingsOf(profileId: string): Settings {
    return resolveSettings(this.items(profileId, "settings"));
  }

  /** Everything a profile keeps, as the server has it (for tests and for exporting). */
  snapshot(profileId: string) {
    return this.sync(profileId, { since: 0 });
  }
}

/** The most seconds of film one sync may add to what was watched. */
const WATCHED_AT_ONCE_S = 15 * 60;

/**
 * How many seconds of a film were played between two states of its card: the same film or episode, further on, written later, and no further on than
 * the time between the two writings allows (a jump ahead is no watching). Nothing for anything else.
 */
export function playedBetween(before: SyncItem, after: SyncItem): number {
  if (before.deleted || after.deleted) return 0;
  const a = before as SyncItem & { url?: unknown; position?: unknown };
  const b = after as SyncItem & { url?: unknown; position?: unknown };
  if (typeof a.url !== "string" || a.url !== b.url || typeof a.position !== "number" || typeof b.position !== "number") return 0;
  const played = b.position - a.position;
  const went = (b.at - a.at) / 1000;
  return played > 0 && went > 0 && played <= went + 30 ? played : 0;
}

const emptyProfileData = (): ProfileData => ({ rev: 0, collections: Object.fromEntries(COLLECTIONS.map((name) => [name, new Map()])) as ProfileData["collections"] });

function validSetting(item: SyncItem): boolean {
  const schema = SETTING_SCHEMAS[item.key as SettingKey];
  return Boolean(schema) && schema.safeParse((item as { value?: unknown }).value).success;
}

/** A kept picture of the chat that the pages would draw (client/chat/saved.ts): a GIF only as `gifOf` reads it, under the key it makes. (Kino's stickers are the pages' own list.) */
function validSaved(item: SyncItem): boolean {
  const { key, text } = item as { key: string; text?: unknown };
  if (!key.startsWith("gif:")) return true;
  return typeof text === "string" && gifOf(text) === text && key === `gif:${text}`;
}

/** The newer of two copies keeps what only the older one knew (a picture, a year). */
function borrow(name: CollectionName, winner: SyncItem, loser: SyncItem): SyncItem {
  if (name === "progress") return fillProgress(winner as unknown as LiveProgress, loser as unknown as LiveProgress) as unknown as SyncItem;
  if (name === "list") return fillListItem(winner as unknown as LiveListItem, loser as unknown as LiveListItem) as unknown as SyncItem;
  return winner;
}
