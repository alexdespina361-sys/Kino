import { BlockList, isIP } from "node:net";

/**
 * Where a visitor's address is read from when the server sits behind proxies. Fastify goes through the addresses of a request from the nearest (the connection)
 * outwards, and the first one it does not trust is the visitor's. A number of proxies (`TRUST_PROXY=1` on Render) trusts that many from the connection, but a
 * site that is also behind Cloudflare has Cloudflare's own address next, and that was taken for the visitor's: everybody who came through the same Cloudflare
 * machine looked like one person to the rate limits (sign-ups, wrong passwords, link polls) and to the visitor count. So Cloudflare's addresses, and the ones
 * inside a host's own network, are passed over as well: the visitor is the first address that is none of those.
 *
 * What a visitor writes in `X-Forwarded-For` comes first in the list and is never reached; the list is read from the right, and the rightmost address is the
 * one the nearest proxy saw for itself. A request sent straight to the host (not through Cloudflare) is read the same way, so it cannot claim to be Cloudflare's either.
 * What this does not stop: someone with a Cloudflare account of their own who sends requests to the origin from Cloudflare's machines (a Worker) can write
 * the list as they please. Nothing here is a secret, only a rate limit and a count.
 */

/** Cloudflare's addresses (https://www.cloudflare.com/ips, read 2026-11-01). They change rarely; one that is missing here is read as a visitor, which is how it was before. */
const CLOUDFLARE = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

/** Addresses of a network of one's own (loopback, private, shared, link-local): no visitor of a site on the internet has one, a host's proxies do. */
const INTERNAL = ["127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "169.254.0.0/16", "::1/128", "fc00::/7", "fe80::/10"];

const PROXIES = new BlockList();
for (const range of [...CLOUDFLARE, ...INTERNAL]) {
  const [address = "", bits = ""] = range.split("/");
  PROXIES.addSubnet(address, Number(bits), isIP(address) === 6 ? "ipv6" : "ipv4");
}

/** Whether this is an address of Cloudflare's or of a host's own network. (Whatever is not an address at all is not.) */
export function isProxyAddress(address: string): boolean {
  const family = isIP(address);
  return family !== 0 && PROXIES.check(address, family === 6 ? "ipv6" : "ipv4");
}

/** What Fastify asks about each address of a request, the nearest first (`hop` 0 is the connection itself): is it one of our own proxies? */
export function trustedProxies(proxies: number): (address: string, hop: number) => boolean {
  return (address, hop) => hop < proxies || isProxyAddress(address);
}
