import { createHmac, timingSafeEqual } from "node:crypto";

export interface RelayLink {
  url: string;
  referer: string;
  expires: number;
  hostToken: boolean;
}

function parameters(link: RelayLink): URLSearchParams {
  return new URLSearchParams({ url: link.url, referer: link.referer, expires: String(link.expires), hostToken: link.hostToken ? "1" : "0" });
}

function signature(link: RelayLink, key: string): string {
  return createHmac("sha256", key).update(parameters(link).toString()).digest("hex");
}

/** Links expire together, including the segments and keys referenced by a playlist. The signing key never leaves the servers. */
export function signedRelayUrl(base: string, link: RelayLink, key: string): string {
  const url = new URL(base);
  url.search = parameters(link).toString();
  url.searchParams.set("sig", signature(link, key));
  return url.href;
}

export function verifyRelayLink(query: Record<string, unknown>, key: string, now = Date.now()): RelayLink | null {
  if (typeof query.url !== "string" || typeof query.referer !== "string" || typeof query.expires !== "string" ||
      typeof query.sig !== "string" || !/^[a-f0-9]{64}$/.test(query.sig) || (query.hostToken !== "0" && query.hostToken !== "1")) return null;
  const expires = Number(query.expires);
  if (!Number.isSafeInteger(expires) || expires <= now || expires > now + 24 * 3600_000) return null;
  const link = { url: query.url, referer: query.referer, expires, hostToken: query.hostToken === "1" };
  const expected = Buffer.from(signature(link, key), "hex");
  return timingSafeEqual(expected, Buffer.from(query.sig, "hex")) ? link : null;
}
