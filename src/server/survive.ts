import { inspect } from "node:util";

export interface FailureLog {
  error(fields: object, message: string): void;
  fatal(fields: object, message: string): void;
}

export interface Survivable {
  on(event: "unhandledRejection", listener: (reason: unknown) => void): unknown;
  on(event: "uncaughtException", listener: (error: Error) => void): unknown;
  exit(code: number): unknown;
}

function whatWentWrong(thing: unknown): { message: string; stack?: string | undefined } {
  if (thing instanceof Error) return { message: thing.message, stack: thing.stack };
  return { message: typeof thing === "string" ? thing : inspect(thing) };
}

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
