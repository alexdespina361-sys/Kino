/** Where the mark is kept (the page's localStorage; tests use a stand-in). */
export interface Kept {
  get(key: string): string | null | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
}

const KEY = "tv.subsync.guard";
/** A page that went down while the recogniser was loading this many times in a row is not asked to load it again for a while. */
const MAX_STRIKES = 3;
const RETRY_AFTER_MS = 3 * 24 * 3600 * 1000;

interface Mark {
  strikes: number;
  /** When the recogniser began to load, until it has listened to a window (or the page was closed on purpose). */
  starting?: number;
  at?: number;
}

/**
 * The recogniser's model is 17 MB and needs a good deal of memory to run; a small TV browser that cannot take it does not say so, it
 * just closes the page. A mark is left when the load starts and taken away when it has worked (or the page is closed the normal way),
 * so a mark that is still there at the next start means the page fell over, and a device that does that three times in a row is let
 * alone (the voice detector, which is small, still works) for three days.
 */
export class CrashGuard {
  constructor(
    private readonly kept: Kept,
    private readonly now: () => number = Date.now,
  ) {}

  private read(): Mark {
    try {
      const mark = JSON.parse(this.kept.get(KEY) ?? "{}") as Partial<Mark>;
      return { strikes: typeof mark.strikes === "number" ? mark.strikes : 0, ...(typeof mark.starting === "number" ? { starting: mark.starting } : {}), ...(typeof mark.at === "number" ? { at: mark.at } : {}) };
    } catch {
      return { strikes: 0 };
    }
  }

  private write(mark: Mark): void {
    try {
      this.kept.set(KEY, JSON.stringify(mark));
    } catch {
      // (Nothing can be kept: the guard cannot work, and does not get in the way.)
    }
  }

  /** Before the recogniser is loaded: whether to go on. */
  begin(): boolean {
    const before = this.read();
    let strikes = before.strikes + (before.starting !== undefined ? 1 : 0);
    const last = before.starting ?? before.at ?? 0;
    if (strikes >= MAX_STRIKES) {
      if (this.now() - last < RETRY_AFTER_MS) {
        this.write({ strikes, at: last });
        return false;
      }
      strikes = 0;
    }
    this.write({ strikes, starting: this.now(), at: this.now() });
    return true;
  }

  /** The recogniser listened to a window: this device can run it. */
  proved(): void {
    this.write({ strikes: 0, at: this.now() });
  }

  /** The page is being closed, or the load failed with an error (neither is a fall): the mark is taken away without a strike. */
  interrupted(): void {
    const mark = this.read();
    if (mark.starting === undefined) return;
    this.write({ strikes: mark.strikes, at: this.now() });
  }
}
