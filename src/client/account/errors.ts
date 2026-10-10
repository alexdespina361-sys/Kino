import { hasKey, t } from "../i18n";
import { ApiError } from "./api";

/** What to tell somebody when the server said no (or could not be reached), in their language. */
export function describeError(error: unknown): string {
  const key = `error.${error instanceof ApiError ? error.code : "generic"}`;
  return hasKey(key) ? t(key) : t("error.generic");
}
