import { mergeRanges, SAMPLE_RATE, type Range } from "./signals";
import type { Piece } from "./tap";

const MAX_PCM_BYTES = 24 * 1024 * 1024;
const MAX_QUEUE_BYTES = 16 * 1024 * 1024;
export const AHEAD_S = 120;
const GAP = 0.1;
const HOLE = 0.5;

interface Stored {
  start: number;
  end: number;
  samples: Int16Array;
}

export interface FeedOptions {
  decode(bytes: Uint8Array): Promise<Float32Array>;
  sink(time: number, pcm: Float32Array): Promise<void> | void;
  playhead(): number;
  unreadable(): void;
  ahead?(): number;
  maxQueueBytes?: number;
  maxPcmBytes?: number;
}

export class AudioFeed {
  private queue: Piece[] = [];
  private queueBytes = 0;
  private waiting: Stored[] = [];
  private store: Stored[] = [];
  private pcmBytes = 0;
  private decoding = false;
  private sinking = false;
  private failures = 0;
  private decodedAny = false;
  private generation = 0;
  private paused = false;
  readonly counts = { pushed: 0, droppedPaused: 0, dropped: 0, droppedDecoded: 0, failed: 0 };

  constructor(private readonly options: FeedOptions) {}

  push(piece: Piece): void {
    if (this.known(piece.start)) return;
    this.counts.pushed++;
    this.queue.push(piece);
    this.queueBytes += piece.data.length + piece.init.length;
    this.trimQueue();
    void this.decodeAll();
  }

  pause(on: boolean): void {
    if (this.paused === on) return;
    this.paused = on;
    if (!on) {
      void this.decodeAll();
      void this.sinkAll();
    }
  }

  advance(): void {
    if (!this.paused) void this.sinkAll();
  }

  async idle(): Promise<void> {
    while (this.decoding || this.sinking || (!this.paused && (this.queue.length > 0 || this.nextToSink() >= 0))) await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }

  ranges(): Range[] {
    const out: Range[] = [];
    for (const { from, to } of mergeRanges(this.store.map((s) => ({ from: s.start, to: s.end + GAP })))) {
      const last = out[out.length - 1];
      if (last && from <= last.to - GAP + HOLE) last.to = Math.max(last.to, to);
      else out.push({ from, to });
    }
    return out;
  }

  pcm(from: number, to: number): Float32Array | undefined {
    const length = Math.round((to - from) * SAMPLE_RATE);
    const out = new Float32Array(length);
    let reached = from;
    for (const piece of this.store) {
      if (piece.end <= from) continue;
      if (piece.start >= to) break;
      if (piece.start > reached + HOLE) return undefined;
      const first = Math.round((Math.max(piece.start, from) - piece.start) * SAMPLE_RATE);
      const into = Math.round((Math.max(piece.start, from) - from) * SAMPLE_RATE);
      const count = Math.min(piece.samples.length - first, length - into);
      for (let i = 0; i < count; i++) out[into + i] = (piece.samples[first + i] as number) / 32768;
      reached = Math.max(reached, piece.end);
      if (reached >= to - 0.05) return out;
    }
    return reached >= to - GAP ? out : undefined;
  }

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

  private distance(start: number, playhead: number): number {
    return start < playhead ? (playhead - start) * 4 : start - playhead;
  }

  private maxQueue(): number {
    return this.options.maxQueueBytes ?? MAX_QUEUE_BYTES;
  }

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

  private takeNearest(): Piece {
    const playhead = this.options.playhead();
    let best = 0;
    for (let i = 1; i < this.queue.length; i++) {
      if (this.distance((this.queue[i] as Piece).start, playhead) < this.distance((this.queue[best] as Piece).start, playhead)) best = i;
    }
    const [piece] = this.queue.splice(best, 1) as [Piece];
    return piece;
  }

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
    if (this.decodeWanted()) void this.decodeAll();
  }

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
    if (!this.paused && this.nextToSink() >= 0) void this.sinkAll();
  }
}
