import { randomBytes } from "node:crypto";
import { isStickerId, MOVING_STICKER, PERSONAL_STICKER, type MyStickers, type StickerProblem } from "../../shared";
import { RateLimiter } from "./rateLimit";
import { makeMovingSticker, makeSticker, type MadeSticker } from "./stickerImage";
import type { StickerFiles } from "./stickerFiles";

/**
 * The personal stickers (shared/stickers.ts): what is said of each (whose it is, who has it) as a document of the accounts' kind, kept and written with them;
 * the picture where `StickerFiles` keeps it. A picture is kept while a profile has it in its collection: whoever made it, and whoever saved it from a chat.
 * The last one to let it go, or the team taking it down, lets it go for good (its messages then say it is no longer available).
 *
 * Who may see a picture is not here: a profile that has it (its collection's routes), and the two of a chat it was sent in, while they are friends (the chat's
 * routes ask `ChatBook.hasSticker`). Nothing here is shown to anyone but the team: the account and the profile that made a sticker are for a takedown only.
 */

/** The book's view of the store, and of the profiles. */
export interface StickerHost {
  touch(key: string): void;
  drop(key: string): void;
  now(): number;
  /** A profile with friends on: one that can chat (a child's profile cannot). */
  on(profileId: string): boolean;
}

interface StickerDoc {
  v: 1;
  id: string;
  /** The profile that made it, and its account: the team's to know, for a takedown. Never in an answer to anyone else. */
  by: string;
  account: string;
  at: number;
  bytes: number;
  /** Of the picture as kept: the same picture made twice by one profile is one sticker. */
  hash: string;
  /** The profiles that have it, and since when. */
  held: Record<string, number>;
}

export type StickerOutcome<T> = { ok: true; value: T } | { ok: false; error: StickerProblem | "gone" | "friends_off"; waitMs?: number };

const PREFIX = "sticker:";
const DAY = 24 * 3600 * 1000;
const no = (error: StickerProblem | "gone" | "friends_off", waitMs?: number) => ({ ok: false as const, error, ...(waitMs ? { waitMs } : {}) });
/**
 * The same picture made again by the same profile is the sticker it made: by somebody else, it is a sticker of theirs (one profile's picture is never found by
 * another making the same one, which would tell them that somebody had, and put it out of the reach of a takedown of what they made).
 */
const sameKey = (profileId: string, hash: string) => `${profileId} ${hash}`;

/** What the team is shown of a sticker (scripts/stickers.mjs). */
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
  /** profile -> the stickers it has. */
  private readonly held = new Map<string, Set<string>>();
  private readonly made: RateLimiter;
  /** The ones that move an account sent to be made today, made or not (`MOVING_STICKER.triesPerDay`). */
  private readonly tried: RateLimiter;
  private bytesInAll = 0;
  /** Pictures on their way to `files` (counted already, so two at once cannot both take the last room). */
  private writing = 0;
  /** What a profile is making now: its makes go one after the other, so the same picture sent twice at once is one sticker (the judge, 17 Nov). */
  private readonly making = new Map<string, Promise<unknown>>();
  /**
   * How many pictures an account may ask for in a minute, of its collection and of its chats together (stickerRoutes.ts, chatRoutes.ts): one allowance, not one
   * for each place, so the pictures are not twice as many reads of where they are kept (the judge, 17 Nov).
   */
  readonly pictureReads: RateLimiter;

  constructor(
    private readonly host: StickerHost,
    private readonly files: StickerFiles,
    /**
     * `on`: the host turned them on (the kill switch is turning it off). `moving`: and stickers that move (shared/stickers.ts `MOVING_STICKER`). `maxBytes`: of
     * all the pictures together. `uploadMs`: how long a picture let in may take to arrive (stickerRoutes.ts; tests make it short).
     */
    readonly options: { on: boolean; moving?: boolean; maxBytes?: number; uploadMs?: number; log?: { warn(message: string): void } },
  ) {
    this.made = new RateLimiter(PERSONAL_STICKER.madePerDay, DAY, () => host.now());
    this.tried = new RateLimiter(MOVING_STICKER.triesPerDay, DAY, () => host.now());
    this.pictureReads = new RateLimiter(PERSONAL_STICKER.picturesPerMinute, 60_000, () => host.now());
  }

  get on(): boolean {
    return this.options.on;
  }

  /** Whether stickers that move are made (only while personal stickers are on). */
  get moving(): boolean {
    return this.options.on && this.options.moving === true;
  }

  private get maxBytes(): number {
    return this.options.maxBytes ?? PERSONAL_STICKER.siteMegabytes * 1024 * 1024;
  }

  /* ------------------------------ persistence ------------------------------ */

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

  /**
   * After start: a picture with no document (its document was never written: the server stopped between the two) is let go, and so is a document nobody
   * has. A document whose picture is not there is only said (its messages already say "no longer available"): a home of the pictures that comes up empty by
   * mistake must not take every sticker's record with it. A failure is said and left for the next start.
   */
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

  /* ------------------------------ a profile's collection ------------------------------ */

  /** A profile's stickers, the newest first. */
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

  /** Whether the site keeps this picture. */
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

  /**
   * A profile makes a sticker of a picture its page made (a PNG: see stickerImage.ts). So many a day for an account; so many for a profile; the site keeps so
   * many, and so much. The same picture made again by the profile is the sticker it made. Answers with the sticker's name.
   */
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
    const wait = this.made.wait(accountId);
    if (wait > 0) return no("too_many", wait);
    // (One that moves only while those are on as well: the page that sent one while they are off is told it is not a picture, and makes a still one.)
    if (delays && !this.moving) return no("not_a_picture");
    // (One that moves takes the server's time to pack, kept or not: each sent is one of the day's tries, whatever comes of it.)
    if (delays) {
      const tries = this.tried.wait(accountId);
      if (tries > 0) return no("too_many", tries);
      this.tried.hit(accountId);
    }
    let made: MadeSticker;
    try {
      made = delays ? await makeMovingSticker(sent, delays) : makeSticker(sent);
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
    if (this.docs.size + this.writing >= PERSONAL_STICKER.siteMax || this.bytesInAll + made.data.length > this.maxBytes) {
      this.made.undo(accountId);
      return no("site_full");
    }
    const id = randomBytes(16).toString("base64url");
    this.writing++;
    this.bytesInAll += made.data.length;
    try {
      await this.files.put(id, made.data);
    } catch (error) {
      this.bytesInAll -= made.data.length;
      this.made.undo(accountId);
      throw error;
    } finally {
      this.writing--;
    }
    this.bytesInAll -= made.data.length; // (counted again as the document's, below)
    // (A save while the picture was being written may have filled the collection: then nothing was made, and it does not count as one of the day's.)
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

  /** A profile saves a sticker a friend sent it (the chat's routes have checked that it was). Saving one it has already is nothing. */
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

  /** A profile lets one of its stickers go. The last to let a picture go lets it go for good. */
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

  /** A profile is gone: so is its hold on every sticker (and every picture only it had). */
  forget(profileId: string): void {
    for (const id of [...(this.held.get(profileId) ?? [])]) this.release(profileId, id);
  }

  /** The picture, while the site keeps it. Who may see it is the routes' to say. */
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

  /* ------------------------------ the team's ------------------------------ */

  /** Every sticker, the newest first. */
  list(): StickerListing[] {
    return [...this.docs.values()]
      .sort((a, b) => b.at - a.at)
      .map((doc) => ({ id: doc.id, at: doc.at, bytes: doc.bytes, by: doc.by, account: doc.account, holders: Object.keys(doc.held).length }));
  }

  /** Take a sticker down everywhere: out of every collection, and its picture gone. How many had it (none: there was no such sticker). */
  takeDown(id: string): number {
    const doc = this.docs.get(id);
    if (!doc) return 0;
    const holders = Object.keys(doc.held).length;
    this.discard(id);
    return Math.max(1, holders);
  }

  /** Take down every sticker a profile or an account made. How many were taken down. */
  takeDownBy(maker: string): number {
    const made = [...this.docs.values()].filter((doc) => doc.by === maker || doc.account === maker);
    for (const doc of made) this.discard(doc.id);
    return made.length;
  }

  get size(): { stickers: number; bytes: number } {
    return { stickers: this.docs.size, bytes: this.bytesInAll };
  }
}
