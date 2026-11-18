export interface Opened {
  status: number;
  contentType: string;
  length: number;
  stream: AsyncIterable<Uint8Array>;
}

export class Piece {
  private readonly chunks: Uint8Array[] = [];
  private fate: "filling" | "whole" | "broken" = "filling";
  private readonly waiting = new Set<() => void>();
  size = 0;

  constructor(
    readonly status: number,
    readonly contentType: string,
    readonly length: number,
  ) {}

  add(chunk: Uint8Array): void {
    this.chunks.push(chunk);
    this.size += chunk.byteLength;
    this.wake();
  }

  end(whole: boolean): void {
    this.fate = whole ? "whole" : "broken";
    this.wake();
  }

  async *read(): AsyncGenerator<Uint8Array> {
    for (let next = 0; ; ) {
      while (next < this.chunks.length) yield this.chunks[next++]!;
      if (this.fate === "whole") return;
      if (this.fate === "broken") throw new Error("the piece broke off");
      await new Promise<void>((resolve) => this.waiting.add(resolve));
    }
  }

  private wake(): void {
    const waiting = [...this.waiting];
    this.waiting.clear();
    for (const resume of waiting) resume();
  }
}

export const DEFAULT_SEGMENT_CACHE_BYTES = 64 * 1024 * 1024;

export interface SegmentCacheOptions {
  maxBytes?: number;
  keepMs?: number;
  maxPiece?: number;
  maxUnderway?: number;
  now?: () => number;
}

export class SegmentCache {
  private readonly kept = new Map<string, { piece: Piece; until: number }>();
  private readonly underway = new Map<string, Promise<Piece | null>>();
  private bytes = 0;
  private readonly maxBytes: number;
  private readonly keepMs: number;
  readonly maxPiece: number;
  private readonly maxUnderway: number;
  private readonly now: () => number;
  hits = 0;
  misses = 0;

  constructor(options: SegmentCacheOptions = {}) {
    this.maxBytes = options.maxBytes ?? DEFAULT_SEGMENT_CACHE_BYTES;
    this.keepMs = options.keepMs ?? 3 * 60_000;
    this.maxPiece = options.maxPiece ?? 12 * 1024 * 1024;
    this.maxUnderway = options.maxUnderway ?? 10;
    this.now = options.now ?? Date.now;
  }

  get keptBytes(): number {
    return this.bytes;
  }

  async get(key: string, open: () => Promise<Opened | null>): Promise<Piece | null> {
    const have = this.kept.get(key);
    if (have) {
      if (have.until > this.now()) {
        this.hits += 1;
        return have.piece;
      }
      this.forget(key);
    }
    const coming = this.underway.get(key);
    if (coming) {
      this.hits += 1;
      return coming;
    }
    this.misses += 1;
    if (this.underway.size >= this.maxUnderway) return null;
    const started = this.start(key, open);
    this.underway.set(key, started);
    return started;
  }

  private async start(key: string, open: () => Promise<Opened | null>): Promise<Piece | null> {
    let opened: Opened | null = null;
    try {
      opened = await open();
    } catch {
    }
    if (!opened || !Number.isInteger(opened.length) || opened.length < 0 || opened.length > this.maxPiece) {
      this.underway.delete(key);
      if (opened) void opened.stream[Symbol.asyncIterator]().return?.();
      return null;
    }
    const piece = new Piece(opened.status, opened.contentType, opened.length);
    void this.fill(key, piece, opened.stream);
    return piece;
  }

  private async fill(key: string, piece: Piece, stream: AsyncIterable<Uint8Array>): Promise<void> {
    let whole = false;
    try {
      for await (const chunk of stream) {
        piece.add(chunk);
        if (piece.size > piece.length) break;
      }
      whole = piece.size === piece.length;
    } catch {
      whole = false;
    }
    piece.end(whole);
    this.underway.delete(key);
    if (whole && piece.status === 200) this.keep(key, piece);
  }

  private keep(key: string, piece: Piece): void {
    this.forget(key);
    const now = this.now();
    for (const [other, entry] of this.kept) if (entry.until <= now) this.forget(other);
    for (const [oldest] of this.kept) {
      if (this.bytes + piece.size <= this.maxBytes) break;
      this.forget(oldest);
    }
    if (piece.size > this.maxBytes) return;
    this.kept.set(key, { piece, until: now + this.keepMs });
    this.bytes += piece.size;
  }

  private forget(key: string): void {
    const entry = this.kept.get(key);
    if (!entry) return;
    this.kept.delete(key);
    this.bytes -= entry.piece.size;
  }
}
