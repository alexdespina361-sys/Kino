/** A piece of the film's sound as hls.js hands it to the player: the start of the init segment in force, and the bytes of the piece. */
export interface Piece {
  /** Where the piece starts and ends, in the video's time. */
  start: number;
  end: number;
  init: Uint8Array;
  data: Uint8Array;
}

/** The parts of an hls.js `BUFFER_APPENDING` event this needs. */
interface Appending {
  type: string;
  data: Uint8Array;
  frag: {
    start: number;
    duration: number;
    elementaryStreams?: Record<string, { startPTS?: number | null; endPTS?: number | null } | null | undefined>;
  };
}

/** The parts of hls.js this needs, so that a stand-in can be used to test it. */
export interface HlsEvents {
  on(event: string, listener: (event: string, data: never) => void): void;
  off(event: string, listener: (event: string, data: never) => void): void;
}

/** What is kept for an aligner whose code is still on its way: the first pieces of the film, up to this many bytes. */
const MAX_KEPT_BYTES = 16 * 1024 * 1024;

/** Whether `bytes` is the start of an init segment (an MP4 header), not of a piece of media. */
const isInit = (bytes: Uint8Array): boolean => {
  const tag = String.fromCharCode(bytes[4] ?? 0, bytes[5] ?? 0, bytes[6] ?? 0, bytes[7] ?? 0);
  return tag === "ftyp" || tag === "moov";
};

/**
 * Takes a copy of the film's sound as hls.js puts it into the player's buffer (after it has unpacked TS streams into MP4 pieces), with
 * the init segment each piece needs. hls.js hands the same bytes on to the player afterwards, so only copies leave this.
 *
 * The player owns it, from the moment it makes hls.js to the moment it lets it go, and the aligner (whenever there is one) is connected to
 * it. It has to be listening from the start whatever the aligner is doing: the init segment comes once (again only when the stream
 * changes), and a piece is appended only once, however far ahead of the picture it is. So the init segments are always learned (a few
 * hundred bytes), and a viewer who turns the aligner on in the middle of a film has them; the pieces are copied only while someone takes
 * them, or is on the way to (`keep`).
 */
export class AudioTap {
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

  /** The pieces from now on go to `take`, after the ones that were kept for it. */
  connect(take: (piece: Piece) => void): void {
    const waiting = this.kept;
    this.kept = [];
    this.keptBytes = 0;
    this.keeping = false;
    this.take = take;
    for (const piece of waiting) take(piece);
  }

  /** Nobody takes the pieces any more. */
  disconnect(): void {
    this.take = undefined;
  }

  /** While nobody takes the pieces: keep the first of them (`on`) for the one who will, or let them go. */
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
    // (When there is no more room for the pieces that are kept it is the later ones that go: the picture is at the start of the film, and the aligner works forwards from it.)
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
