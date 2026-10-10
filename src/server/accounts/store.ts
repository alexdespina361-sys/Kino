import { createHash, randomBytes } from "node:crypto";
import {
  AVATAR_IDS,
  fillListItem,
  fillProgress,
  LIMITS,
  MAX_PROFILES,
  mergeCollection,
  nameFromEmail,
  newerOf,
  nextAvatar,
  SETTING_SCHEMAS,
  type AvatarId,
  type DeviceKind,
  type LiveListItem,
  type LiveProgress,
  type Profile,
  type SessionInfo,
  type SettingKey,
  type SyncItem,
  type SyncRequest,
  type SyncResponse,
} from "../../shared";
import type { Persistence } from "./persistence";

/* ------------------------------ what is kept ------------------------------ */

interface ProfileMeta extends Profile {
  createdAt: number;
}
interface AccountDoc {
  v: 1;
  id: string;
  email: string;
  hash: string;
  createdAt: number;
  profiles: ProfileMeta[];
}
/** An item with the server's counter at the moment it last changed: what lets a screen ask only for what is new. */
interface Stamped {
  item: SyncItem;
  rev: number;
}
const COLLECTIONS = ["progress", "watched", "list", "settings"] as const;
type Collection = (typeof COLLECTIONS)[number];
interface DataDoc {
  v: 1;
  rev: number;
  progress: Stamped[];
  watched: Stamped[];
  list: Stamped[];
  settings: Stamped[];
}
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
}
interface ProfileData {
  rev: number;
  collections: Record<Collection, Map<string, Stamped>>;
}

export const SESSION_TTL_MS = 180 * 24 * 3600 * 1000;
const SESSION_TOUCH_MS = 3600 * 1000;
const MAX_SESSIONS = 20;
/** A clock that runs ahead must not make its items win for ever. */
const FUTURE_SLACK_MS = 60_000;
/** When a write fails (the database is waking up, the network blinked), try again after this. */
const RETRY_MS = 10_000;

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const newId = (prefix: string) => `${prefix}_${randomBytes(9).toString("base64url")}`;
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const canonicalName = (name: string) => name.normalize("NFC").trim().toLowerCase();
/** The part of a session id that is shown and used to ask for it to be ended: enough to tell sessions apart, and no use as a token. */
const shortId = (id: string) => id.slice(0, 16);

export type StoreError = "email_taken" | "profile_limit" | "name_taken" | "last_profile" | "not_found";
export type Result<T> = { ok: true; value: T } | { ok: false; error: StoreError };
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: StoreError): Result<never> => ({ ok: false, error });

export interface StoreOptions {
  persistence: Persistence;
  now?: () => number;
  /** How long changes wait before they are written; they are also written when the server stops. */
  flushMs?: number;
  log?: { warn(message: string): void };
}

/**
 * Accounts, profiles, sessions and everything a profile keeps. All of it lives in memory (a personal server's worth is a
 * few megabytes) and is written behind the scenes through a `Persistence`, a moment after it changes and again when the
 * server stops.
 */
export class AccountStore {
  private readonly accounts = new Map<string, AccountDoc>();
  private readonly emails = new Map<string, string>();
  private readonly data = new Map<string, ProfileData>();
  private readonly profileOwner = new Map<string, string>();
  private readonly sessions = new Map<string, SessionDoc>();

  private readonly dirty = new Set<string>();
  private readonly removed = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flushing: Promise<void> = Promise.resolve();

  private constructor(private readonly options: Required<Omit<StoreOptions, "log">> & Pick<StoreOptions, "log">) {}

  static async open(options: StoreOptions): Promise<AccountStore> {
    const store = new AccountStore({ now: Date.now, flushMs: 1500, ...options });
    await store.load();
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
        } else if (key.startsWith("pdata:")) {
          const doc = value as DataDoc;
          this.data.set(key.slice("pdata:".length), {
            rev: doc.rev,
            collections: Object.fromEntries(COLLECTIONS.map((name) => [name, new Map((doc[name] ?? []).map((stamped) => [stamped.item.key, stamped]))])) as ProfileData["collections"],
          });
        } else if (key.startsWith("session:")) {
          const doc = value as SessionDoc;
          if (doc.expiresAt > this.now()) this.sessions.set(doc.id, doc);
        }
      } catch {
        this.options.log?.warn(`Skipped an unreadable record (${key}).`);
      }
    }
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
    if (key.startsWith("pdata:")) {
      const profileData = this.data.get(key.slice("pdata:".length));
      if (!profileData) return undefined;
      const stamped = (name: Collection) => [...profileData.collections[name].values()];
      const doc: DataDoc = { v: 1, rev: profileData.rev, progress: stamped("progress"), watched: stamped("watched"), list: stamped("list"), settings: stamped("settings") };
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
    await this.flush();
    await this.options.persistence.close?.();
  }

  /* ------------------------------ accounts ------------------------------ */

  countAccounts() {
    return this.accounts.size;
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
    const first = this.newProfile(nameFromEmail(email), AVATAR_IDS[0]);
    const account: AccountDoc = { v: 1, id: newId("acc"), email, hash, createdAt: this.now(), profiles: [first] };
    this.accounts.set(account.id, account);
    this.emails.set(email, account.id);
    this.profileOwner.set(first.id, account.id);
    this.data.set(first.id, emptyProfileData());
    this.touch(`account:${account.id}`);
    this.touch(`pdata:${first.id}`);
    return ok(account);
  }

  private newProfile(name: string, avatar: AvatarId): ProfileMeta {
    return { id: newId("pro"), name, avatar, createdAt: this.now() };
  }

  setPasswordHash(accountId: string, hash: string) {
    const account = this.accounts.get(accountId);
    if (!account) return;
    account.hash = hash;
    this.touch(`account:${accountId}`);
  }

  deleteAccount(accountId: string) {
    const account = this.accounts.get(accountId);
    if (!account) return;
    this.revokeAll(accountId);
    for (const profile of account.profiles) {
      this.data.delete(profile.id);
      this.profileOwner.delete(profile.id);
      this.drop(`pdata:${profile.id}`);
    }
    this.emails.delete(account.email);
    this.accounts.delete(accountId);
    this.drop(`account:${accountId}`);
  }

  /* ------------------------------ profiles ------------------------------ */

  profilesOf(accountId: string): Profile[] {
    return (this.accounts.get(accountId)?.profiles ?? []).map(({ id, name, avatar }) => ({ id, name, avatar }));
  }

  private nameTaken(account: AccountDoc, name: string, exceptId?: string) {
    return account.profiles.some((profile) => profile.id !== exceptId && canonicalName(profile.name) === canonicalName(name));
  }

  addProfile(accountId: string, name: string, avatar: AvatarId): Result<Profile> {
    const account = this.accounts.get(accountId);
    if (!account) return fail("not_found");
    if (account.profiles.length >= MAX_PROFILES) return fail("profile_limit");
    if (this.nameTaken(account, name)) return fail("name_taken");
    const profile = this.newProfile(name.trim(), avatar);
    account.profiles.push(profile);
    this.profileOwner.set(profile.id, accountId);
    this.data.set(profile.id, emptyProfileData());
    this.touch(`account:${accountId}`);
    this.touch(`pdata:${profile.id}`);
    return ok({ id: profile.id, name: profile.name, avatar: profile.avatar });
  }

  updateProfile(accountId: string, profileId: string, patch: { name?: string | undefined; avatar?: AvatarId | undefined }): Result<Profile> {
    const account = this.accounts.get(accountId);
    const profile = account?.profiles.find((candidate) => candidate.id === profileId);
    if (!account || !profile) return fail("not_found");
    if (patch.name !== undefined && this.nameTaken(account, patch.name, profileId)) return fail("name_taken");
    if (patch.name !== undefined) profile.name = patch.name.trim();
    if (patch.avatar !== undefined) profile.avatar = patch.avatar;
    this.touch(`account:${accountId}`);
    return ok({ id: profile.id, name: profile.name, avatar: profile.avatar });
  }

  deleteProfile(accountId: string, profileId: string): Result<null> {
    const account = this.accounts.get(accountId);
    if (!account || !account.profiles.some((profile) => profile.id === profileId)) return fail("not_found");
    if (account.profiles.length <= 1) return fail("last_profile");
    account.profiles = account.profiles.filter((profile) => profile.id !== profileId);
    this.data.delete(profileId);
    this.profileOwner.delete(profileId);
    this.touch(`account:${accountId}`);
    this.drop(`pdata:${profileId}`);
    return ok(null);
  }

  ownsProfile(accountId: string, profileId: string) {
    return this.profileOwner.get(profileId) === accountId;
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

  listSessions(accountId: string, currentId?: string): SessionInfo[] {
    return [...this.sessions.values()]
      .filter((session) => session.accountId === accountId)
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .map((session) => ({ id: shortId(session.id), label: session.label, kind: session.kind, createdAt: session.createdAt, lastSeenAt: session.lastSeenAt, current: session.id === currentId }));
  }

  /** End one session of this account, named by the short id from the list. */
  revokeSession(accountId: string, short: string): boolean {
    const session = [...this.sessions.values()].find((candidate) => candidate.accountId === accountId && shortId(candidate.id) === short);
    if (!session) return false;
    this.endSession(session.id);
    return true;
  }

  /** End every session of the account, except one if given (the device that asked). */
  revokeAll(accountId: string, exceptId?: string) {
    for (const session of [...this.sessions.values()]) if (session.accountId === accountId && session.id !== exceptId) this.endSession(session.id);
  }

  endSessionByToken(token: string) {
    this.endSession(sha256(token));
  }

  /* ------------------------------ what a profile keeps ------------------------------ */

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

    for (const name of COLLECTIONS) {
      const map = profile.collections[name];
      const sentItems: readonly SyncItem[] = request[name] ?? [];
      for (const sent of sentItems) {
        const candidate: SyncItem = { ...sent, at: Math.min(sent.at, now + FUTURE_SLACK_MS) };
        if (name === "settings" && !candidate.deleted && !validSetting(candidate)) continue;
        const have = map.get(candidate.key)?.item;
        let winner = have ? newerOf(have, candidate) : candidate;
        if (have && !have.deleted && !candidate.deleted) winner = borrow(name, winner, winner === have ? candidate : have);
        if (have && sameJson(winner, have)) continue;
        map.set(winner.key, { item: winner, rev });
        stamped = true;
        if (sameJson(winner, sent)) echo.add(`${name}:${winner.key}`);
      }
      pruned = this.prune(map, name, now) || pruned;
    }
    if (stamped) profile.rev = rev;
    if (stamped || pruned) this.touch(`pdata:${profileId}`);

    const answer = (name: Collection) => [...profile.collections[name].values()].filter((entry) => entry.rev > since && !echo.has(`${name}:${entry.item.key}`)).map((entry) => entry.item);
    return {
      rev: profile.rev,
      ...(reset ? { reset: true } : {}),
      progress: answer("progress") as SyncResponse["progress"],
      watched: answer("watched") as SyncResponse["watched"],
      list: answer("list") as SyncResponse["list"],
      settings: answer("settings") as SyncResponse["settings"],
    };
  }

  /** Keep the newest items up to the limit, and forget removals once everyone has had time to hear of them. Whether anything went. */
  private prune(map: Map<string, Stamped>, name: Collection, now: number): boolean {
    const kept = mergeCollection([...map.values()].map((entry) => entry.item), [], { limit: LIMITS[name], now });
    if (kept.length === map.size) return false;
    const keep = new Set(kept.map((item) => item.key));
    for (const key of [...map.keys()]) if (!keep.has(key)) map.delete(key);
    return true;
  }

  /** Everything a profile keeps, as the server has it (for tests and for exporting). */
  snapshot(profileId: string) {
    return this.sync(profileId, { since: 0 });
  }
}

const emptyProfileData = (): ProfileData => ({ rev: 0, collections: { progress: new Map(), watched: new Map(), list: new Map(), settings: new Map() } });

function validSetting(item: SyncItem): boolean {
  const schema = SETTING_SCHEMAS[item.key as SettingKey];
  return Boolean(schema) && schema.safeParse((item as { value?: unknown }).value).success;
}

/** The newer of two copies keeps what only the older one knew (a picture, a year). */
function borrow(name: Collection, winner: SyncItem, loser: SyncItem): SyncItem {
  if (name === "progress") return fillProgress(winner as unknown as LiveProgress, loser as unknown as LiveProgress) as unknown as SyncItem;
  if (name === "list") return fillListItem(winner as unknown as LiveListItem, loser as unknown as LiveListItem) as unknown as SyncItem;
  return winner;
}
