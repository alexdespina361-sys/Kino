import type { AccountStore, StoreNotice } from "../accounts/store";
import type { PushSender } from "./fcm";

/**
 * What the Android app is told of (docs/android-app.md): a friend wrote in a chat, or put something in the profile's inbox (a title, an invitation to a party or to
 * watch together, a plan, an answer to one), and that a new version of the app is out. The store says what happened (`onNotice`) and to which profile; the profile's
 * phones are the sessions the app said it is on (`setPush`). What goes to Firebase is the friend's name, the friend and the profile (by their ids) and the kind of
 * thing: never what was written, nor which title. A muted friend's messages are not told of (chat.ts does not say them), nor anything while friends are off for the
 * profile (nothing reaches it then).
 *
 * The same friend's messages are told of once in a while at most (`QUIET_MS`): the phone shows one notification for each friend, and it says there is something new.
 */

/** The topic every copy of the app listens to, for the news that there is a new version. */
export const UPDATE_TOPIC = "app-updates";
/** One notification for a friend's messages in this long, however many there are. */
export const QUIET_MS = 20_000;
/** How long Firebase keeps trying a phone that is off: a day for a message, a week for the news of a version. */
const DAY_S = 86_400;
const MAX_QUIET = 5000;

export class PushHub {
  private readonly last = new Map<string, number>();
  /** What was sent (tests read it; the owner's stats count it). */
  readonly counts = { sent: 0, gone: 0, failed: 0 };

  constructor(
    private readonly store: AccountStore,
    private readonly sender: PushSender | undefined,
    private readonly log: { warn(message: string): void } = { warn: () => {} },
  ) {
    if (sender) store.onNotice((notice) => void this.notice(notice));
  }

  get on(): boolean {
    return this.sender !== undefined;
  }

  /** Every send that is under way (tests wait for them). */
  private pending = new Set<Promise<unknown>>();
  settled(): Promise<void> {
    return Promise.all([...this.pending]).then(() => {});
  }

  private track<T>(promise: Promise<T>): Promise<T> {
    this.pending.add(promise);
    void promise.finally(() => this.pending.delete(promise));
    return promise;
  }

  private quiet(key: string): boolean {
    const now = this.store.clock();
    const at = this.last.get(key);
    if (at !== undefined && now - at < QUIET_MS) return true;
    this.last.delete(key);
    this.last.set(key, now);
    while (this.last.size > MAX_QUIET) this.last.delete(this.last.keys().next().value!);
    return false;
  }

  private async notice(notice: StoreNotice): Promise<void> {
    if (!this.sender) return;
    const tokens = this.store.pushTokensOf(notice.to);
    if (tokens.length === 0) return;
    const what = notice.kind === "chat" ? "chat" : notice.what;
    if (this.quiet(`${notice.to}|${notice.from}|${what}`)) return;
    const name = this.store.profileCard(notice.from)?.name ?? "";
    const data = { kind: what, name, friend: notice.from, profile: notice.to };
    await Promise.all(
      tokens.map((token) =>
        this.track(this.sender!.send({ token, data, collapseKey: `${what === "chat" ? "chat" : "inbox"}-${notice.from}`, ttlSeconds: DAY_S })).then((result) => {
          this.counts[result]++;
          if (result === "gone") this.store.dropPushToken(token);
        }),
      ),
    );
  }

  /**
   * Something new came out of what a profile watches (titleNotices/book.ts, which decides how often): its phones are told that there is, and nothing of
   * what or of which title. (An app older than 0.3.2 does not know the kind, and shows nothing.)
   */
  async titleNotice(profile: string): Promise<void> {
    if (!this.sender) return;
    const tokens = this.store.pushTokensOf(profile);
    const data = { kind: "title", name: "", friend: "", profile };
    await Promise.all(
      tokens.map((token) =>
        this.track(this.sender!.send({ token, data, collapseKey: "title", ttlSeconds: DAY_S })).then((result) => {
          this.counts[result]++;
          if (result === "gone") this.store.dropPushToken(token);
        }),
      ),
    );
  }

  /** Every copy of the app hears that version `versionCode` is out (it checks, downloads it and asks to be updated). */
  async appUpdate(versionCode: number): Promise<boolean> {
    if (!this.sender) return false;
    const result = await this.track(this.sender.send({ topic: UPDATE_TOPIC, data: { kind: "update", version: String(versionCode) }, collapseKey: "update", ttlSeconds: 7 * DAY_S }));
    if (result !== "sent") this.log.warn(`The news of version ${versionCode} of the app was not sent (${result}).`);
    return result === "sent";
  }
}
