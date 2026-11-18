import { GOOGLE_OUTCOMES, type DeviceKind, type GoogleOutcome, type Me } from "../../shared";
import { t } from "../i18n";

export type GooglePurpose = "signin" | "link" | "delete" | "pin";

export function googleStartUrl(device: DeviceKind, purpose: GooglePurpose, pathname: string): string {
  const next = pathname.replace(/\/+$/, "") === "/tv" ? "/tv" : "/";
  const mode = purpose === "delete" || purpose === "pin" ? "reauth" : purpose;
  return `/api/auth/google/start?${new URLSearchParams({ device, next, ...(mode === "signin" ? {} : { mode }) }).toString()}`;
}

export function takeGoogleOutcome(): GoogleOutcome | null {
  if (typeof location === "undefined") return null;
  const url = new URL(location.href);
  const said = url.searchParams.get("google");
  if (said === null) return null;
  url.searchParams.delete("google");
  try {
    history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
  }
  return GOOGLE_OUTCOMES.find((outcome) => outcome === said) ?? null;
}

const AFTER_GOOGLE_MS = 10 * 60_000;

function afterGoogle(key: string) {
  return {
    ask(): void {
      try {
        sessionStorage.setItem(key, String(Date.now()));
      } catch {
      }
    },
    take(): boolean {
      try {
        const at = Number(sessionStorage.getItem(key));
        sessionStorage.removeItem(key);
        return Date.now() - at < AFTER_GOOGLE_MS;
      } catch {
        return false;
      }
    },
  };
}

export const deleteAfterGoogle = afterGoogle("kino.google.delete");
export const pinAfterGoogle = afterGoogle("kino.google.pin");

export const signedInLine = (me: Me): string => (me.account.googleOnly ? t("account.signedInGoogle") : t("account.signedInAs", { email: me.account.email }));
