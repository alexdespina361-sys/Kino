export const KLIPY_HOSTS: ReadonlySet<string> = new Set(["static.klipy.com", "static1.klipy.com", "static2.klipy.com"]);
const PICTURE = /\.(gif|webp)$/i;
const ADDRESS_MAX = 400;

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
  if (!written.startsWith(`https://${address.hostname}/`)) return null;
  return written;
}

export function looksLikeGifButIsNot(text: string): boolean {
  const written = text.trim();
  if (written.length === 0 || /\s/.test(written) || !/^[a-z][a-z0-9+.-]*:/i.test(written)) return false;
  return /klipy\.com/i.test(written) && gifOf(written) === null;
}
