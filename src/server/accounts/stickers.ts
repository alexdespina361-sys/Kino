import { randomBytes } from "node:crypto";
import { isStickerId, MOVING_STICKER, PERSONAL_STICKER, type MyStickers, type StickerProblem } from "../../shared";
import { RateLimiter, WorkBudget } from "./rateLimit";
import { makeMovingSticker, makeSticker, type MadeSticker } from "./stickerImage";
import type { StickerFiles } from "./stickerFiles";

export interface StickerHost {
  touch(key: string): void;
  drop(key: string): void;
  now(): number;
  on(profileId: string): boolean;
}

interface StickerDoc {
  v: 1;
  id: string;
  by: string;
  account: string;
  at: number;
  bytes: number;
  hash: string;
  held: Record<string, number>;
}

export type StickerOutcome<T> = { ok: true; value: T } | { ok: false; error: StickerProblem | "gone" | "friends_off"; waitMs?: number };

const PREFIX = "sticker:";
const DAY = 24 * 3600 * 1000;
const WRITE_MS = 30_000;
const SITE = "site";
const LATE = Symbol("late");
function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(LATE), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
const no = (error: StickerProblem | "gone" | "friends_off", waitMs?: number) => ({ ok: false as const, error, ...(waitMs ? { waitMs } : {}) });
const sameKey = (profileId: string, hash: string) => `${profileId} ${hash}`;

export interface StickerListing {
  id: string;
  at: number;
  bytes: number;
  by: string;
  account: string;
  holders: number;
}

export class StickerBook {
  private readonly docs = new Map<string, StickerDoc>();
  private readonly byHash = new Map<string, string>();
  private readonly held = new Map<string, Set<string>>();
  private readonly made: RateLimiter;
  private readonly tried: RateLimiter;
  private bytesInAll = 0;
  private writing = 0;
  private readonly making = new Map<string, Promise<unknown>>();
  readonly pictureReads: RateLimiter;
  private readonly arrivals: RateLimiter;
  private readonly work: WorkBudget;

  constructor(
    private readonly host: StickerHost,
    private readonly files: StickerFiles,
    readonly options: { on: boolean; moving?: boolean; maxBytes?: number; uploadMs?: number; writeMs?: number; siteWorkMs?: number; log?: { warn(message: string): void } },
  ) {
    this.made = new RateLimiter(PERSONAL_STICKER.madePerDay, DAY, () => host.now(), "stickers.madePerDay");
    this.tried = new RateLimiter(MOVING_STICKER.triesPerDay, DAY, () => host.now(), "stickers.triedPerDay");
    this.pictureReads = new RateLimiter(PERSONAL_STICKER.picturesPerMinute, 60_000, () => host.now());
    this.arrivals = new RateLimiter(PERSONAL_STICKER.sitePerMinute, 60_000, () => host.now());
    this.work = new WorkBudget(options.siteWorkMs ?? PERSONAL_STICKER.siteWorkMsPerHour, 3600_000, () => host.now(), "stickers.siteWork");
  }

  arriving(): number {
    const wait = Math.max(this.arrivals.wait(SITE), this.work.wait());
    if (wait === 0) this.arrivals.hit(SITE);
    return wait;
  }

  worked(ms: number): void {
    this.work.spend(ms);
  }

  get on(): boolean {
    return this.options.on;
  }

  get moving(): boolean {
    return this.options.on && this.options.moving === true;
  }

  private get maxBytes(): number {
    return this.options.maxBytes ?? PERSONAL_STICKER.siteMegabytes * 1024 * 1024;
  }

  static owns(key: string): boolean {
    return key.startsWith(PREFIX);
  }

  load(key: string, value: unknown): void {
    const doc = value as StickerDoc;
    const held = doc?.held;
    if (
      !isStickerId(doc?.id) ||
      key !== `${PREFIX}${doc.id}` ||
      typeof doc.by !== "string" ||
      typeof doc.account !== "string" ||
      typeof doc.at !== "number" ||
      typeof doc.bytes !== "number" ||
      typeof doc.hash !== "string" ||
      typeof held !== "object" ||
      held === null ||
      Array.isArray(held)
    ) {
      throw new Error("not a sticker");
    }
    doc.held = Object.fromEntries(Object.entries(held).filter(([profile, at]) => typeof profile === "string" && typeof at === "number"));
    this.remember(doc);
  }

  docFor(key: string): unknown {
    return this.docs.get(key.slice(PREFIX.length));
  }

  private remember(doc: StickerDoc): void {
    this.docs.set(doc.id, doc);
    this.byHash.set(sameKey(doc.by, doc.hash), doc.id);
    this.bytesInAll += doc.bytes;
    for (const profile of Object.keys(doc.held)) this.held.set(profile, (this.held.get(profile) ?? new Set()).add(doc.id));
  }

  async reconcile(): Promise<{ pictures: number; documents: number; missing: number }> {
    let pictures = 0;
    let documents = 0;
    let missing = 0;
    try {
      const there = new Set(await this.files.ids());
      for (const id of there) {
        if (this.docs.has(id)) continue;
        await this.files.remove(id);
        pictures++;
      }
      for (const doc of [...this.docs.values()]) {
        if (Object.keys(doc.held).length === 0) {
          this.discard(doc.id);
          documents++;
        } else if (!there.has(doc.id)) missing++;
      }
    } catch (error) {
      this.options.log?.warn(`Personal stickers: could not tidy at start (${(error as Error).message}).`);
    }
    if (pictures + documents > 0) this.options.log?.warn(`Personal stickers: let go of ${pictures} picture(s) with no record and ${documents} record(s) nobody has.`);
    if (missing > 0) this.options.log?.warn(`Personal stickers: ${missing} record(s) have no picture where pictures are kept (kept, shown as no longer available).`);
    return { pictures, documents, missing };
  }

  of(profileId: string): MyStickers {
    const ids = [...(this.held.get(profileId) ?? [])];
    const stickers = ids
      .map((id) => this.docs.get(id)!)
      .sort((a, b) => b.held[profileId]! - a.held[profileId]!)
      .map((doc) => ({ id: doc.id, mine: doc.by === profileId }));
    return { stickers };
  }

  holds(profileId: string, id: string): boolean {
    return this.held.get(profileId)?.has(id) ?? false;
  }

  has(id: string): boolean {
    return this.docs.has(id);
  }

  private count(profileId: string): number {
    return this.held.get(profileId)?.size ?? 0;
  }

  private hold(profileId: string, doc: StickerDoc): void {
    doc.held[profileId] = this.host.now();
    this.held.set(profileId, (this.held.get(profileId) ?? new Set()).add(doc.id));
    this.host.touch(`${PREFIX}${doc.id}`);
  }

  async make(profileId: string, accountId: string, sent: Buffer, delays?: readonly number[]): Promise<StickerOutcome<string>> {
    const before = this.making.get(profileId) ?? Promise.resolve();
    const run = before.then(() => this.makeNow(profileId, accountId, sent, delays));
    const after = run.catch(() => {});
    this.making.set(profileId, after);
    try {
      return await run;
    } finally {
      if (this.making.get(profileId) === after) this.making.delete(profileId);
    }
  }

  private async makeNow(profileId: string, accountId: string, sent: Buffer, delays?: readonly number[]): Promise<StickerOutcome<string>> {
    if (!this.on) return no("off");
    if (!this.host.on(profileId)) return no("friends_off");
    if (this.count(profileId) >= PERSONAL_STICKER.perProfile) return no("full");
    if (this.writing >= PERSONAL_STICKER.writesAtOnce) return no("site_full");
    const wait = this.made.wait(accountId);
    if (wait > 0) return no("too_many", wait);
    if (delays && !this.moving) return no("not_a_picture");
    if (delays) {
      const tries = this.tried.wait(accountId);
      if (tries > 0) return no("too_many", tries);
      this.tried.hit(accountId);
    }
    let made: MadeSticker;
    const spend = (ms: number) => this.work.spend(ms);
    try {
      if (delays) made = await makeMovingSticker(sent, delays, spend);
      else {
        const began = performance.now();
        try {
          made = makeSticker(sent);
        } finally {
          spend(performance.now() - began);
        }
      }
    } catch (error) {
      this.options.log?.warn(`Personal stickers: could not make one that moves (${(error as Error).message}).`);
      return no("not_a_picture");
    }
    if (!made.ok) return no(made.error);
    this.made.hit(accountId);
    const known = this.docs.get(this.byHash.get(sameKey(profileId, made.hash)) ?? "");
    if (known) {
      if (!this.holds(profileId, known.id)) this.hold(profileId, known);
      return { ok: true, value: known.id };
    }
    if (this.docs.size + this.writing >= PERSONAL_STICKER.siteMax || this.bytesInAll + made.data.length > this.maxBytes || this.writing >= PERSONAL_STICKER.writesAtOnce) {
      this.made.undo(accountId);
      return no("site_full");
    }
    const id = randomBytes(16).toString("base64url");
    this.writing++;
    this.bytesInAll += made.data.length;
    const settle = () => {
      this.writing--;
      this.bytesInAll -= made.data.length;
    };
    const written = this.files.put(id, made.data);
    try {
      await within(written, this.options.writeMs ?? WRITE_MS);
    } catch (error) {
      this.made.undo(accountId);
      if (error !== LATE) {
        settle();
        throw error;
      }
      void written.then(
        () =>
          this.files.remove(id).then(settle, (failed: unknown) => {
            this.options.log?.warn(`Personal stickers: a picture written too late could not be removed (${(failed as Error).message}); it is removed at the next start.`);
          }),
        settle,
      );
      throw new Error("Personal stickers: a picture was not written in time.");
    }
    settle();
    if (this.count(profileId) >= PERSONAL_STICKER.perProfile) {
      this.made.undo(accountId);
      await this.files.remove(id).catch(() => {});
      return no("full");
    }
    const doc: StickerDoc = { v: 1, id, by: profileId, account: accountId, at: this.host.now(), bytes: made.data.length, hash: made.hash, held: {} };
    this.remember(doc);
    this.hold(profileId, doc);
    return { ok: true, value: id };
  }

  save(profileId: string, id: string): StickerOutcome<null> {
    if (!this.on) return no("off");
    if (!this.host.on(profileId)) return no("friends_off");
    const doc = this.docs.get(id);
    if (!doc) return no("gone");
    if (this.holds(profileId, id)) return { ok: true, value: null };
    if (this.count(profileId) >= PERSONAL_STICKER.perProfile) return no("full");
    this.hold(profileId, doc);
    return { ok: true, value: null };
  }

  release(profileId: string, id: string): StickerOutcome<null> {
    const doc = this.docs.get(id);
    if (!doc || !this.holds(profileId, id)) return no("gone");
    delete doc.held[profileId];
    const mine = this.held.get(profileId);
    mine?.delete(id);
    if (mine?.size === 0) this.held.delete(profileId);
    if (Object.keys(doc.held).length === 0) this.discard(id);
    else this.host.touch(`${PREFIX}${id}`);
    return { ok: true, value: null };
  }

  forget(profileId: string): void {
    for (const id of [...(this.held.get(profileId) ?? [])]) this.release(profileId, id);
  }

  async picture(id: string): Promise<Buffer | undefined> {
    if (!this.docs.has(id)) return undefined;
    return this.files.get(id);
  }

  private discard(id: string): void {
    const doc = this.docs.get(id);
    if (!doc) return;
    this.docs.delete(id);
    if (this.byHash.get(sameKey(doc.by, doc.hash)) === id) this.byHash.delete(sameKey(doc.by, doc.hash));
    this.bytesInAll -= doc.bytes;
    for (const profile of Object.keys(doc.held)) {
      const mine = this.held.get(profile);
      mine?.delete(id);
      if (mine?.size === 0) this.held.delete(profile);
    }
    this.host.drop(`${PREFIX}${id}`);
    void this.files.remove(id).catch((error: Error) => this.options.log?.warn(`Personal stickers: could not remove a picture (${error.message}); the next start does.`));
  }

  list(): StickerListing[] {
    return [...this.docs.values()]
      .sort((a, b) => b.at - a.at)
      .map((doc) => ({ id: doc.id, at: doc.at, bytes: doc.bytes, by: doc.by, account: doc.account, holders: Object.keys(doc.held).length }));
  }

  takeDown(id: string): number {
    const doc = this.docs.get(id);
    if (!doc) return 0;
    const holders = Object.keys(doc.held).length;
    this.discard(id);
    return Math.max(1, holders);
  }

  takeDownBy(maker: string): number {
    const made = [...this.docs.values()].filter((doc) => doc.by === maker || doc.account === maker);
    for (const doc of made) this.discard(doc.id);
    return made.length;
  }

  get size(): { stickers: number; bytes: number } {
    return { stickers: this.docs.size, bytes: this.bytesInAll };
  }
}
