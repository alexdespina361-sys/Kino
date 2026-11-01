import { describe, expect, it } from "vitest";
import { isProxyAddress, trustedProxies } from "./trust";

describe("which addresses are a proxy's and not a visitor's", () => {
  it("knows Cloudflare's, at the edges of its ranges and not beyond them", () => {
    for (const address of ["173.245.48.0", "173.245.63.255", "104.16.0.1", "104.23.255.255", "104.27.255.254", "172.64.0.1", "172.71.255.255", "162.158.1.1", "162.159.255.255", "131.0.72.1", "198.41.200.9"]) {
      expect(isProxyAddress(address), address).toBe(true);
    }
    for (const address of ["173.245.64.0", "104.15.255.255", "104.28.0.0", "172.72.0.0", "162.160.0.0", "131.0.76.0", "198.41.127.255", "203.0.113.9", "8.8.8.8"]) {
      expect(isProxyAddress(address), address).toBe(false);
    }
  });

  it("knows Cloudflare's IPv6 addresses, and an IPv4 one written as IPv6", () => {
    expect(isProxyAddress("2606:4700::6810:84e5")).toBe(true);
    expect(isProxyAddress("2400:cb00:2049:1::a29f:1804")).toBe(true);
    expect(isProxyAddress("2a06:98c0:3600::103")).toBe(true);
    expect(isProxyAddress("2a02:2f0e:1::7")).toBe(false);
    expect(isProxyAddress("2001:db8::1")).toBe(false);
    expect(isProxyAddress("::ffff:104.16.0.1")).toBe(true);
    expect(isProxyAddress("::ffff:203.0.113.9")).toBe(false);
  });

  it("knows the addresses inside a host's own network, and not the ones just outside them", () => {
    for (const address of ["127.0.0.1", "10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.255", "192.168.1.1", "100.64.0.1", "100.127.255.255", "169.254.1.1", "::1", "fd12:3456::1", "fe80::1", "::ffff:10.1.2.3"]) {
      expect(isProxyAddress(address), address).toBe(true);
    }
    for (const address of ["172.15.255.255", "172.32.0.0", "100.63.255.255", "100.128.0.0", "11.0.0.1", "192.169.0.1", "fec0::1", "2001:db8::1"]) {
      expect(isProxyAddress(address), address).toBe(false);
    }
  });

  it("does not take anything that is not an address for one", () => {
    for (const text of ["", "unknown", "evil", "1.2.3", "999.1.1.1", "104.16.0.1:443", "104.16.0.1, 104.16.0.2", "104.16.0.0/13"]) {
      expect(isProxyAddress(text), text).toBe(false);
    }
  });
});

describe("what Fastify is told to trust", () => {
  it("trusts that many addresses from the connection, and Cloudflare's and a host's own network wherever they come", () => {
    const one = trustedProxies(1);
    expect(one("203.0.113.9", 0)).toBe(true); // (the connection itself: the host's proxy, whatever its address)
    expect(one("203.0.113.9", 1)).toBe(false);
    expect(one("172.70.1.2", 1)).toBe(true);
    expect(one("10.9.9.9", 2)).toBe(true);
    expect(one("203.0.113.9", 2)).toBe(false);
    const two = trustedProxies(2);
    expect(two("203.0.113.9", 1)).toBe(true);
    expect(two("203.0.113.9", 2)).toBe(false);
  });
});
