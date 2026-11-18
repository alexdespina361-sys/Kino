import type { AccountStore, StoreNotice } from "../accounts/store";
import type { PushSender } from "./fcm";

export const UPDATE_TOPIC = "app-updates";
export const QUIET_MS = 20_000;
const DAY_S = 86_400;
const MAX_QUIET = 5000;

export class PushHub {
  private readonly last = new Map<string, number>();
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

  async appUpdate(versionCode: number): Promise<boolean> {
    if (!this.sender) return false;
    const result = await this.track(this.sender.send({ topic: UPDATE_TOPIC, data: { kind: "update", version: String(versionCode) }, collapseKey: "update", ttlSeconds: 7 * DAY_S }));
    if (result !== "sent") this.log.warn(`The news of version ${versionCode} of the app was not sent (${result}).`);
    return result === "sent";
  }
}
