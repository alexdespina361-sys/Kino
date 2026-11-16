import { CHILD_PIN_LENGTH } from "../../shared";
import { t } from "../i18n";
import { ApiError } from "./api";

export { CHILD_PIN_LENGTH };

/** How a PIN (or, when it was forgotten, the password) went: right, wrong, slowed (`seconds`), no network, Google has to confirm first, or something else. */
export type PinAnswer = { ok: true } | { ok: false; why: "wrong" | "wait" | "offline" | "google" | "failed"; seconds?: number };

/** What the server's refusal of a PIN (or a password) means for the page that asked. */
export function pinAnswer(error: unknown): PinAnswer & { ok: false } {
  if (!(error instanceof ApiError)) return { ok: false, why: "failed" };
  if (error.status === 0) return { ok: false, why: "offline" }; // (no PIN can be checked without the server: the profile stays as it is)
  if (error.status === 429) return { ok: false, why: "wait", ...(error.retryAfter ? { seconds: error.retryAfter } : {}) };
  if (error.code === "wrong_pin" || error.code === "invalid_credentials") return { ok: false, why: "wrong" };
  if (error.code === "reauth_required") return { ok: false, why: "google" };
  return { ok: false, why: "failed" };
}

/** The line a page shows for a PIN that did not do it. `wrong`: what to say for a wrong one (a password that was wrong says so in its own words). */
export function pinProblem(answer: PinAnswer & { ok: false }, wrong: string = t("pin.wrong")): string {
  switch (answer.why) {
    case "wrong":
      return wrong;
    case "wait":
      return answer.seconds ? t("pin.wait", { seconds: answer.seconds }) : t("pin.waitSome");
    case "offline":
      return t("pin.offline");
    case "google":
      return t("pin.googleHelp");
    default:
      return t("pin.failed");
  }
}

/** Only the digits of what was typed, as many as a PIN has. */
export const pinDigits = (typed: string): string => typed.replace(/\D/g, "").slice(0, CHILD_PIN_LENGTH);
