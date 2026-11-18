import { CHILD_PIN_LENGTH } from "../../shared";
import { t } from "../i18n";
import { ApiError } from "./api";

export { CHILD_PIN_LENGTH };

export type PinAnswer = { ok: true } | { ok: false; why: "wrong" | "wait" | "offline" | "google" | "failed"; seconds?: number };

export function pinAnswer(error: unknown): PinAnswer & { ok: false } {
  if (!(error instanceof ApiError)) return { ok: false, why: "failed" };
  if (error.status === 0) return { ok: false, why: "offline" };
  if (error.status === 429) return { ok: false, why: "wait", ...(error.retryAfter ? { seconds: error.retryAfter } : {}) };
  if (error.code === "wrong_pin" || error.code === "invalid_credentials") return { ok: false, why: "wrong" };
  if (error.code === "reauth_required") return { ok: false, why: "google" };
  return { ok: false, why: "failed" };
}

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

export const pinDigits = (typed: string): string => typed.replace(/\D/g, "").slice(0, CHILD_PIN_LENGTH);
