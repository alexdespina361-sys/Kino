import { describe, expect, it } from "vitest";
import { isPublicAddress } from "./ip";

describe("isPublicAddress", () => {
  it.each([
    "127.0.0.1", "127.255.255.254", "0.0.0.0", "10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.255",
    "192.168.1.1", "169.254.169.254", "100.64.0.1", "224.0.0.1", "255.255.255.255", "198.18.0.1", "192.0.2.1",
  ])("blocks private/special IPv4 %s", (ip) => expect(isPublicAddress(ip)).toBe(false));

  it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.15.255.255", "172.32.0.1", "100.63.255.255", "11.0.0.1"])(
    "allows public IPv4 %s",
    (ip) => expect(isPublicAddress(ip)).toBe(true),
  );

  it.each([
    "::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "fe80::1%eth0", "ff02::1", "2001:db8::1", "[::1]",
    "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:169.254.169.254", "::ffff:7f00:1", "64:ff9b::7f00:1", "0:0:0:0:0:0:0:1",
  ])("blocks private/special IPv6 %s", (ip) => expect(isPublicAddress(ip)).toBe(false));

  it.each(["2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8", "[2606:4700::1]"])(
    "allows public IPv6 %s",
    (ip) => expect(isPublicAddress(ip)).toBe(true),
  );

  it.each(["", "localhost", "example.com", "999.1.1.1", "1.2.3", "0x7f.0.0.1", "2130706433", "::g"])(
    "refuses anything that is not a plain IP literal (%j)",
    (value) => expect(isPublicAddress(value)).toBe(false),
  );
});
