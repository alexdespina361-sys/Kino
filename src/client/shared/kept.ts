import { readStorage, writeStorage } from "./format";

const KEPT_SECONDS = 400 * 24 * 3600;

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
  }
}

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

export const hasKept = (key: string): boolean => readStorage(key) !== undefined || readCookie(key) !== undefined;

export function writeKept(key: string, value: string): void {
  writeStorage(key, value);
  writeCookie(key, value);
}
