/** What the other end answered with, ready to be passed on: the status and type, how long the body is, and the body as it arrives. */
export interface Opened {
  status: number;
  contentType: string;
  length: number;
  stream: AsyncIterable<Uint8Array>;
}

/** A piece of a film that is arriving or has arrived. Anyone can read it from the start, however far it has got. */
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

  /** The bytes from the first one, waiting for the ones that have not come yet; fails if the piece breaks off. */
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

/** How many bytes of finished pieces a cache keeps unless it is told otherwise. */
export const DEFAULT_SEGMENT_CACHE_BYTES = 64 * 1024 * 1024;

export interface SegmentCacheOptions {
  /** How many bytes of finished pieces are kept; the oldest go first. */
  maxBytes?: number;
  /** For how long a finished piece is kept. */
  keepMs?: number;
  /** The longest piece that is shared (the length it says it has); a longer one is passed on without being kept. */
  maxPiece?: number;
  /** How many pieces can be arriving at once to be shared; past that they are passed on without being. */
  maxUnderway?: number;
  now?: () => number;
}

/**
 * The pieces of a film (HLS segments) that screens watching together all ask for, a few seconds apart. The first request goes to the place
 * the film comes from; the others, while the piece is still arriving and for a few minutes after, are answered from here, so the place is
 * asked once instead of once per screen, and a party of five does not look like five viewers to a site that counts them. What is kept is
 * limited in bytes.
 */
export class SegmentCache {
  private readonly kept = new Map<string, { piece: Piece; until: number }>();
  private readonly underway = new Map<string, Promise<Piece | null>>();
  private bytes = 0;
  private readonly maxBytes: number;
  private readonly keepMs: number;
  /** The longest piece that is shared, in bytes: what `open` should hand over to the caller instead. */
  readonly maxPiece: number;
  private readonly maxUnderway: number;
  private readonly now: () => number;
  /** Asks answered from a piece that was kept or was already on its way: the place the film comes from was not asked again. */
  hits = 0;
  /** Asks that had to go to the place the film comes from (or were passed on to it without being shared). */
  misses = 0;

  constructor(options: SegmentCacheOptions = {}) {
    this.maxBytes = options.maxBytes ?? DEFAULT_SEGMENT_CACHE_BYTES;
    this.keepMs = options.keepMs ?? 3 * 60_000;
    this.maxPiece = options.maxPiece ?? 12 * 1024 * 1024;
    this.maxUnderway = options.maxUnderway ?? 10;
    this.now = options.now ?? Date.now;
  }

  /** How many bytes are kept (for tests). */
  get keptBytes(): number {
    return this.bytes;
  }

  /**
   * The piece at `key`: the one that is kept, or the one that is already on its way, or else the one `open` brings. Null when it is not
   * one to share (`open` says so, or fails, or too many are on their way): the caller then does it the ordinary way.
   */
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
      // (nothing to share: the caller asks again its own way, which says what went wrong)
    }
    if (!opened || !Number.isInteger(opened.length) || opened.length < 0 || opened.length > this.maxPiece) {
      this.underway.delete(key);
      if (opened) void opened.stream[Symbol.asyncIterator]().return?.(); // (let go of the connection it holds)
      return null;
    }
    const piece = new Piece(opened.status, opened.contentType, opened.length);
    void this.fill(key, piece, opened.stream);
    return piece;
  }

  /** Reads the rest of the piece, whoever is or is not still reading it, and keeps it once whole (if it went well). */
  private async fill(key: string, piece: Piece, stream: AsyncIterable<Uint8Array>): Promise<void> {
    let whole = false;
    try {
      for await (const chunk of stream) {
        piece.add(chunk);
        if (piece.size > piece.length) break; // longer than it said (or not the bytes it said): not to be trusted
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
