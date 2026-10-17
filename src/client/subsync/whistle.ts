import { assetUrl, WHISTLE_MODEL } from "./assets";
import type { Word } from "./signals";

/** The speech recogniser (Whistle) as the aligner uses it. */
export interface Recogniser {
  /** The words heard in up to 30 s of 16 kHz sound; their times are counted from its start. */
  hear(pcm: Float32Array): Promise<Word[]>;
  close(): void;
}

/** The recogniser cannot run here (nothing was downloaded for it, or it failed to start). */
export class Unsupported extends Error {}

/** What is said to, and answered by, the worker of the recogniser (cactus-needle's: see public/subtitle-sync/1/README.md). */
type Reply =
  | { type: "progress" }
  | { type: "ready" }
  | { type: "result"; id: number; value: { words?: Array<{ word: string; start: number; end: number; probability?: number }> } }
  | { type: "error"; id?: number; message?: string };

/** The parts of a worker this uses, so a stand-in can be used to test it. */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: { data: Reply }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
}

export interface WhistleOptions {
  /** The model takes a while to arrive on a slow link; the first window can be slow to start on a small device. */
  startTimeoutMs?: number;
  hearTimeoutMs?: number;
  createWorker?: (url: string) => WorkerLike;
  /** The bytes of the engine, to be sure this browser can run it before the model (17 MB) is fetched. */
  validateEngine?: (wasmUrl: string) => Promise<boolean>;
}

const engineRuns = async (wasmUrl: string): Promise<boolean> => {
  const response = await fetch(wasmUrl);
  return response.ok && WebAssembly.validate(await response.arrayBuffer());
};

/**
 * Starts the recogniser in its worker: the model is fetched (and kept in the browser's cache storage by the worker, checked against
 * its checksum), then it listens window by window. Nothing is fetched on a browser that cannot run it.
 */
export async function startWhistle(options: WhistleOptions = {}): Promise<Recogniser> {
  if ((!options.createWorker && typeof Worker === "undefined") || typeof WebAssembly === "undefined" || !globalThis.crypto?.subtle) throw new Unsupported("No WebAssembly, workers or crypto here");
  const wasmUrl = assetUrl("needle.wasm");
  if (!(await (options.validateEngine ?? engineRuns)(wasmUrl))) throw new Unsupported("This browser cannot run the engine");

  // (The worker is plain script, so it needs no module worker.)
  const worker = options.createWorker ? options.createWorker(assetUrl("whistle-worker.js")) : (new Worker(assetUrl("whistle-worker.js")) as unknown as WorkerLike);
  const pending = new Map<number, { resolve(words: Word[]): void; reject(error: Error): void }>();
  let nextId = 0;
  let failure: Error | undefined;
  let started: { resolve(): void; reject(error: Error): void } | undefined;
  const fail = (error: Error) => {
    failure ??= error;
    started?.reject(error);
    pending.forEach((waiting) => waiting.reject(error));
    pending.clear();
  };
  worker.onmessage = ({ data }) => {
    if (data.type === "ready") started?.resolve();
    else if (data.type === "result") {
      const waiting = pending.get(data.id);
      pending.delete(data.id);
      waiting?.resolve((data.value.words ?? []).map((w) => ({ word: w.word, start: w.start, end: w.end, ...(w.probability !== undefined ? { probability: w.probability } : {}) })));
    } else if (data.type === "error") {
      const error = new Error(data.message ?? "The recogniser failed");
      if (data.id !== undefined) {
        pending.get(data.id)?.reject(error);
        pending.delete(data.id);
      } else fail(error);
    }
  };
  worker.onerror = (event) => fail(new Error(event.message || "The recogniser's worker failed"));

  const within = <T>(promise: Promise<T>, ms: number, what: string): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${what} took too long`)), ms);
      promise.then(
        (value) => (clearTimeout(timer), resolve(value)),
        (error: Error) => (clearTimeout(timer), reject(error)),
      );
    });

  try {
    await within(
      new Promise<void>((resolve, reject) => {
        started = { resolve, reject };
        worker.postMessage({
          type: "init",
          config: {
            system: "",
            toolsJson: "[]",
            stateless: false,
            bufferSize: 262144,
            modelKind: "whistle",
            model: assetUrl(WHISTLE_MODEL.file),
            modelSha256: WHISTLE_MODEL.sha256,
            modelSize: WHISTLE_MODEL.size,
            wasmUrl,
            cache: true,
            offline: false,
          },
        });
      }),
      options.startTimeoutMs ?? 300_000,
      "Starting the recogniser",
    );
  } catch (error) {
    worker.terminate();
    throw error;
  }

  return {
    hear(pcm) {
      if (failure) return Promise.reject(failure);
      return within(
        new Promise<Word[]>((resolve, reject) => {
          const id = nextId++;
          pending.set(id, { resolve, reject });
          worker.postMessage({ id, method: "transcribe", audio: pcm, settings: { language: "en", wordTimestamps: true } }, [pcm.buffer]);
        }),
        options.hearTimeoutMs ?? 90_000,
        "Listening",
      ).catch((error: Error) => {
        // (A window that never comes back is a recogniser that has hung: no more is asked of it.)
        if (/took too long/.test(error.message)) fail(error);
        throw error;
      });
    },
    close() {
      fail(new Error("The recogniser was closed"));
      worker.terminate();
    },
  };
}
