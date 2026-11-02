import { Worker } from "node:worker_threads";

/** A module longer than this is not run. */
export const MAX_WASM_BYTES = 2 * 1024 * 1024;
/** A module that starts with more memory than this (64 KiB pages) is not run: 64 MiB. */
export const MAX_WASM_PAGES = 1024;
/** What a run may hand back. */
const MAX_OUTPUT_BYTES = 256 * 1024;
/** A run that takes longer than this is ended. */
const RUN_MS = 5_000;
/** Runs at one time; another asked for meanwhile is refused. */
const MAX_RUNNING = 4;
let running = 0;

/** The most memory (in pages) the module's own memory section starts with; 0 when it has none. Throws on a file that is not a module. */
export function declaredMemoryPages(wasm: Uint8Array): number {
  if (wasm.length < 8 || wasm[0] !== 0 || wasm[1] !== 0x61 || wasm[2] !== 0x73 || wasm[3] !== 0x6d) throw new Error("not a module");
  let at = 8;
  const number = (): number => {
    let value = 0;
    for (let shift = 0; ; shift += 7) {
      const byte = wasm[at++];
      if (byte === undefined || shift > 35) throw new Error("cut off");
      value += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return value;
    }
  };
  let most = 0;
  while (at < wasm.length) {
    const id = wasm[at++]!;
    const end = number() + at;
    if (id === 5) {
      for (let count = number(); count > 0; count--) {
        const flags = number();
        most = Math.max(most, number());
        if (flags & 1) number();
      }
    }
    at = end;
  }
  return most;
}

/**
 * The script of the thread a module is run in: its alloc/decrypt exports are called as the site's player calls them, and what comes out is handed back as text.
 * It runs here as a script of its own (`eval`) so that nothing but the module's own code, with no imports at all, is in it.
 */
const SCRIPT = `
const { parentPort, workerData } = require("node:worker_threads");
(async () => {
  const { instance } = await WebAssembly.instantiate(workerData.wasm, {});
  const ex = instance.exports;
  const input = workerData.input;
  const at = ex.alloc(input.length);
  new Uint8Array(ex.memory.buffer, at, input.length).set(input);
  const length = ex.decrypt(at, input.length);
  if (!(length >= 0 && length <= workerData.most)) throw new Error("bad length");
  parentPort.postMessage({ text: new TextDecoder().decode(new Uint8Array(ex.memory.buffer, at + 12, length)) });
})().catch((error) => parentPort.postMessage({ error: String(error && error.message) }));
`;

/**
 * The module (which the site's own server handed out, and so is not to be trusted with this one's time or memory) is run in a thread of its own, with a limit
 * on the time it may take, on how much it starts with and on what it may hand back, and not more than a few at once. Resolves to the text it decrypts `input` to.
 */
export async function decryptInThread(wasm: Uint8Array, input: Uint8Array, limits: { runMs?: number; started?: (thread: Worker) => void } = {}): Promise<string> {
  if (wasm.byteLength > MAX_WASM_BYTES) throw new Error("module too big");
  if (declaredMemoryPages(wasm) > MAX_WASM_PAGES) throw new Error("module wants too much memory");
  if (running >= MAX_RUNNING) throw new Error("too many runs at once");
  running++;
  try {
    return await new Promise<string>((resolve, reject) => {
      const worker = new Worker(SCRIPT, {
        eval: true,
        execArgv: [],
        workerData: { wasm, input, most: MAX_OUTPUT_BYTES },
        resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 },
      });
      limits.started?.(worker); // (for a test to look at the thread)
      // Whatever comes of it, the thread does not outlive this: it is ended at once if it is still running.
      const finish = (settle: () => void) => {
        clearTimeout(timer);
        void worker.terminate();
        settle();
      };
      const timer = setTimeout(() => finish(() => reject(new Error("took too long"))), limits.runMs ?? RUN_MS);
      worker.once("message", (message: { text?: string; error?: string }) =>
        finish(() => (message.text === undefined ? reject(new Error(message.error ?? "failed")) : resolve(message.text))),
      );
      worker.once("error", (error) => finish(() => reject(error)));
      worker.once("exit", () => finish(() => reject(new Error("ended without an answer"))));
    });
  } finally {
    running--;
  }
}
