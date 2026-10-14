import { hasKey, t } from "../i18n";
import { ApiError } from "./api";

/** What to tell somebody when the server said no (or could not be reached), in their language. */
export function describeError(error: unknown): string {
  const key = `error.${error instanceof ApiError ? error.code : "generic"}`;
  return hasKey(key) ? t(key) : t("error.generic");
}

/** The same for a page that asks for the password and nothing else (changing it, deleting the account): there is no user name there to blame. */
export function describePasswordError(error: unknown): string {
  return error instanceof ApiError && error.code === "invalid_credentials" ? t("error.wrong_password") : describeError(error);
}
