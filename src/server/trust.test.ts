import { describe, expect, it } from "vitest";
import { isProxyAddress, trustedProxies, visitorOf } from "./trust";

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

describe("who a request counts as", () => {
  it("leaves an IPv4 address as it is, and whatever is not an address", () => {
    for (const text of ["203.0.113.9", "10.1.2.3", "0.0.0.0", "", "unknown", "1.2.3", "999.1.1.1", "2001:db8::zz"]) {
      expect(visitorOf(text), text).toBe(text);
    }
  });

  it("counts every address of an IPv6 network of 64 bits as the one visitor it is, however the address is written", () => {
    const network = "2001:db8:1:2::";
    for (const address of [
      "2001:db8:1:2::1",
      "2001:db8:1:2::",
      "2001:db8:1:2:ffff:ffff:ffff:ffff",
      "2001:0db8:0001:0002:0000:0000:0000:0001",
      "2001:DB8:1:2:AAAA:bbbb:CcCc:dddd",
      "2001:db8:1:2:1::",
    ]) {
      expect(visitorOf(address), address).toBe(network);
    }
  });

  it("keeps the networks apart, in the first 64 bits and in no other", () => {
    const visitors = ["2001:db8:1:2::1", "2001:db8:1:3::1", "2001:db8:2:2::1", "2001:db9:1:2::1", "2002:db8:1:2::1", "2001:db8::1:2:0:1"].map(visitorOf);
    expect(new Set(visitors).size).toBe(visitors.length);
    expect(visitorOf("2001:db8::5:6:7:8")).toBe("2001:db8:0:0::");
    expect(visitorOf("::1")).toBe("0:0:0:0::");
    expect(visitorOf("::")).toBe("0:0:0:0::");
    expect(visitorOf("1:2:3:4:5:6:7::")).toBe("1:2:3:4::");
    expect(visitorOf("::2:3:4:5:6:7:8")).toBe("0:2:3:4::");
  });

  it("reads an IPv4 address written as IPv6 as the IPv4 one, in both ways it is written", () => {
    expect(visitorOf("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(visitorOf("::FFFF:203.0.113.9")).toBe("203.0.113.9");
    expect(visitorOf("::ffff:cb00:7109")).toBe("203.0.113.9");
    expect(visitorOf("0:0:0:0:0:ffff:cb00:7109")).toBe("203.0.113.9");
    expect(visitorOf("::ffff:10.1.2.3")).toBe("10.1.2.3");
    // (Only the one prefix is the IPv4 one: the others are networks like any other.)
    expect(visitorOf("::fffe:203.0.113.9")).toBe("0:0:0:0::");
    expect(visitorOf("64:ff9b::203.0.113.9")).toBe("64:ff9b:0:0::");
    expect(visitorOf("1::ffff:203.0.113.9")).toBe("1:0:0:0::");
  });

  it("leaves out the zone of a link-local address", () => {
    expect(visitorOf("fe80::1%eth0")).toBe("fe80:0:0:0::");
    expect(visitorOf("fe80::1")).toBe(visitorOf("fe80::2%en1"));
    expect(visitorOf("::ffff:203.0.113.9%eth0")).toBe("203.0.113.9");
  });
});
