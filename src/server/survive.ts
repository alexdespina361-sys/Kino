import { inspect } from "node:util";

/** What `keepRunning` needs of a logger: the app's (`app.log`) is one. */
export interface FailureLog {
  error(fields: object, message: string): void;
  fatal(fields: object, message: string): void;
}

/** What `keepRunning` needs of the process: two events and the way out. (A test gives it an emitter of its own.) */
export interface Survivable {
  on(event: "unhandledRejection", listener: (reason: unknown) => void): unknown;
  on(event: "uncaughtException", listener: (error: Error) => void): unknown;
  exit(code: number): unknown;
}

/** What went wrong, as a log keeps it: an error's message and stack; anything else that was thrown or rejected with, as it prints. */
function whatWentWrong(thing: unknown): { message: string; stack?: string | undefined } {
  if (thing instanceof Error) return { message: thing.message, stack: thing.stack };
  return { message: typeof thing === "string" ? thing : inspect(thing) };
}

/**
 * Since Node 15 a promise that fails with nobody waiting for it ends the whole server, and so one forgotten `.catch` anywhere (a fetch that was started and
 * not looked at again) takes every screen's pairing and every party down with it. This logs such a failure, with its message and stack, and carries on: what
 * was started and failed is gone, and the rest of the server was not touched by it. An error that nothing catches is another thing: nobody knows what state
 * the server was left in, so that is logged as fatal and the server stops with exit code 1, as it would have, and the host starts it again.
 *
 * Nothing is registered until this is called (once, by `index.ts`, with the app's logger): not when the module is imported, and not by `buildApp`.
 */
export function keepRunning(log: FailureLog, target: Survivable = process): void {
  target.on("unhandledRejection", (reason) => {
    log.error(whatWentWrong(reason), "A promise failed and nothing was waiting for it. The server carries on.");
  });
  target.on("uncaughtException", (error) => {
    try {
      log.fatal(whatWentWrong(error), "Nothing caught this error, so the server stops (the host starts it again).");
    } finally {
      target.exit(1);
    }
  });
}
