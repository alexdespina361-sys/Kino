import { assetUrl, WHISTLE_MODEL } from "./assets";
import type { Word } from "./signals";

export interface Recogniser {
  hear(pcm: Float32Array): Promise<Word[]>;
  close(): void;
}

export class Unsupported extends Error {}

type Reply =
  | { type: "progress" }
  | { type: "ready" }
  | { type: "result"; id: number; value: { words?: Array<{ word: string; start: number; end: number; probability?: number }> } }
  | { type: "error"; id?: number; message?: string };

export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: { data: Reply }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
}

export interface WhistleOptions {
  startTimeoutMs?: number;
  hearTimeoutMs?: number;
  createWorker?: (url: string) => WorkerLike;
  validateEngine?: (wasmUrl: string) => Promise<boolean>;
}

const engineRuns = async (wasmUrl: string): Promise<boolean> => {
  const response = await fetch(wasmUrl);
  return response.ok && WebAssembly.validate(await response.arrayBuffer());
};

export async function startWhistle(options: WhistleOptions = {}): Promise<Recogniser> {
  if ((!options.createWorker && typeof Worker === "undefined") || typeof WebAssembly === "undefined" || !globalThis.crypto?.subtle) throw new Unsupported("No WebAssembly, workers or crypto here");
  const wasmUrl = assetUrl("needle.wasm");
  if (!(await (options.validateEngine ?? engineRuns)(wasmUrl))) throw new Unsupported("This browser cannot run the engine");

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
