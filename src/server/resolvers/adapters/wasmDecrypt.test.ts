import type { Worker } from "node:worker_threads";
import { describe, expect, it, vi } from "vitest";
import { MAX_WASM_BYTES, MAX_WASM_PAGES, declaredMemoryPages, decryptInThread } from "./wasmDecrypt";
import { END, i32Const, memory, sealed, wasmModule } from "./wasmModule.fixture";

const DECRYPT_FOR_EVER = [0x03, 0x40, 0x0c, 0, END, ...i32Const(0), END]; // loop { br 0 }
const DECRYPT_TRAPS = [0x00, END]; // unreachable
const DECRYPT_BIG = [...i32Const(2_000_000), END]; // "I wrote two million bytes"
const decryptOf = (length: number) => [...i32Const(length), END]; // "I wrote `length` bytes"
const MOST_OUT = 256 * 1024; // what a run may hand back

describe("decryptInThread", () => {
  it("runs a module as the player does and hands back the text", async () => {
    const text = await decryptInThread(wasmModule(), sealed("https://a.example/1.m3u8\nhttps://b.example/2.m3u8\n"));
    expect(text).toBe("https://a.example/1.m3u8\nhttps://b.example/2.m3u8\n");
  });

  it("ends a module that never finishes, in the time it was given, while the server goes on", async () => {
    let ticks = 0;
    const timer = setInterval(() => ticks++, 10);
    const started = Date.now();
    try {
      await expect(decryptInThread(wasmModule({ decrypt: DECRYPT_FOR_EVER }), sealed("x"), { runMs: 400 })).rejects.toThrow("took too long");
    } finally {
      clearInterval(timer);
    }
    expect(Date.now() - started).toBeLessThan(5000);
    expect(ticks).toBeGreaterThan(10); // (the thread of the server was not held up by it)
  });

  it("gives a run five seconds when it is given no other time", async () => {
    const threads: Worker[] = [];
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let outcome = "";
      const run = decryptInThread(wasmModule({ decrypt: DECRYPT_FOR_EVER }), sealed("x"), { started: (thread) => threads.push(thread) }).then(
        () => (outcome = "answered"),
        (error: Error) => (outcome = error.message),
      );
      await vi.advanceTimersByTimeAsync(4_900);
      expect(outcome).toBe("");
      await vi.advanceTimersByTimeAsync(200);
      await run;
      expect(outcome).toBe("took too long");
    } finally {
      vi.useRealTimers();
      await Promise.all(threads.map((thread) => thread.terminate()));
    }
  });

  it("ends the thread of a module that took too long, and that of one that answered", async () => {
    const threads: Worker[] = [];
    const started = (thread: Worker) => threads.push(thread);
    try {
      await expect(decryptInThread(wasmModule({ decrypt: DECRYPT_FOR_EVER }), sealed("x"), { runMs: 200, started })).rejects.toThrow("took too long");
      await expect(decryptInThread(wasmModule(), sealed("done"), { started })).resolves.toBe("done");
      expect(threads).toHaveLength(2);
      await vi.waitFor(() => expect(threads.map((thread) => thread.threadId)).toEqual([-1, -1]), { timeout: 3000 });
    } finally {
      await Promise.all(threads.map((thread) => thread.terminate())); // (so that a thread that was not ended cannot go on spinning after the test)
    }
  });

  it("a thread that is ended from outside, or that fails on its own, is an error for the caller and not a crash of the server", async () => {
    const forEver = wasmModule({ decrypt: DECRYPT_FOR_EVER });
    await expect(decryptInThread(forEver, sealed("x"), { started: (thread) => void thread.terminate() })).rejects.toThrow("ended without an answer");
    await expect(decryptInThread(forEver, sealed("x"), { started: (thread) => void setImmediate(() => thread.emit("error", new Error("boom"))) })).rejects.toThrow("boom");
  });

  it("refuses a module that is too big, or starts with more memory than it is given", async () => {
    await expect(decryptInThread(new Uint8Array(MAX_WASM_BYTES + 1), sealed("x"))).rejects.toThrow("too big");
    await expect(decryptInThread(new Uint8Array(MAX_WASM_BYTES), sealed("x"))).rejects.toThrow("not a module"); // (as long as it may be is allowed: this one is only not a module)
    await expect(decryptInThread(wasmModule({ pages: MAX_WASM_PAGES + 500 }), sealed("x"))).rejects.toThrow("too much memory");
    await expect(decryptInThread(wasmModule({ pages: MAX_WASM_PAGES }), sealed("ok"))).resolves.toBe("ok"); // (the most it may have is allowed)
  });

  it("refuses what is not a module, and a module that fails or that claims to have written more than it may", async () => {
    await expect(decryptInThread(Buffer.from("<html>not a module</html>"), sealed("x"))).rejects.toThrow();
    await expect(decryptInThread(wasmModule({ decrypt: DECRYPT_TRAPS }), sealed("x"))).rejects.toThrow();
    await expect(decryptInThread(wasmModule({ decrypt: DECRYPT_BIG }), sealed("x"))).rejects.toThrow("bad length");
  });

  it("hands back as much as it may and no more, and a negative length is no length", async () => {
    const room = { pages: 5 }; // (320 KiB: that much text fits in the memory)
    expect(await decryptInThread(wasmModule({ ...room, decrypt: decryptOf(MOST_OUT) }), sealed("x"))).toHaveLength(MOST_OUT);
    await expect(decryptInThread(wasmModule({ ...room, decrypt: decryptOf(MOST_OUT + 1) }), sealed("x"))).rejects.toThrow("bad length");
    await expect(decryptInThread(wasmModule({ decrypt: decryptOf(-1) }), sealed("x"))).rejects.toThrow("bad length");
  });

  it("says what went wrong in the module, not only that something did", async () => {
    await expect(decryptInThread(wasmModule({ decrypt: DECRYPT_TRAPS }), sealed("x"))).rejects.toThrow(/unreachable/i);
  });

  it("runs only a few at a time, and takes the next once those are done", async () => {
    const forever = () => decryptInThread(wasmModule({ decrypt: DECRYPT_FOR_EVER }), sealed("x"), { runMs: 500 });
    const running = [forever(), forever(), forever(), forever()].map((run) => run.then(() => "ended", (error: Error) => error.message));
    await expect(decryptInThread(wasmModule(), sealed("one more"))).rejects.toThrow("too many");
    expect(await Promise.all(running)).toEqual(["took too long", "took too long", "took too long", "took too long"]);
    await expect(decryptInThread(wasmModule(), sealed("again"))).resolves.toBe("again");
  });
});

describe("declaredMemoryPages", () => {
  it("reads what the memory section starts with", () => {
    expect(declaredMemoryPages(wasmModule({ pages: 1 }))).toBe(1);
    expect(declaredMemoryPages(wasmModule({ pages: 300 }))).toBe(300); // (more than one byte of length)
    expect(declaredMemoryPages(wasmModule({ pages: 65_536 }))).toBe(65_536);
    expect(declaredMemoryPages(wasmModule({ pages: null }))).toBe(0);
  });

  it("goes by what each memory starts with (not by the most it may grow to), and by the biggest of them", () => {
    expect(declaredMemoryPages(wasmModule({ memories: [memory(2, 60_000)] }))).toBe(2);
    expect(declaredMemoryPages(wasmModule({ memories: [memory(900), memory(3, 10)] }))).toBe(900);
    expect(declaredMemoryPages(wasmModule({ memories: [memory(1, 4), memory(5000)] }))).toBe(5000);
  });

  it("refuses what is not a module or is cut off", () => {
    expect(() => declaredMemoryPages(Buffer.from("<html>"))).toThrow("not a module");
    expect(() => declaredMemoryPages(Uint8Array.from([0, 0x61, 0x73, 0x6d]))).toThrow("not a module"); // (a start and nothing after it)
    for (const at of [0, 1, 2, 3]) {
      const wrong = Uint8Array.from(wasmModule());
      wrong[at] = wrong[at]! ^ 0xff;
      expect(() => declaredMemoryPages(wrong), `byte ${at}`).toThrow("not a module");
    }
    expect(() => declaredMemoryPages(wasmModule().slice(0, 30))).toThrow();
    expect(() => declaredMemoryPages(Uint8Array.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 5, 0x80]))).toThrow("cut off");
  });
});
