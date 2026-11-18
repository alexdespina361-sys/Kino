export interface Piece {
  start: number;
  end: number;
  init: Uint8Array;
  data: Uint8Array;
}

export interface SoundTap {
  connect(take: (piece: Piece) => void): void;
  disconnect(): void;
  keep(on: boolean): void;
  wanted?(on: boolean): void;
  stop(): void;
}

interface Appending {
  type: string;
  data: Uint8Array;
  frag: {
    start: number;
    duration: number;
    elementaryStreams?: Record<string, { startPTS?: number | null; endPTS?: number | null } | null | undefined>;
  };
}

export interface HlsEvents {
  on(event: string, listener: (event: string, data: never) => void): void;
  off(event: string, listener: (event: string, data: never) => void): void;
}

const MAX_KEPT_BYTES = 16 * 1024 * 1024;

const isInit = (bytes: Uint8Array): boolean => {
  const tag = String.fromCharCode(bytes[4] ?? 0, bytes[5] ?? 0, bytes[6] ?? 0, bytes[7] ?? 0);
  return tag === "ftyp" || tag === "moov";
};

export class AudioTap implements SoundTap {
  private readonly inits = new Map<string, Uint8Array>();
  private take: ((piece: Piece) => void) | undefined;
  private keeping = false;
  private kept: Piece[] = [];
  private keptBytes = 0;
  private readonly listener = (_event: string, data: never): void => this.appending(data as Appending);

  constructor(
    private readonly hls: HlsEvents,
    private readonly event: string,
  ) {
    hls.on(event, this.listener);
  }

  connect(take: (piece: Piece) => void): void {
    const waiting = this.kept;
    this.kept = [];
    this.keptBytes = 0;
    this.keeping = false;
    this.take = take;
    for (const piece of waiting) take(piece);
  }

  disconnect(): void {
    this.take = undefined;
  }

  keep(on: boolean): void {
    this.keeping = on;
    if (!on) {
      this.kept = [];
      this.keptBytes = 0;
    }
  }

  stop(): void {
    this.hls.off(this.event, this.listener);
    this.inits.clear();
    this.take = undefined;
    this.keep(false);
  }

  private appending({ type, data, frag }: Appending): void {
    if (type !== "audio" && type !== "audiovideo") return;
    if (isInit(data)) {
      this.inits.set(type, data.slice());
      return;
    }
    const init = this.inits.get(type);
    const room = this.keeping && this.keptBytes + data.length <= MAX_KEPT_BYTES;
    if (!init || !(this.take || room)) return;
    const streams = frag.elementaryStreams?.[type];
    const start = streams?.startPTS ?? frag.start;
    const end = streams?.endPTS ?? start + frag.duration;
    const piece: Piece = { start, end, init, data: data.slice() };
    if (this.take) this.take(piece);
    else {
      this.kept.push(piece);
      this.keptBytes += piece.data.length;
    }
  }
}
