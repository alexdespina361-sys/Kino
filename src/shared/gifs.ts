/**
 * What a GIF of a chat is (client/chat/gifs.ts has the rest: KLIPY's search, its rules, the grid). Here, so that the server holds a message or a kept
 * picture to the same rule the pages draw it by: an address on one of KLIPY's hosts that a page would not draw is not taken (the review of 18 Nov: the
 * rule was the pages' alone, and a page made otherwise would have had nothing behind it). Any other address is words, and stays words.
 */

/** The hosts KLIPY delivers its pictures from (their "Network Requirements"). */
export const KLIPY_HOSTS: ReadonlySet<string> = new Set(["static.klipy.com", "static1.klipy.com", "static2.klipy.com"]);
const PICTURE = /\.(gif|webp)$/i;
/** Longer than any picture KLIPY gives (about 90 characters), shorter than a message: what is longer is not one of theirs. */
const ADDRESS_MAX = 400;

/**
 * The picture a message is, when its whole text (spaces around it aside) is the https address of a GIF or WebP on one of KLIPY's hosts, with nothing
 * else in it: no name and password, no port, no fragment. The address is given back as it was written (with its query, if it has one: KLIPY's rule).
 */
export function gifOf(text: string): string | null {
  const written = text.trim();
  if (written.length === 0 || written.length > ADDRESS_MAX || /\s/.test(written) || !written.startsWith("https://")) return null;
  let address: URL;
  try {
    address = new URL(written);
  } catch {
    return null;
  }
  if (address.protocol !== "https:" || address.username || address.password || address.port || address.hash) return null;
  if (!KLIPY_HOSTS.has(address.hostname) || !PICTURE.test(address.pathname)) return null;
  // (What was written must be what the browser reads: `https://static.klipy.com\@evil/` and the like are read as another host by some.)
  if (!written.startsWith(`https://${address.hostname}/`)) return null;
  return written;
}

/** Whether a message's whole text is an address that names one of KLIPY's hosts anywhere in it (so would be taken for a GIF) and is not one (`gifOf`). */
export function looksLikeGifButIsNot(text: string): boolean {
  const written = text.trim();
  if (written.length === 0 || /\s/.test(written) || !/^[a-z][a-z0-9+.-]*:/i.test(written)) return false;
  return /klipy\.com/i.test(written) && gifOf(written) === null;
}
