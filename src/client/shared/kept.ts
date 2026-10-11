import { readStorage, writeStorage } from "./format";

/** The longest a browser keeps a cookie. */
const KEPT_SECONDS = 400 * 24 * 3600;

/** The value of the cookie called `name` in a `document.cookie` string. */
export function findCookie(cookies: string, name: string): string | undefined {
  for (const part of cookies.split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) {
      try {
        return decodeURIComponent(part.slice(at + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** What to assign to `document.cookie` to keep `value` under `name` for as long as a browser will. */
export function cookieText(name: string, value: string, secure: boolean): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${KEPT_SECONDS}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

function readCookie(name: string): string | undefined {
  try {
    return findCookie(document.cookie, name);
  } catch {
    return undefined;
  }
}

function writeCookie(name: string, value: string): void {
  try {
    document.cookie = cookieText(name, value, location.protocol === "https:");
  } catch {
    /* cookies are off here: the page's storage has to do */
  }
}

/**
 * The id that makes a TV or a phone itself to the server (and so keeps it paired) must outlive the browser being closed. It is
 * kept twice, in the page's storage and in a cookie, because a browser that wipes one of them when it closes (some TV browsers
 * keep no page storage at all, some phones clear cookies) very often keeps the other. Whichever copy is missing is made again.
 */
export function readKept(key: string): string | undefined {
  const stored = readStorage(key);
  const cookie = readCookie(key);
  const value = stored ?? cookie;
  if (value !== undefined) {
    if (stored === undefined) writeStorage(key, value);
    if (cookie !== value) writeCookie(key, value);
  }
  return value;
}

export function writeKept(key: string, value: string): void {
  writeStorage(key, value);
  writeCookie(key, value);
}
