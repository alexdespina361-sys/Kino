import { mergeRanges, SAMPLE_RATE, type Range } from "./signals";
import type { Piece } from "./tap";

/** Sound is kept as 16-bit samples (32 KB a second): about 12 minutes of it by default, what waits for the voice detector included. */
const MAX_PCM_BYTES = 24 * 1024 * 1024;
/**
 * Pieces waiting to be decoded, as the bytes hls.js gave (a muxed film's pieces are megabytes each, and its sound a tenth of that or less).
 * Decoding takes a few milliseconds a piece, so while the aligner works the queue stays short however fast the pieces come; while it is
 * paused, what is over this is decoded rather than let go. Only past twice this does the farthest from the picture go.
 */
const MAX_QUEUE_BYTES = 16 * 1024 * 1024;
/**
 * How far ahead of the picture the sound goes on to the voice detector (and so to the recogniser), in seconds, unless `FeedOptions.ahead` says
 * further. A screen alone downloads up to ten minutes ahead in a few seconds (see `bufferPolicy`); working through all of that at once is a
 * minute or two of the processor at full stretch for sound that may never be played (the viewer stops, or jumps), so what is further waits,
 * decoded, and goes on as the picture comes nearer (`advance`). About what a screen downloaded ahead through the website's proxy (90 s).
 */
export const AHEAD_S = 120;
/** Pieces of a film are this close to each other when they follow on (hls.js times them to the audio's own clock). */
const GAP = 0.1;

interface Stored {
  start: number;
  end: number;
  samples: Int16Array;
}

export interface FeedOptions {
  /** Turns the bytes (init segment + piece) into 16 kHz mono sound; rejects when the sound cannot be read. */
  decode(bytes: Uint8Array): Promise<Float32Array>;
  /** Where the sound goes next (the aligner's voice detector). Waited for, one piece at a time. */
  sink(time: number, pcm: Float32Array): Promise<void> | void;
  /** Where the picture is (the pieces nearest to it are the ones to keep). */
  playhead(): number;
  /** The sound cannot be read on this device. */
  unreadable(): void;
  /** How far ahead of the picture the sound goes on to the voice detector, in seconds (`AHEAD_S` when not given). */
  ahead?(): number;
  maxQueueBytes?: number;
  maxPcmBytes?: number;
}

/**
 * The film's sound as it arrives: decoded a piece at a time as soon as it comes, handed to the voice detector from the piece nearest the
 * picture on (up to `AHEAD_S` ahead of it), and kept (small) for the recogniser, which wants windows of it later. Decoding does not wait for
 * the voice detector: when it did, a screen that downloaded minutes of film in a few seconds let most of their sound go before it was read,
 * and the aligner had nothing to time from there on ("Syncing…" for good). When the device cannot keep up, or the film is far ahead, what is
 * farthest from the picture is let go.
 */
export class AudioFeed {
  private queue: Piece[] = [];
  private queueBytes = 0;
  /** Decoded, waiting for the voice detector (too far ahead of the picture yet, or behind the pieces before it). */
  private waiting: Stored[] = [];
  /** Through the voice detector (or on the way): what `ranges` and `pcm` give. */
  private store: Stored[] = [];
  private pcmBytes = 0;
  private decoding = false;
  private sinking = false;
  private failures = 0;
  private decodedAny = false;
  private generation = 0;
  private paused = false;
  /** For the debug panel: pieces taken, and the ones let go before they were decoded (while paused, and not), or after, or that would not decode. */
  readonly counts = { pushed: 0, droppedPaused: 0, dropped: 0, droppedDecoded: 0, failed: 0 };

  constructor(private readonly options: FeedOptions) {}

  /** A piece from the tap. One that is known already (hls.js appends a piece again after a seek back) is ignored. */
  push(piece: Piece): void {
    if (this.known(piece.start)) return;
    this.counts.pushed++;
    this.queue.push(piece);
    this.queueBytes += piece.data.length + piece.init.length;
    this.trimQueue();
    void this.decodeAll();
  }

  /**
   * While paused the pieces are kept as they come and none goes to the voice detector: there is nothing to time yet. They are kept as the
   * bytes they came as, and only what would not fit is decoded (smaller), so that a viewer who turns the subtitles on later has the sound ahead.
   */
  pause(on: boolean): void {
    if (this.paused === on) return;
    this.paused = on;
    if (!on) {
      void this.decodeAll();
      void this.sinkAll();
    }
  }

  /** The picture has moved: sound that has come within reach of it goes on to the voice detector. */
  advance(): void {
    if (!this.paused) void this.sinkAll();
  }

  /** Resolves once every piece given so far has been decoded and the ones within reach of the picture handed on (or let go); pieces held back by a pause do not count. */
  async idle(): Promise<void> {
    while (this.decoding || this.sinking || (!this.paused && (this.queue.length > 0 || this.nextToSink() >= 0))) await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }

  /** The sound that has gone to the voice detector, which can be asked for with `pcm`. */
  ranges(): Range[] {
    return mergeRanges(this.store.map((s) => ({ from: s.start, to: s.end + GAP })));
  }

  /** The sound from `from` to `to` as the recogniser wants it, or undefined when some of it is missing. */
  pcm(from: number, to: number): Float32Array | undefined {
    const length = Math.round((to - from) * SAMPLE_RATE);
    const out = new Float32Array(length);
    let reached = from;
    for (const piece of this.store) {
      if (piece.end <= from) continue;
      if (piece.start >= to) break;
      if (piece.start > reached + GAP) return undefined;
      const first = Math.round((Math.max(piece.start, from) - piece.start) * SAMPLE_RATE);
      const into = Math.round((Math.max(piece.start, from) - from) * SAMPLE_RATE);
      const count = Math.min(piece.samples.length - first, length - into);
      for (let i = 0; i < count; i++) out[into + i] = (piece.samples[first + i] as number) / 32768;
      reached = Math.max(reached, piece.end);
      if (reached >= to - 0.05) return out;
    }
    return reached >= to - GAP ? out : undefined;
  }

  /** Another sound track (or a restart): everything held is from another sound. */
  reset(): void {
    this.generation++;
    this.queue = [];
    this.queueBytes = 0;
    this.waiting = [];
    this.store = [];
    this.pcmBytes = 0;
  }

  private known(start: number): boolean {
    const near = (a: number, b: number) => Math.abs(a - b) < 0.05;
    return this.store.some((s) => near(s.start, start)) || this.waiting.some((s) => near(s.start, start)) || this.queue.some((p) => near(p.start, start));
  }

  /** How far a piece starting at `start` is from the picture: what is behind it counts as farther, since the aligner is working forwards. */
  private distance(start: number, playhead: number): number {
    return start < playhead ? (playhead - start) * 4 : start - playhead;
  }

  private maxQueue(): number {
    return this.options.maxQueueBytes ?? MAX_QUEUE_BYTES;
  }

  /** Far over the limit (a device that cannot decode as fast as the pieces come): the pieces farthest from the picture go. */
  private trimQueue(): void {
    const playhead = this.options.playhead();
    while (this.queueBytes > 2 * this.maxQueue() && this.queue.length > 1) {
      let worst = 0;
      this.queue.forEach((piece, i) => {
        if (this.distance(piece.start, playhead) > this.distance((this.queue[worst] as Piece).start, playhead)) worst = i;
      });
      const [gone] = this.queue.splice(worst, 1) as [Piece];
      this.queueBytes -= gone.data.length + gone.init.length;
      if (this.paused) this.counts.droppedPaused++;
      else this.counts.dropped++;
    }
  }

  /** Over the limit of decoded sound: what is farthest from the picture goes, waiting or not. */
  private trimPcm(): void {
    const playhead = this.options.playhead();
    const max = this.options.maxPcmBytes ?? MAX_PCM_BYTES;
    while (this.pcmBytes > max && this.store.length + this.waiting.length > 1) {
      let worst: { list: Stored[]; index: number } | undefined;
      for (const list of [this.store, this.waiting]) {
        list.forEach((piece, index) => {
          if (!worst || this.distance(piece.start, playhead) > this.distance((worst.list[worst.index] as Stored).start, playhead)) worst = { list, index };
        });
      }
      const [gone] = worst!.list.splice(worst!.index, 1) as [Stored];
      this.pcmBytes -= gone.samples.byteLength;
      this.counts.droppedDecoded++;
    }
  }

  /** The queued piece nearest to the picture: sound that was held back while no subtitles were on is timed from where the viewer is, not from the oldest of it. */
  private takeNearest(): Piece {
    const playhead = this.options.playhead();
    let best = 0;
    for (let i = 1; i < this.queue.length; i++) {
      if (this.distance((this.queue[i] as Piece).start, playhead) < this.distance((this.queue[best] as Piece).start, playhead)) best = i;
    }
    const [piece] = this.queue.splice(best, 1) as [Piece];
    return piece;
  }

  /** Whether the queue is to be decoded now: while the aligner works, all of it; while paused, what is over the limit. */
  private decodeWanted(): boolean {
    return this.queue.length > 0 && (!this.paused || this.queueBytes > this.maxQueue());
  }

  private async decodeAll(): Promise<void> {
    if (this.decoding) return;
    this.decoding = true;
    const generation = this.generation;
    try {
      while (this.decodeWanted() && generation === this.generation) {
        const piece = this.takeNearest();
        this.queueBytes -= piece.data.length + piece.init.length;
        let pcm: Float32Array;
        try {
          const bytes = new Uint8Array(piece.init.length + piece.data.length);
          bytes.set(piece.init, 0);
          bytes.set(piece.data, piece.init.length);
          pcm = await this.options.decode(bytes);
        } catch {
          this.counts.failed++;
          if (generation === this.generation && !this.decodedAny && ++this.failures >= 3) {
            this.options.unreadable();
            this.queue = [];
            this.queueBytes = 0;
          }
          continue;
        }
        if (generation !== this.generation) break;
        this.decodedAny = true;
        const samples = new Int16Array(pcm.length);
        for (let i = 0; i < pcm.length; i++) samples[i] = Math.max(-32768, Math.min(32767, Math.round((pcm[i] as number) * 32767)));
        this.waiting.push({ start: piece.start, end: piece.start + pcm.length / SAMPLE_RATE, samples });
        this.pcmBytes += samples.byteLength;
        this.trimPcm();
        if (!this.paused) void this.sinkAll();
      }
    } finally {
      this.decoding = false;
    }
    // (A piece that came in after the loop looked, or after a reset.)
    if (this.decodeWanted()) void this.decodeAll();
  }

  /** The decoded piece to hand on next: the nearest to the picture, of those not too far ahead of it; -1 when there is none. */
  private nextToSink(): number {
    const playhead = this.options.playhead();
    const reach = playhead + Math.max(0, this.options.ahead?.() ?? AHEAD_S);
    let best = -1;
    this.waiting.forEach((piece, index) => {
      if (piece.start >= reach) return;
      if (best < 0 || this.distance(piece.start, playhead) < this.distance((this.waiting[best] as Stored).start, playhead)) best = index;
    });
    return best;
  }

  private async sinkAll(): Promise<void> {
    if (this.sinking) return;
    this.sinking = true;
    const generation = this.generation;
    try {
      for (let index = this.nextToSink(); index >= 0 && !this.paused && generation === this.generation; index = this.nextToSink()) {
        const [piece] = this.waiting.splice(index, 1) as [Stored];
        this.store.push(piece);
        this.store.sort((a, b) => a.start - b.start);
        const pcm = new Float32Array(piece.samples.length);
        for (let i = 0; i < pcm.length; i++) pcm[i] = (piece.samples[i] as number) / 32768;
        await this.options.sink(piece.start, pcm);
      }
    } finally {
      this.sinking = false;
    }
    // (Sound of a new start that was decoded while the last piece of the old one was being handed on.)
    if (!this.paused && this.nextToSink() >= 0) void this.sinkAll();
  }
}
