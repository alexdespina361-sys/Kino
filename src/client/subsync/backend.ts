import type { SyncCore } from "./core";
import type { Cue } from "./cues";
import type { Word } from "./signals";
import type { Outcome } from "./solve";

export interface Score {
  share: number;
  words: number;
  seconds: number;
}

/**
 * The aligner as the page uses it. On a device it runs in a worker (the voice detector and the solves are work that must not stop the
 * picture); in tests it runs in the same thread. Calls are answered in the order they were made.
 */
export interface Backend {
  /** Sound for the voice detector; resolves with the milliseconds the work took. */
  addAudio(time: number, pcm: Float32Array): Promise<number>;
  addWords(words: Word[], from: number, to: number): Promise<void>;
  setTrack(key: string, cues: Cue[], useWords: boolean): Promise<void>;
  dropTrack(key: string): Promise<void>;
  solve(key: string, end: number): Promise<Outcome | undefined>;
  score(cues: Cue[], latest?: boolean): Promise<Score>;
  reset(): Promise<void>;
  close(): void;
}

export class DirectBackend implements Backend {
  constructor(private readonly core: SyncCore) {}

  async addAudio(time: number, pcm: Float32Array): Promise<number> {
    const started = performance.now();
    this.core.addAudio(time, pcm);
    return performance.now() - started;
  }
  async addWords(words: Word[], from: number, to: number): Promise<void> {
    this.core.addWords(words, from, to);
  }
  async setTrack(key: string, cues: Cue[], useWords: boolean): Promise<void> {
    this.core.setTrack(key, cues, useWords);
  }
  async dropTrack(key: string): Promise<void> {
    this.core.dropTrack(key);
  }
  async solve(key: string, end: number): Promise<Outcome | undefined> {
    return this.core.solve(key, end);
  }
  async score(cues: Cue[], latest = false): Promise<Score> {
    return this.core.score(cues, latest);
  }
  async reset(): Promise<void> {
    this.core.reset();
  }
  close(): void {}
}

/** The request a worker is sent, and what it answers with. */
export interface WorkerRequest {
  id: number;
  op: "init" | "audio" | "words" | "track" | "drop" | "solve" | "score" | "reset";
  args: Record<string, unknown>;
}
export interface WorkerReply {
  id: number;
  value?: unknown;
  error?: string;
}

/** The aligner in a worker (see `subsync.worker.ts`). */
export class WorkerBackend implements Backend {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();

  private constructor(private readonly worker: Worker) {
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const waiting = this.pending.get(event.data.id);
      this.pending.delete(event.data.id);
      if (event.data.error !== undefined) waiting?.reject(new Error(event.data.error));
      else waiting?.resolve(event.data.value);
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || "The aligner's worker failed");
      this.pending.forEach((waiting) => waiting.reject(error));
      this.pending.clear();
    };
  }

  /** Starts the worker and has it load the voice detector's weights. */
  static async start(weightsUrl: string): Promise<WorkerBackend> {
    const backend = new WorkerBackend(new Worker(new URL("./subsync.worker.ts", import.meta.url), { type: "module" }));
    try {
      await backend.call("init", { weightsUrl });
    } catch (error) {
      backend.close();
      throw error;
    }
    return backend;
  }

  private call<T>(op: WorkerRequest["op"], args: Record<string, unknown> = {}, transfer: Transferable[] = []): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.worker.postMessage({ id, op, args } satisfies WorkerRequest, transfer);
    });
  }

  addAudio(time: number, pcm: Float32Array): Promise<number> {
    return this.call("audio", { time, pcm }, [pcm.buffer]);
  }
  addWords(words: Word[], from: number, to: number): Promise<void> {
    return this.call("words", { words, from, to });
  }
  setTrack(key: string, cues: Cue[], useWords: boolean): Promise<void> {
    return this.call("track", { key, cues, useWords });
  }
  dropTrack(key: string): Promise<void> {
    return this.call("drop", { key });
  }
  solve(key: string, end: number): Promise<Outcome | undefined> {
    return this.call("solve", { key, end });
  }
  score(cues: Cue[], latest = false): Promise<Score> {
    return this.call("score", { cues, latest });
  }
  reset(): Promise<void> {
    return this.call("reset");
  }
  close(): void {
    this.worker.terminate();
    const error = new Error("The aligner was closed");
    this.pending.forEach((waiting) => waiting.reject(error));
    this.pending.clear();
  }
}
