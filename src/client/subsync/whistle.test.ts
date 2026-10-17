import { describe, expect, it, vi } from "vitest";
import { startWhistle, Unsupported, type WorkerLike } from "./whistle";

/** A stand-in for the recogniser's worker: what it is sent is kept, and the test answers as the real one would. */
class FakeWorker implements WorkerLike {
  sent: Array<{ message: any; transfer: Transferable[] | undefined }> = [];
  terminated = false;
  onmessage: WorkerLike["onmessage"] = null;
  onerror: WorkerLike["onerror"] = null;
  postMessage(message: unknown, transfer?: Transferable[]) {
    this.sent.push({ message, transfer });
  }
  terminate() {
    this.terminated = true;
  }
  say(data: any) {
    this.onmessage?.({ data });
  }
  get requests() {
    return this.sent.map((s) => s.message).filter((m) => m.method === "transcribe");
  }
}

const start = async (extra: Parameters<typeof startWhistle>[0] = {}) => {
  const worker = new FakeWorker();
  const made = startWhistle({ createWorker: () => worker, validateEngine: async () => true, ...extra });
  made.catch(() => {}); // (a start that fails while the test is still looking is not an unhandled one)
  await vi.waitFor(() => expect(worker.sent.length).toBeGreaterThan(0));
  return { worker, made };
};

describe("the recogniser's worker", () => {
  it("asks for the model by its checksum, and is ready when the worker says so", async () => {
    const { worker, made } = await start();
    const init = worker.sent[0]!.message;
    expect(init.type).toBe("init");
    expect(init.config.modelKind).toBe("whistle");
    expect(init.config.modelSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(init.config.model).toMatch(/\/subtitle-sync\/1\/whistle\.cact$/);
    expect(init.config.wasmUrl).toMatch(/\/subtitle-sync\/1\/needle\.wasm$/);
    worker.say({ type: "progress", progress: { percentage: 40 } });
    worker.say({ type: "ready" });
    const recogniser = await made;
    recogniser.close();
    expect(worker.terminated).toBe(true);
  });

  it("hands the sound over (not copied) and gives the words back as the aligner counts them", async () => {
    const { worker, made } = await start();
    worker.say({ type: "ready" });
    const recogniser = await made;
    const pcm = new Float32Array(16000);
    const heard = recogniser.hear(pcm);
    const [request] = worker.requests;
    expect(request.settings).toEqual({ language: "en", wordTimestamps: true });
    expect(worker.sent.at(-1)!.transfer).toHaveLength(1);
    worker.say({
      type: "result",
      id: request.id,
      value: { text: "hello there", words: [{ word: "hello", start: 0.2, end: 0.5, probability: 0.9 }, { word: "there", start: 0.6, end: 0.9 }] },
    });
    expect(await heard).toEqual([
      { word: "hello", start: 0.2, end: 0.5, probability: 0.9 },
      { word: "there", start: 0.6, end: 0.9 },
    ]);
    // (A window with nothing said has no words at all.)
    const quiet = recogniser.hear(new Float32Array(100));
    worker.say({ type: "result", id: worker.requests[1].id, value: { text: "" } });
    expect(await quiet).toEqual([]);
    recogniser.close();
  });

  it("keeps the windows apart: one that fails does not take the others with it", async () => {
    const { worker, made } = await start();
    worker.say({ type: "ready" });
    const recogniser = await made;
    const first = recogniser.hear(new Float32Array(10));
    const second = recogniser.hear(new Float32Array(10));
    const [a, b] = worker.requests;
    worker.say({ type: "error", id: a.id, code: "INVALID_RESPONSE", message: "odd" });
    worker.say({ type: "result", id: b.id, value: { text: "ok", words: [{ word: "ok", start: 0, end: 0.1 }] } });
    await expect(first).rejects.toThrow("odd");
    expect(await second).toHaveLength(1);
    recogniser.close();
  });

  it("gives up when the worker cannot start (and shuts it down)", async () => {
    const { worker, made } = await start();
    worker.say({ type: "error", code: "ENGINE_ERROR", message: "no memory" });
    await expect(made).rejects.toThrow("no memory");
    expect(worker.terminated).toBe(true);
  });

  it("treats a worker that crashes later as a recogniser that is gone", async () => {
    const { worker, made } = await start();
    worker.say({ type: "ready" });
    const recogniser = await made;
    const pending = recogniser.hear(new Float32Array(10));
    worker.onerror?.({ message: "boom" });
    await expect(pending).rejects.toThrow("boom");
    await expect(recogniser.hear(new Float32Array(10))).rejects.toThrow("boom");
    recogniser.close();
  });

  it("stops asking a recogniser that has hung", async () => {
    const { worker, made } = await start({ hearTimeoutMs: 20 });
    worker.say({ type: "ready" });
    const recogniser = await made;
    await expect(recogniser.hear(new Float32Array(10))).rejects.toThrow("took too long");
    await expect(recogniser.hear(new Float32Array(10))).rejects.toThrow("took too long");
    expect(worker.requests).toHaveLength(1);
    recogniser.close();
  });

  it("does not start a worker, or fetch the model, where the engine cannot run", async () => {
    const create = vi.fn();
    await expect(startWhistle({ createWorker: create, validateEngine: async () => false })).rejects.toBeInstanceOf(Unsupported);
    expect(create).not.toHaveBeenCalled();
  });

  it("gives up when it takes too long to start", async () => {
    const { worker, made } = await start({ startTimeoutMs: 20 });
    await expect(made).rejects.toThrow("took too long");
    expect(worker.terminated).toBe(true);
  });
});
