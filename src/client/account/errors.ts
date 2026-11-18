import { hasKey, t } from "../i18n";
import { ApiError } from "./api";

export function describeError(error: unknown): string {
  const key = `error.${error instanceof ApiError ? error.code : "generic"}`;
  return hasKey(key) ? t(key) : t("error.generic");
}

export function describePasswordError(error: unknown): string {
  return error instanceof ApiError && error.code === "invalid_credentials" ? t("error.wrong_password") : describeError(error);
}
