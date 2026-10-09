import { isIP } from "node:net";

/** [network, prefixLength] for IPv4 ranges that are never valid public destinations. */
const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. cloud metadata 169.254.169.254
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

function v4ToInt(address: string): number {
  return address.split(".").reduce((acc, part) => acc * 256 + Number(part), 0);
}

function isPublicV4(address: string): boolean {
  const value = v4ToInt(address);
  return !BLOCKED_V4.some(([network, bits]) => {
    const size = 2 ** (32 - bits);
    return Math.floor(value / size) === Math.floor(v4ToInt(network) / size);
  });
}

/** Expand any IPv6 text form (including "::" and an embedded dotted IPv4) to 8 numeric groups. */
function expandV6(address: string): number[] | null {
  let text = address.split("%")[0]!.toLowerCase(); // drop zone id
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const v4 = v4ToInt(dotted[2]!);
    text = `${dotted[1]}${((v4 >>> 16) & 0xffff).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail].map((g) =>
    parseInt(g, 16),
  );
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

function isPublicV6(address: string): boolean {
  const g = expandV6(address);
  if (!g) return false; // unparseable -> refuse
  const [a, b, c, d, e, f, gg, h] = g as [number, number, number, number, number, number, number, number];
  const embeddedV4 = `${gg >> 8}.${gg & 255}.${h >> 8}.${h & 255}`;

  if (g.every((x) => x === 0)) return false; // ::
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0 && gg === 0 && h === 1) return false; // ::1
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0xffff) return isPublicV4(embeddedV4); // ::ffff:a.b.c.d
  if (a === 0x64 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0) return isPublicV4(embeddedV4); // NAT64
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0) return false; // deprecated IPv4-compatible
  if ((a & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((a & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((a & 0xffc0) === 0xfec0) return false; // fec0::/10 site-local (deprecated)
  if ((a & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  if (a === 0x2001 && b === 0x0db8) return false; // documentation
  if (a === 0x0100 && b === 0 && c === 0 && d === 0) return false; // discard prefix
  return true;
}

/** True only for a syntactically valid IP that is a routable public address. Anything else is refused. */
export function isPublicAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, "");
  const family = isIP(bare);
  if (family === 4) return isPublicV4(bare);
  if (family === 6) return isPublicV6(bare);
  return false;
}
