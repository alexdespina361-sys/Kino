import { BlockList, isIP } from "node:net";

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

const INTERNAL = ["127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "169.254.0.0/16", "::1/128", "fc00::/7", "fe80::/10"];

const PROXIES = new BlockList();
for (const range of [...CLOUDFLARE, ...INTERNAL]) {
  const [address = "", bits = ""] = range.split("/");
  PROXIES.addSubnet(address, Number(bits), isIP(address) === 6 ? "ipv6" : "ipv4");
}

export function isProxyAddress(address: string): boolean {
  const family = isIP(address);
  return family !== 0 && PROXIES.check(address, family === 6 ? "ipv6" : "ipv4");
}

export function trustedProxies(proxies: number): (address: string, hop: number) => boolean {
  return (address, hop) => hop < proxies || isProxyAddress(address);
}

function groupsOf(address: string): number[] | undefined {
  if (isIP(address) !== 6) return undefined;
  let text = address.split("%")[0] ?? "";
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [a = 0, b = 0, c = 0, d = 0] = dotted.slice(1).map(Number);
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = "", tail] = text.split("::");
  const parts = (side: string | undefined) => (side ? side.split(":") : []);
  const [front, back] = [parts(head), parts(tail)];
  return [...front, ...Array<string>(8 - front.length - back.length).fill("0"), ...back].map((group) => parseInt(group, 16));
}

export function networkOf(visitor: string): string {
  if (!visitor.includes(":")) return visitor;
  const groups = visitor.split(":");
  return groups.length >= 3 && groups.slice(0, 3).every((group) => /^[0-9a-f]{1,4}$/.test(group)) ? `${groups.slice(0, 3).join(":")}::/48` : visitor;
}

export function visitorOf(address: string): string {
  const groups = groupsOf(address);
  if (!groups || groups.length !== 8) return address;
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0] = groups;
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0xffff) return `${g >> 8}.${g & 255}.${h >> 8}.${h & 255}`;
  return `${a.toString(16)}:${b.toString(16)}:${c.toString(16)}:${d.toString(16)}::`;
}
