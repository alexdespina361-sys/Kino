import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SafeFetchError, assertAllowedUrl, safeFetch } from "./safe-fetch";

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;
let server: http.Server;
let handler: Handler;
let base: string;

beforeEach(async () => {
  server = http.createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

/** Policy for functional tests: loopback only, so the test server is reachable but nothing else is. */
const loopbackOnly = { isAllowedAddress: (ip: string) => ip === "127.0.0.1" };
const failure = async (promise: Promise<unknown>) => (await promise.then(() => null, (e: unknown) => e)) as SafeFetchError;

describe("safeFetch", () => {
  it("returns body, final URL and a normalised content type", async () => {
    handler = (_req, res) => res.writeHead(200, { "content-type": "Text/HTML; charset=utf-8" }).end("<p>hi</p>");
    const page = await safeFetch(`${base}/a`, loopbackOnly);
    expect(page).toMatchObject({ status: 200, contentType: "text/html", body: "<p>hi</p>", truncated: false });
    expect(page.url.href).toBe(`${base}/a`);
  });

  it("follows redirects, including relative Location headers", async () => {
    handler = (req, res) => {
      if (req.url === "/start") return void res.writeHead(302, { location: "/middle" }).end();
      if (req.url === "/middle") return void res.writeHead(301, { location: `${base}/end` }).end();
      res.writeHead(200, { "content-type": "text/html" }).end("done");
    };
    const page = await safeFetch(`${base}/start`, loopbackOnly);
    expect(page.body).toBe("done");
    expect(page.url.pathname).toBe("/end");
  });

  it("gives up on redirect loops", async () => {
    handler = (_req, res) => res.writeHead(302, { location: "/again" }).end();
    expect((await failure(safeFetch(`${base}/x`, { ...loopbackOnly, maxRedirects: 3 }))).code).toBe("too_many_redirects");
  });

  it("re-validates every redirect hop: a redirect to a private address is refused", async () => {
    // Includes metadata IP written in decimal and hex, which URL parsing canonicalises to 169.254.169.254.
    for (const target of ["http://10.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://[::1]:80/", "http://2852039166/", "http://0xa9.0xfe.0xa9.0xfe/"]) {
      handler = (_req, res) => res.writeHead(302, { location: target }).end();
      expect((await failure(safeFetch(`${base}/x`, loopbackOnly))).code, target).toBe("blocked");
    }
  });

  it("refuses a redirect to a non-http scheme", async () => {
    handler = (_req, res) => res.writeHead(302, { location: "file:///etc/passwd" }).end();
    expect((await failure(safeFetch(`${base}/x`, loopbackOnly))).code).toBe("invalid_url");
  });

  it("caps the body size and says it was truncated", async () => {
    handler = (_req, res) => res.writeHead(200, { "content-type": "text/html" }).end("x".repeat(100_000));
    const page = await safeFetch(`${base}/big`, { ...loopbackOnly, maxBytes: 1000 });
    expect(page.truncated).toBe(true);
    expect(page.body.length).toBe(1000);
  });

  it("never downloads media bodies: reports the type and returns immediately", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "content-type": "video/mp4" });
      const timer = setInterval(() => res.write(Buffer.alloc(64 * 1024)), 5); // endless stream
      res.on("close", () => clearInterval(timer));
    };
    const page = await safeFetch(`${base}/v`, loopbackOnly);
    expect(page).toMatchObject({ contentType: "video/mp4", body: "" });
  });

  it("times out on a server that never answers", async () => {
    handler = () => {};
    expect((await failure(safeFetch(`${base}/hang`, { ...loopbackOnly, timeoutMs: 200 }))).code).toBe("timeout");
  });

  it("reports HTTP errors with their status", async () => {
    handler = (_req, res) => res.writeHead(404).end();
    const error = await failure(safeFetch(`${base}/nope`, loopbackOnly));
    expect(error).toMatchObject({ code: "bad_status", status: 404 });
  });

  it("with the DEFAULT policy, refuses loopback by IP and by name", async () => {
    handler = (_req, res) => res.writeHead(200, { "content-type": "text/html" }).end("secret");
    const port = new URL(base).port;
    expect((await failure(safeFetch(`http://127.0.0.1:${port}/`))).code).toBe("blocked");
    expect((await failure(safeFetch(`http://localhost:${port}/`))).code).toBe("blocked");
  });
});

describe("assertAllowedUrl", () => {
  const code = (url: string) => {
    try {
      assertAllowedUrl(new URL(url));
      return "ok";
    } catch (e) {
      return (e as SafeFetchError).code;
    }
  };

  it("accepts ordinary public http(s) URLs", () => {
    expect(code("https://example.com/watch/1")).toBe("ok");
    expect(code("http://93.184.216.34/x")).toBe("ok");
    expect(code("https://[2606:4700:4700::1111]/")).toBe("ok");
  });

  it.each(["file:///etc/passwd", "ftp://example.com/x", "gopher://example.com/", "javascript:alert(1)", "data:text/html,hi", "ws://example.com/"])(
    "rejects scheme: %s",
    (url) => expect(code(url)).toBe("invalid_url"),
  );

  it("rejects embedded credentials", () => {
    expect(code("https://user:pass@example.com/")).toBe("invalid_url");
    expect(code("https://trusted.example.com@127.0.0.1/")).not.toBe("ok"); // looks trusted, host is really 127.0.0.1
  });

  it.each([
    "http://127.0.0.1/", "http://127.1/", "http://0x7f.0.0.1/", "http://2130706433/", "http://017700000001/", "http://0/",
    "http://10.1.2.3/", "http://192.168.0.1/", "http://169.254.169.254/latest/meta-data/", "http://[::1]/",
    "http://[::ffff:127.0.0.1]/", "http://[fd00::1]/", "http://[fe80::1]/",
  ])("blocks address literal: %s", (url) => expect(code(url)).toBe("blocked"));
});
