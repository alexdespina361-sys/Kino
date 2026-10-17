import { mergeRanges, SAMPLE_RATE, type Range } from "./signals";
import type { Piece } from "./tap";

/** Sound is kept for the recogniser as 16-bit samples (32 KB a second): about 12 minutes of it by default. */
const MAX_PCM_BYTES = 24 * 1024 * 1024;
/** Pieces waiting to be decoded, as the bytes hls.js gave (a muxed film's pieces are megabytes each). */
const MAX_QUEUE_BYTES = 16 * 1024 * 1024;
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
  maxQueueBytes?: number;
  maxPcmBytes?: number;
}

/**
 * The film's sound as it arrives: decoded one piece at a time, handed to the voice detector, and kept (small) for the recogniser, which
 * wants windows of it later. When the device cannot keep up, or the film is far ahead, what is farthest from the picture is let go.
 */
export class AudioFeed {
  private queue: Piece[] = [];
  private queueBytes = 0;
  private store: Stored[] = [];
  private storeBytes = 0;
  private working = false;
  private failures = 0;
  private decodedAny = false;
  private generation = 0;
  private paused = false;

  constructor(private readonly options: FeedOptions) {}

  /** A piece from the tap. One that is known already (hls.js appends a piece again after a seek back) is ignored. */
  push(piece: Piece): void {
    if (this.known(piece.start)) return;
    this.queue.push(piece);
    this.queueBytes += piece.data.length + piece.init.length;
    this.trim();
    void this.pump();
  }

  /** While paused the pieces are kept as they come (the farthest from the picture let go, as ever) and none is decoded: there is nothing to time yet. */
  pause(on: boolean): void {
    if (this.paused === on) return;
    this.paused = on;
    if (!on) void this.pump();
  }

  /** Resolves once every piece given so far has been decoded and handed on (or let go); pieces held back by a pause do not count. */
  async idle(): Promise<void> {
    while (this.working || (this.queue.length > 0 && !this.paused)) await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }

  /** The sound that is kept and can be asked for with `pcm`. */
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
    this.store = [];
    this.storeBytes = 0;
  }

  private known(start: number): boolean {
    const near = (a: number, b: number) => Math.abs(a - b) < 0.05;
    return this.store.some((s) => near(s.start, start)) || this.queue.some((p) => near(p.start, start));
  }

  /** How far a piece starting at `start` is from the picture: what is behind it counts as farther, since the aligner is working forwards. */
  private distance(start: number, playhead: number): number {
    return start < playhead ? (playhead - start) * 4 : start - playhead;
  }

  /** Over the limits: the pieces farthest from the picture go. */
  private trim(): void {
    const playhead = this.options.playhead();
    const distance = (start: number) => this.distance(start, playhead);
    const maxQueue = this.options.maxQueueBytes ?? MAX_QUEUE_BYTES;
    while (this.queueBytes > maxQueue && this.queue.length > 1) {
      let worst = 0;
      this.queue.forEach((piece, i) => {
        if (distance(piece.start) > distance((this.queue[worst] as Piece).start)) worst = i;
      });
      const [gone] = this.queue.splice(worst, 1) as [Piece];
      this.queueBytes -= gone.data.length + gone.init.length;
    }
    const maxStore = this.options.maxPcmBytes ?? MAX_PCM_BYTES;
    while (this.storeBytes > maxStore && this.store.length > 1) {
      let worst = 0;
      this.store.forEach((piece, i) => {
        if (distance(piece.start) > distance((this.store[worst] as Stored).start)) worst = i;
      });
      const [gone] = this.store.splice(worst, 1) as [Stored];
      this.storeBytes -= gone.samples.byteLength;
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

  private async pump(): Promise<void> {
    if (this.working) return;
    this.working = true;
    const generation = this.generation;
    try {
      while (this.queue.length > 0 && !this.paused && generation === this.generation) {
        const piece = this.takeNearest();
        this.queueBytes -= piece.data.length + piece.init.length;
        let pcm: Float32Array;
        try {
          const bytes = new Uint8Array(piece.init.length + piece.data.length);
          bytes.set(piece.init, 0);
          bytes.set(piece.data, piece.init.length);
          pcm = await this.options.decode(bytes);
        } catch {
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
        const end = piece.start + pcm.length / SAMPLE_RATE;
        this.store.push({ start: piece.start, end, samples });
        this.store.sort((a, b) => a.start - b.start);
        this.storeBytes += samples.byteLength;
        this.trim();
        await this.options.sink(piece.start, pcm);
      }
    } finally {
      this.working = false;
    }
    // (A piece that came in while the last one was being handed on, or after a reset.)
    if (this.queue.length > 0 && !this.paused) void this.pump();
  }
}
