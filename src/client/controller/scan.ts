import { linkCodeOf } from "../shared/launch";

/**
 * What the TV's sign-in QR code says: a link to this app with the sign-in code in it ("https://host/?link=ABCD2345").
 * As with the pairing code, only the code is taken, never the link, so whatever a camera picks up at worst names a request
 * on our own server, which the person then has to approve while looking at the TV.
 */
export function linkFromScan(text: string): string | null {
  const value = text.trim();
  const bare = linkCodeOf(value);
  if (bare && /^[A-Za-z0-9-]+$/.test(value)) return bare;
  try {
    return linkCodeOf(new URL(value).searchParams.get("link")) ?? null;
  } catch {
    return null;
  }
}

/**
 * What the TV's QR code says: a link to this app with the pairing code in it ("https://host/?code=123456"), or, from a TV that has
 * a phone already, the code that lets another one in ("?control=123456"). `names` are the parts of the link that may hold it: a
 * screen that is only looking for a TV to add to a party takes `code` alone, since the other kind is no use there.
 * Only the six digits are used, never the link itself, so a QR code from anywhere can at worst submit a code to our own server.
 * A bare six-digit number is accepted too, for anyone who photographs the code instead.
 */
export function codeFromScan(text: string, names: readonly string[] = ["code", "control"]): string | null {
  const value = text.trim();
  if (/^\d{6}$/.test(value)) return value;
  try {
    const params = new URL(value).searchParams;
    const code = names.map((name) => params.get(name)).find((found) => found !== null && /^\d{6}$/.test(found));
    return code ?? null;
  } catch {
    return null;
  }
}
