import { GOOGLE_OUTCOMES, type DeviceKind, type GoogleOutcome, type Me } from "../../shared";
import { t } from "../i18n";

/**
 * What a round trip to Google is for: signing in (or up), connecting Google to the account signed in, or confirming who is here before the account is deleted, or
 * before the PIN of a child's profile is taken off (an account made with Google has no password to do that with).
 */
export type GooglePurpose = "signin" | "link" | "delete" | "pin";

/**
 * Where "Continue with Google" sends the browser: the server's start of a round trip to Google, for this kind of screen, back to this page (the TV's or the phone's).
 * Deleting, and taking off the PIN, are a confirmation (`reauth`) first; what to do when it comes back is kept for this tab (see `deleteAfterGoogle`, `pinAfterGoogle`).
 */
export function googleStartUrl(device: DeviceKind, purpose: GooglePurpose, pathname: string): string {
  const next = pathname.replace(/\/+$/, "") === "/tv" ? "/tv" : "/";
  const mode = purpose === "delete" || purpose === "pin" ? "reauth" : purpose;
  return `/api/auth/google/start?${new URLSearchParams({ device, next, ...(mode === "signin" ? {} : { mode }) }).toString()}`;
}

/** How the round trip ended, as the server wrote it in this page's address (`?google=`); it is taken out of the address, so that a reload does not say it again. A word nobody knows is nothing. */
export function takeGoogleOutcome(): GoogleOutcome | null {
  if (typeof location === "undefined") return null;
  const url = new URL(location.href);
  const said = url.searchParams.get("google");
  if (said === null) return null;
  url.searchParams.delete("google");
  try {
    history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // (a page that cannot change its address keeps the word in it: it is only said again at a reload)
  }
  return GOOGLE_OUTCOMES.find((outcome) => outcome === said) ?? null;
}

const AFTER_GOOGLE_MS = 10 * 60_000;

/** Something to do once Google says it is the person (this tab only, and only for the next ten minutes): set before going to Google, taken when the page comes back. */
function afterGoogle(key: string) {
  return {
    ask(): void {
      try {
        sessionStorage.setItem(key, String(Date.now()));
      } catch {
        // (a browser that keeps nothing: nothing is done when it comes back, and the person asks again)
      }
    },
    take(): boolean {
      try {
        const at = Number(sessionStorage.getItem(key)); // (nothing, or anything that is not a time, is 0 or NaN: long ago)
        sessionStorage.removeItem(key);
        return Date.now() - at < AFTER_GOOGLE_MS;
      } catch {
        return false;
      }
    },
  };
}

/** The account is to be deleted once Google says it is the person. */
export const deleteAfterGoogle = afterGoogle("kino.google.delete");
/** The PIN of a child's profile is to be taken off once Google says it is the person (it was forgotten, on an account made with Google). */
export const pinAfterGoogle = afterGoogle("kino.google.pin");

/** "Signed in as robert"; for an account made with Google, whose name nobody chose, "Signed in with Google". */
export const signedInLine = (me: Me): string => (me.account.googleOnly ? t("account.signedInGoogle") : t("account.signedInAs", { email: me.account.email }));
