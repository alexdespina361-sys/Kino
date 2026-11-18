export interface Kept {
  get(key: string): string | null | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
}

const KEY = "tv.subsync.guard";
const MAX_STRIKES = 3;
const RETRY_AFTER_MS = 3 * 24 * 3600 * 1000;

interface Mark {
  strikes: number;
  starting?: number;
  at?: number;
}

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
    }
  }

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

  proved(): void {
    this.write({ strikes: 0, at: this.now() });
  }

  interrupted(): void {
    const mark = this.read();
    if (mark.starting === undefined) return;
    this.write({ strikes: mark.strikes, at: this.now() });
  }
}
