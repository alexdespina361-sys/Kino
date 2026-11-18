import { createHash, randomBytes } from "node:crypto";
import {
  AVATAR_IDS,
  avatarName,
  COLLECTIONS,
  fillListItem,
  fillProgress,
  friendChoices,
  LIMITS,
  MAX_PROFILES,
  mergeCollection,
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

interface ProfileMeta extends Profile {
  createdAt: number;
  seenAt?: number;
}
interface AccountDoc {
  v: 1;
  id: string;
  email: string;
  hash: string;
  createdAt: number;
  profiles: ProfileMeta[];
  google?: { sub: string; only?: true };
  childPin?: string;
}
interface Stamped {
  item: SyncItem;
  rev: number;
}
type DataDoc = { v: 1; rev: number } & Record<CollectionName, Stamped[]>;
interface SessionDoc {
  v: 1;
  id: string;
  accountId: string;
  kind: DeviceKind;
  label: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  reauthUntil?: number;
  push?: { token: string; profileId: string; at: number };
}

export type StoreNotice = { kind: "chat"; from: string; to: string } | { kind: "inbox"; from: string; to: string; what: "recommend" | "party" | "together" | "plan" | "planYes" | "planNo" };

export const PUSH_TOKEN_PATTERN = /^[A-Za-z0-9:_-]{20,4096}$/;
interface ProfileData {
  rev: number;
  collections: Record<CollectionName, Map<string, Stamped>>;
  weight?: number;
}

export const SYNC_ACCOUNT_BYTES = 2 * 1024 * 1024;
export const SYNC_SITE_BYTES = 64 * 1024 * 1024;

export const SESSION_TTL_MS = 400 * 24 * 3600 * 1000;
const SESSION_TOUCH_MS = 3600 * 1000;
const SESSION_GONE_MS = 7 * 24 * 3600 * 1000;
export const SEEN_WRITE_MS = 10 * 60 * 1000;
const MAX_SESSIONS = 20;
const FUTURE_SLACK_MS = 60_000;
const RETRY_MS = 10_000;
const BYTE_BUDGET: Record<CollectionName, number> = { progress: 192 * 1024, watched: 256 * 1024, list: 640 * 1024, listNames: 32 * 1024, ratings: 640 * 1024, settings: 64 * 1024, saved: 56 * 1024 };

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const newId = (prefix: string) => `${prefix}_${randomBytes(9).toString("base64url")}`;
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
const googleLogin = () => `g-${[...randomBytes(12)].map((byte) => BASE32[byte & 31]).join("")}`;
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const canonicalName = (name: string) => name.normalize("NFC").trim().toLowerCase();
const publicProfile = ({ id, name, avatar, tag }: ProfileMeta): Profile => ({ id, name, avatar, ...(tag !== undefined ? { tag } : {}) });
const ownProfile = (profile: ProfileMeta): Profile => ({ ...publicProfile(profile), ...(profile.setup ? { setup: profile.setup } : {}) });
const shortId = (id: string) => id.slice(0, 16);

export type StoreError = "email_taken" | "google_taken" | "profile_limit" | "name_taken" | "last_profile" | "not_found";
export type Result<T> = { ok: true; value: T } | { ok: false; error: StoreError };
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: StoreError): Result<never> => ({ ok: false, error });

export interface AccountUsage {
  profiles: number;
  madeAt: number[];
  lastUsedAt: number[];
  devices: Record<string, number>;
}

export interface StoreOptions {
  persistence: Persistence;
  now?: () => number;
  flushMs?: number;
  log?: { warn(message: string): void };
  stickers?: { files?: StickerFiles; on?: boolean; moving?: boolean; maxBytes?: number; uploadMs?: number };
  askSetup?: boolean;
  syncAccountBytes?: number;
  syncSiteBytes?: number;
}

export class AccountStore {
  private readonly accounts = new Map<string, AccountDoc>();
  private readonly emails = new Map<string, string>();
  private readonly googles = new Map<string, string>();
  private readonly data = new Map<string, ProfileData>();
  private readonly profileOwner = new Map<string, string>();
  private readonly sessions = new Map<string, SessionDoc>();
  private readonly tags = new Map<string, Map<number, string>>();
  private readonly book = new FriendBook({
    touch: (key) => this.touch(key),
    drop: (key) => this.drop(key),
    now: () => this.now(),
    delivered: (to, from, what) => this.tell({ kind: "inbox", from, to, what }),
  });
  private readonly talk = new ChatBook({
    touch: (key) => this.touch(key),
    drop: (key) => this.drop(key),
    now: () => this.now(),
    areFriends: (a, b) => this.book.areFriends(a, b),
    on: (profileId) => friendChoices(this.settingsOf(profileId)).friends,
    takes: (profileId) => takesMessages(this.settingsOf(profileId)),
    wrote: (from, to) => this.tell({ kind: "chat", from, to }),
  });

  private listener: ((notice: StoreNotice) => void) | undefined;
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

  private readonly seen = new Map<string, number>();

  private readonly dirty = new Set<string>();
  private readonly removed = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flushing: Promise<void> = Promise.resolve();

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
    if (store.stickerBook.on) await store.stickerBook.reconcile();
    return store;
  }

  private now() {
    return this.options.now();
  }

  private async load() {
    for (const [key, value] of await this.options.persistence.load()) {
      try {
        if (key.startsWith("account:")) {
          const doc = value as AccountDoc;
          this.accounts.set(doc.id, doc);
          this.emails.set(doc.email, doc.id);
          for (const profile of doc.profiles) this.profileOwner.set(profile.id, doc.id);
          if (doc.google) {
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

  private takeTag(profile: ProfileMeta, keep?: number): void {
    const key = nameKey(profile.name);
    const used = this.tags.get(key) ?? new Map<number, string>();
    let tag = keep !== undefined && !used.has(keep) ? keep : 1;
    while (used.has(tag)) tag++;
    used.set(tag, profile.id);
    this.tags.set(key, used);
    profile.tag = tag;
  }

  private freeTag(profile: ProfileMeta): void {
    if (profile.tag === undefined) return;
    const key = nameKey(profile.name);
    const used = this.tags.get(key);
    if (used?.get(profile.tag) !== profile.id) return;
    used.delete(profile.tag);
    if (used.size === 0) this.tags.delete(key);
  }

  profileByTag(name: string, tag: number): string | undefined {
    return this.tags.get(nameKey(name))?.get(tag);
  }

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
        for (const key of put.keys()) if (!this.removed.has(key)) this.dirty.add(key);
        for (const key of remove) if (!this.dirty.has(key)) this.removed.add(key);
        this.options.log?.warn(`Could not save accounts: ${(error as Error).message}`);
        this.schedule(RETRY_MS);
      }
    });
    return this.flushing;
  }

  async close() {
    for (const [profileId, at] of this.seen) {
      const found = this.metaOf(profileId);
      if (!found || found.profile.seenAt === at) continue;
      found.profile.seenAt = at;
      this.touch(`account:${found.account.id}`);
    }
    await this.flush();
    await this.options.persistence.close?.();
  }

  countAccounts() {
    return this.accounts.size;
  }
  profileIds(): string[] {
    return [...this.profileOwner.keys()];
  }
  accountOfProfile(profileId: string): string | undefined {
    return this.profileOwner.get(profileId);
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

  createAccount(email: string, hash: string, name?: string): Result<AccountDoc> {
    if (this.emails.has(email)) return fail("email_taken");
    return ok(this.make(email, hash, name));
  }

  createGoogleAccount(sub: string, name: string, hash: string): Result<AccountDoc> {
    if (this.googles.has(sub)) return fail("google_taken");
    let login = googleLogin();
    while (this.emails.has(login)) login = googleLogin();
    return ok(this.make(login, hash, name, { sub, only: true }));
  }

  private make(email: string, hash: string, name?: string, google?: AccountDoc["google"]): AccountDoc {
    const avatar = AVATAR_IDS[this.accounts.size % AVATAR_IDS.length]!;
    const first = this.newProfile(name ?? avatarName(avatar), avatar, "all");
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

  findByGoogle(sub: string): AccountDoc | undefined {
    const id = this.googles.get(sub);
    return id ? this.accounts.get(id) : undefined;
  }

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

  setChildPin(accountId: string, hash: string | undefined) {
    const account = this.accounts.get(accountId);
    if (!account) return;
    if (hash === undefined) delete account.childPin;
    else account.childPin = hash;
    this.touch(`account:${accountId}`);
  }

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
    for (const session of this.sessions.values()) if (session.push?.profileId === profileId) this.clearPush(session.id);
    return ok(null);
  }

  private metaOf(profileId: string): { account: AccountDoc; profile: ProfileMeta } | undefined {
    const account = this.accounts.get(this.profileOwner.get(profileId) ?? "");
    const profile = account?.profiles.find((candidate) => candidate.id === profileId);
    return account && profile ? { account, profile } : undefined;
  }

  markSeen(profileId: string): void {
    const found = this.metaOf(profileId);
    if (!found) return;
    const at = this.now();
    this.seen.set(profileId, at);
    if (found.profile.seenAt !== undefined && at - found.profile.seenAt < SEEN_WRITE_MS && at >= found.profile.seenAt) return;
    found.profile.seenAt = at;
    this.touch(`account:${found.account.id}`);
  }

  seenAt(profileId: string): number | undefined {
    return this.seen.get(profileId) ?? this.metaOf(profileId)?.profile.seenAt;
  }

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

  get friends(): FriendBook {
    return this.book;
  }

  get chats(): ChatBook {
    return this.talk;
  }

  get stickers(): StickerBook {
    return this.stickerBook;
  }

  clock(): number {
    return this.now();
  }

  profileCard(profileId: string): Profile | undefined {
    const profile = this.accounts.get(this.profileOwner.get(profileId) ?? "")?.profiles.find((candidate) => candidate.id === profileId);
    return profile && { ...publicProfile(profile), name: plainText(profile.name) || "?" };
  }

  freeAvatar(accountId: string): AvatarId {
    return nextAvatar((this.accounts.get(accountId)?.profiles ?? []).map((profile) => profile.avatar));
  }

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

  confirmSession(sessionId: string, until: number) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.reauthUntil = until;
    this.touch(`session:${session.id}`);
  }

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

  revokeSession(accountId: string, short: string): boolean {
    const session = this.sessionOf(accountId, short);
    if (!session) return false;
    this.endSession(session.id);
    return true;
  }

  renameSession(accountId: string, short: string, label: string): boolean {
    const session = this.sessionOf(accountId, short);
    if (!session) return false;
    session.label = label;
    this.touch(`session:${session.id}`);
    return true;
  }

  revokeAll(accountId: string, exceptId?: string) {
    for (const session of [...this.sessions.values()]) if (session.accountId === accountId && session.id !== exceptId) this.endSession(session.id);
  }

  endSessionByToken(token: string) {
    this.endSession(sha256(token));
  }

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

  clearPush(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session?.push) return;
    delete session.push;
    this.touch(`session:${session.id}`);
  }

  dropPushToken(token: string): void {
    for (const session of this.sessions.values()) if (session.push?.token === token) this.clearPush(session.id);
  }

  pushTokensOf(profileId: string): string[] {
    const accountId = this.profileOwner.get(profileId);
    if (!accountId) return [];
    const now = this.now();
    return [...this.sessions.values()].filter((session) => session.accountId === accountId && session.expiresAt > now && session.push?.profileId === profileId).map((session) => session.push!.token);
  }

  countPushDevices(): number {
    const now = this.now();
    return [...this.sessions.values()].filter((session) => session.push && session.expiresAt > now && this.profileOwner.get(session.push.profileId) === session.accountId).length;
  }

  private watchedTell: ((seconds: number) => void) | undefined;
  private readonly watchedAt = new Map<string, number>();
  onWatched(tell: (seconds: number) => void): void {
    this.watchedTell = tell;
  }

  sync(profileId: string, request: SyncRequest): SyncResponse | undefined {
    const profile = this.data.get(profileId);
    if (!profile) return undefined;
    const now = this.now();
    const reset = request.since > profile.rev;
    const since = reset ? 0 : request.since;
    const rev = profile.rev + 1;
    let stamped = false;
    let pruned = false;
    const echo = new Set<string>();
    let played = 0;
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

  private prune(map: Map<string, Stamped>, name: CollectionName, now: number): { changed: boolean; weight: number } {
    let weight = 0;
    let over = false;
    const kept = mergeCollection([...map.values()].map((entry) => entry.item), [], { limit: LIMITS[name], now }).filter((item) => {
      if (item.deleted) return true;
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

  private siteWeight = 0;

  private weigh(profile: ProfileData): void {
    let weight = 0;
    for (const name of COLLECTIONS) for (const { item } of profile.collections[name].values()) if (!item.deleted) weight += Buffer.byteLength(JSON.stringify(item));
    this.siteWeight += weight - (profile.weight ?? 0);
    profile.weight = weight;
  }

  private unweigh(profileId: string): void {
    this.siteWeight -= this.data.get(profileId)?.weight ?? 0;
  }

  private syncFull(profileId: string): boolean {
    if (this.siteWeight >= this.options.syncSiteBytes) return true;
    const accountId = this.profileOwner.get(profileId);
    let account = 0;
    for (const profile of accountId ? (this.accounts.get(accountId)?.profiles ?? []) : []) account += this.data.get(profile.id)?.weight ?? 0;
    return account >= this.options.syncAccountBytes;
  }

  syncWeight(accountId?: string): number {
    if (!accountId) return this.siteWeight;
    return (this.accounts.get(accountId)?.profiles ?? []).reduce((all, profile) => all + (this.data.get(profile.id)?.weight ?? 0), 0);
  }

  items<K extends CollectionName>(profileId: string, name: K): SyncResponse[K] {
    const collection = this.data.get(profileId)?.collections[name];
    return [...(collection?.values() ?? [])].map((entry) => entry.item) as SyncResponse[K];
  }

  settingsOf(profileId: string): Settings {
    return resolveSettings(this.items(profileId, "settings"));
  }

  snapshot(profileId: string) {
    return this.sync(profileId, { since: 0 });
  }
}

const WATCHED_AT_ONCE_S = 15 * 60;

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

function validSaved(item: SyncItem): boolean {
  const { key, text } = item as { key: string; text?: unknown };
  if (!key.startsWith("gif:")) return true;
  return typeof text === "string" && gifOf(text) === text && key === `gif:${text}`;
}

function borrow(name: CollectionName, winner: SyncItem, loser: SyncItem): SyncItem {
  if (name === "progress") return fillProgress(winner as unknown as LiveProgress, loser as unknown as LiveProgress) as unknown as SyncItem;
  if (name === "list") return fillListItem(winner as unknown as LiveListItem, loser as unknown as LiveListItem) as unknown as SyncItem;
  return winner;
}
