import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { keepRunning, type FailureLog } from "./survive";

class Exited extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

class FakeProcess extends EventEmitter {
  readonly exits: number[] = [];
  exit(code: number): never {
    this.exits.push(code);
    throw new Exited(code);
  }
  crash(error: Error): void {
    try {
      this.emit("uncaughtException", error, "uncaughtException");
    } catch (thrown) {
      if (!(thrown instanceof Exited)) throw thrown;
    }
  }
}

function recorded() {
  const lines: Array<{ level: "error" | "fatal"; fields: object; message: string }> = [];
  const log: FailureLog = {
    error: (fields, message) => void lines.push({ level: "error", fields, message }),
    fatal: (fields, message) => void lines.push({ level: "fatal", fields, message }),
  };
  return { log, lines };
}

describe("keepRunning", () => {
  it("registers nothing until it is called, not when the module is imported", async () => {
    vi.resetModules();
    const before = [process.listenerCount("unhandledRejection"), process.listenerCount("uncaughtException")];
    await import("./survive");
    expect([process.listenerCount("unhandledRejection"), process.listenerCount("uncaughtException")]).toEqual(before);

    const target = new FakeProcess();
    keepRunning(recorded().log, target);
    expect([target.listenerCount("unhandledRejection"), target.listenerCount("uncaughtException")]).toEqual([1, 1]);
  });

  it("registers on the real process when it is given no other", () => {
    const rejections = process.listeners("unhandledRejection");
    const uncaught = process.listeners("uncaughtException");
    keepRunning(recorded().log);
    try {
      expect(process.listenerCount("unhandledRejection")).toBe(rejections.length + 1);
      expect(process.listenerCount("uncaughtException")).toBe(uncaught.length + 1);
    } finally {
      for (const listener of process.listeners("unhandledRejection")) if (!rejections.includes(listener)) process.off("unhandledRejection", listener);
      for (const listener of process.listeners("uncaughtException")) if (!uncaught.includes(listener)) process.off("uncaughtException", listener);
    }
    expect([process.listenerCount("unhandledRejection"), process.listenerCount("uncaughtException")]).toEqual([rejections.length, uncaught.length]);
  });

  it("logs a promise that failed with nobody waiting for it, with its message and stack, and carries on", () => {
    const target = new FakeProcess();
    const { log, lines } = recorded();
    keepRunning(log, target);
    const error = new Error("the fetch fell over");
    target.emit("unhandledRejection", error, Promise.resolve());
    target.emit("unhandledRejection", new TypeError("and again"), Promise.resolve());
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ level: "error", fields: { message: "the fetch fell over", stack: error.stack }, message: expect.stringContaining("carries on") });
    expect(lines[0]!.fields).toHaveProperty("stack", expect.stringContaining("survive.test.ts"));
    expect(lines[1]!.fields).toMatchObject({ message: "and again" });
    expect(target.exits).toEqual([]);
  });

  it.each([
    ["a text", "it just said so", "it just said so"],
    ["nothing at all", undefined, "undefined"],
    ["an object", { code: "ECONNRESET", retry: false }, "{ code: 'ECONNRESET', retry: false }"],
  ])("logs a promise that was rejected with %s as it prints, and carries on", (_name, reason, printed) => {
    const target = new FakeProcess();
    const { log, lines } = recorded();
    keepRunning(log, target);
    target.emit("unhandledRejection", reason, Promise.resolve());
    expect(lines).toEqual([{ level: "error", fields: { message: printed }, message: expect.any(String) }]);
    expect(target.exits).toEqual([]);
  });

  it("logs an error that nothing caught as fatal, with its message and stack, and only then stops with exit code 1", () => {
    const target = new FakeProcess();
    const { log, lines } = recorded();
    keepRunning(log, target);
    const error = new RangeError("nobody knows what state this left");
    target.crash(error);
    expect(lines).toEqual([{ level: "fatal", fields: { message: "nobody knows what state this left", stack: error.stack }, message: expect.stringContaining("stops") }]);
    expect(target.exits).toEqual([1]);
  });

  it("stops all the same when the logger itself fails", () => {
    const target = new FakeProcess();
    keepRunning(
      {
        error: () => {},
        fatal: () => {
          throw new Error("the log is gone");
        },
      },
      target,
    );
    target.crash(new Error("first"));
    expect(target.exits).toEqual([1]);
  });

  it("does not stop for a rejection, and stops once for an error nothing caught", () => {
    const target = new FakeProcess();
    const { log, lines } = recorded();
    keepRunning(log, target);
    target.emit("unhandledRejection", new Error("one"), Promise.resolve());
    expect(target.exits).toEqual([]);
    target.crash(new Error("two"));
    expect(lines.map((line) => line.level)).toEqual(["error", "fatal"]);
    expect(target.exits).toEqual([1]);
  });
});
