import dns from "node:dns";
import { getEventListeners } from "node:events";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SafeFetchError, assertAllowedUrl, guardedLookup, safeFetch } from "./safe-fetch";

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

  it("times out on a server that never answers, and says the connection was made but the answer never began", async () => {
    handler = () => {};
    const error = await failure(safeFetch(`${base}/hang`, { ...loopbackOnly, timeoutMs: 200 }));
    expect(error.code).toBe("timeout");
    expect(error.timing).toMatchObject({ timedOut: "answer", address: "127.0.0.1" });
    expect(error.timing?.connectMs).toBeGreaterThanOrEqual(0);
    expect(error.timing).not.toHaveProperty("firstByteMs");
  });

  it("says how long connecting took and when the answer began, and which address answered", async () => {
    handler = (_req, res) => setTimeout(() => res.writeHead(200, { "content-type": "text/plain" }).end("hi"), 20);
    const page = await safeFetch(`${base}/timed`, loopbackOnly);
    expect(page.timing?.address).toBe("127.0.0.1");
    expect(page.timing?.connectMs).toBeGreaterThanOrEqual(0);
    expect(page.timing?.firstByteMs).toBeGreaterThanOrEqual((page.timing?.connectMs ?? 0) + 15);
    expect(page.timing).not.toHaveProperty("timedOut");
  });

  it("gives up on an address that never connects within the connect time, well before the whole budget", async () => {
    // (192.0.2.1 is TEST-NET-1: an address nothing answers at, so the connection is only ever attempted.)
    const started = performance.now();
    const error = await failure(safeFetch("http://192.0.2.1/", { isAllowedAddress: () => true, timeoutMs: 10_000, connectTimeoutMs: 200 }));
    expect(error.code).toBe("timeout");
    expect(performance.now() - started).toBeLessThan(3_000);
    expect(error.timing).toMatchObject({ timedOut: "connect" });
    expect(error.timing).not.toHaveProperty("connectMs");
  });

  it("reports HTTP errors with their status", async () => {
    handler = (_req, res) => res.writeHead(404).end();
    const error = await failure(safeFetch(`${base}/nope`, loopbackOnly));
    expect(error).toMatchObject({ code: "bad_status", status: 404 });
  });

  it("lets go of an answer it has no use for - a redirect, an error - without reading it to the end: a body that never ends keeps no connection open", async () => {
    const closed: string[] = [];
    handler = (req, res) => {
      if (req.url === "/moved" || req.url === "/broken") {
        if (req.url === "/moved") res.writeHead(302, { location: "/fine" });
        else res.writeHead(500);
        res.write("..."); // (and the body goes on for ever)
        res.on("close", () => closed.push(req.url!.slice(1)));
        return;
      }
      res.writeHead(200, { "content-type": "text/plain" }).end("fine");
    };
    expect((await safeFetch(`${base}/moved`, loopbackOnly)).body).toBe("fine");
    expect((await failure(safeFetch(`${base}/broken`, loopbackOnly))).code).toBe("bad_status");
    await expect.poll(() => [...closed].sort()).toEqual(["broken", "moved"]);
  });

  it.each([
    ["a length it does not reach", "Content-Length: 1000\r\n\r\nshort"],
    ["chunks that stop", "Transfer-Encoding: chunked\r\n\r\n5\r\nshort\r\n"],
  ])("reports an answer that is cut short - %s - as a failure, never as a short page", async (_kind, rest) => {
    // (A bare socket, not the http server: nothing here decides how the answer is framed, and a plain close ends it without a timer. Destroying a server's socket in the middle of an answer, in the same process as the client, now and then aborts Node on Windows.)
    const bare = net.createServer((socket) => {
      socket.on("error", () => {});
      socket.once("data", () => socket.end(`HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n${rest}`));
    });
    await new Promise<void>((resolve) => bare.listen(0, "127.0.0.1", resolve));
    try {
      expect((await failure(safeFetch(`http://127.0.0.1:${(bare.address() as AddressInfo).port}/cut`, loopbackOnly))).code).toBe("network");
    } finally {
      await new Promise((resolve) => bare.close(resolve));
    }
  });

  it("with the DEFAULT policy, refuses loopback by IP and by name", async () => {
    handler = (_req, res) => res.writeHead(200, { "content-type": "text/html" }).end("secret");
    const port = new URL(base).port;
    expect((await failure(safeFetch(`http://127.0.0.1:${port}/`))).code).toBe("blocked");
    expect((await failure(safeFetch(`http://localhost:${port}/`))).code).toBe("blocked");
  });
});

describe("safeFetch: headers, any type, abort", () => {
  /** Makes a name of the test (never a real one) lead to this machine. */
  const nameLeadsHere = (name: string) => {
    const real = dns.lookup;
    vi.spyOn(dns, "lookup").mockImplementation(((host: string, options: dns.LookupOptions, callback: never) =>
      host === name ? (callback as (e: null, a: dns.LookupAddress[]) => void)(null, [{ address: "127.0.0.1", family: 4 }]) : real(host, options, callback)) as never);
  };
  afterEach(() => vi.restoreAllMocks());

  it("sends the headers it is given, and always asks for the plain (uncompressed) body", async () => {
    let seen: http.IncomingHttpHeaders = {};
    handler = (req, res) => {
      seen = req.headers;
      res.writeHead(200, { "content-type": "text/html" }).end("ok");
    };
    await safeFetch(`${base}/a`, { ...loopbackOnly, headers: { Referer: "https://player.example/p", "User-Agent": "Test/1", "Accept-Encoding": "gzip" } });
    expect(seen).toMatchObject({ referer: "https://player.example/p", "user-agent": "Test/1", "accept-encoding": "identity" });
  });

  it("with anyType, hands over a body of any type as bytes (and without it, still does not download one)", async () => {
    const bytes = Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 255, 254]);
    handler = (_req, res) => res.writeHead(200, { "content-type": "application/wasm" }).end(bytes);
    const page = await safeFetch(`${base}/m.wasm`, { ...loopbackOnly, anyType: true });
    expect(page.contentType).toBe("application/wasm");
    expect(page.bytes?.equals(bytes)).toBe(true);
    expect(page.body).toBe(""); // (it is not text, and is not made into any)
    const plain = await safeFetch(`${base}/m.wasm`, loopbackOnly);
    expect(plain).toMatchObject({ body: "", truncated: false });
    expect(plain.bytes).toBeUndefined();
    handler = (_req, res) => res.writeHead(200, { "content-type": "text/plain" }).end("hi");
    expect((await safeFetch(`${base}/t`, loopbackOnly)).bytes).toBeUndefined(); // (a page is held once, as text)
  });

  it("an option given as undefined is no option: the bounds stay (the default size and time, and five redirects)", async () => {
    handler = (_req, res) => res.writeHead(200, { "content-type": "text/html" }).end("x".repeat(3 * 1024 * 1024));
    const page = await safeFetch(`${base}/big`, { ...loopbackOnly, maxBytes: undefined, timeoutMs: undefined, maxRedirects: undefined });
    expect(page.truncated).toBe(true);
    expect(page.body.length).toBe(2 * 1024 * 1024);
    handler = (_req, res) => res.writeHead(302, { location: "/again" }).end();
    expect((await failure(safeFetch(`${base}/x`, { ...loopbackOnly, maxRedirects: undefined }))).code).toBe("too_many_redirects");
  });

  it("with anyType, still reads no more than the bound", async () => {
    handler = (_req, res) => res.writeHead(200, { "content-type": "application/octet-stream" }).end(Buffer.alloc(100_000, 7));
    const page = await safeFetch(`${base}/big`, { ...loopbackOnly, anyType: true, maxBytes: 1000 });
    expect(page.truncated).toBe(true);
    expect(page.bytes?.length).toBe(1000);
  });

  it("does not pass a cookie on to another origin when a redirect leads there, and keeps it for the same one", async () => {
    const asked: Array<{ host: string | undefined; cookie: string | undefined; authorization: string | undefined; referer: string | undefined }> = [];
    nameLeadsHere("other.test");
    handler = (req, res) => {
      asked.push({ host: req.headers.host?.split(":")[0], cookie: req.headers.cookie, authorization: req.headers.authorization, referer: req.headers.referer });
      const port = new URL(base).port;
      if (req.url === "/start") return void res.writeHead(302, { location: "/same" }).end();
      if (req.url === "/same") return void res.writeHead(302, { location: `http://other.test:${port}/elsewhere` }).end();
      res.writeHead(200, { "content-type": "text/html" }).end("done");
    };
    const page = await safeFetch(`${base}/start`, { ...loopbackOnly, headers: { cookie: "key=abc", Authorization: "Bearer secret", referer: "https://player.example/" } });
    expect(page.body).toBe("done");
    expect(asked).toEqual([
      { host: "127.0.0.1", cookie: "key=abc", authorization: "Bearer secret", referer: "https://player.example/" },
      { host: "127.0.0.1", cookie: "key=abc", authorization: "Bearer secret", referer: "https://player.example/" },
      { host: "other.test", cookie: undefined, authorization: undefined, referer: "https://player.example/" },
    ]);
  });

  it("ends when the signal it is given aborts, or has already", async () => {
    handler = () => {};
    const started = Date.now();
    expect((await failure(safeFetch(`${base}/hang`, { ...loopbackOnly, signal: AbortSignal.timeout(150) }))).code).toBe("timeout");
    expect((await failure(safeFetch(`${base}/hang`, { ...loopbackOnly, signal: AbortSignal.abort() }))).code).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("leaves no listener on a signal that goes on after it, however it ended", async () => {
    const signal = new AbortController().signal;
    const listeners = () => getEventListeners(signal, "abort").length;
    handler = (_req, res) => res.writeHead(200, { "content-type": "text/html" }).end("ok");
    await safeFetch(`${base}/a`, { ...loopbackOnly, signal });
    expect(listeners()).toBe(0);
    handler = (_req, res) => res.writeHead(404).end();
    await failure(safeFetch(`${base}/a`, { ...loopbackOnly, signal }));
    expect(listeners()).toBe(0);
    await failure(safeFetch("not a url", { ...loopbackOnly, signal }));
    expect(listeners()).toBe(0);
  });

  it("ends a body that stops coming after the headers, within the time it was given", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.write("<p>start");
      // (and nothing more, ever)
    };
    const started = Date.now();
    const outcome = await safeFetch(`${base}/stall`, { ...loopbackOnly, timeoutMs: 250 }).then(
      (page) => ({ page }),
      (error: unknown) => ({ error: error as SafeFetchError }),
    );
    expect(Date.now() - started).toBeLessThan(3000);
    if ("error" in outcome) expect(outcome.error.code).toBe("timeout");
    else expect(outcome.page.body).toBe("<p>start");
  });
});

describe("guardedLookup", () => {
  const nameLeadsTo = (...addresses: string[]) =>
    vi.spyOn(dns, "lookup").mockImplementation(((_host: string, _options: dns.LookupOptions, callback: never) =>
      (callback as (e: null, a: dns.LookupAddress[]) => void)(null, addresses.map((address) => ({ address, family: 4 })))) as never);
  const lookUp = (allowed: (ip: string) => boolean, all = false) =>
    new Promise<{ error: SafeFetchError | null; result: unknown }>((resolve) =>
      guardedLookup(allowed)("any.test", { all }, ((error: SafeFetchError | null, result: unknown) => resolve({ error, result })) as never),
    );
  const onlyTheFirstOfTwo = (ip: string) => ip === "127.0.0.1";
  afterEach(() => vi.restoreAllMocks());

  it("hands out the addresses of a name when every one of them is allowed (one, or all of them when asked for all)", async () => {
    nameLeadsTo("127.0.0.1", "127.0.0.2");
    const loopback = (ip: string) => ip.startsWith("127.0.0.");
    expect((await lookUp(loopback, true)).result).toEqual([{ address: "127.0.0.1", family: 4 }, { address: "127.0.0.2", family: 4 }]);
    expect((await lookUp(loopback)).result).toBe("127.0.0.1");
  });

  it("refuses a name when any one of its addresses is not allowed, wherever in the list it is", async () => {
    nameLeadsTo("127.0.0.1", "127.0.0.2");
    expect((await lookUp(onlyTheFirstOfTwo, true)).error?.code).toBe("blocked");
    nameLeadsTo("127.0.0.2", "127.0.0.1");
    expect((await lookUp(onlyTheFirstOfTwo, true)).error?.code).toBe("blocked");
    expect((await lookUp(onlyTheFirstOfTwo)).error?.code).toBe("blocked");
  });

  it("refuses a name that has no address", async () => {
    nameLeadsTo();
    expect((await lookUp(() => true)).error?.code).toBe("blocked");
  });

  it("passes a lookup that failed on as the failure it is, never as an address", async () => {
    const failed = Object.assign(new Error("getaddrinfo ENOTFOUND any.test"), { code: "ENOTFOUND" });
    vi.spyOn(dns, "lookup").mockImplementation(((_host: string, _options: dns.LookupOptions, callback: never) => (callback as (e: Error) => void)(failed)) as never);
    const answer = await lookUp(() => true);
    expect(answer.error).toBe(failed);
    expect(answer.result).toBeFalsy();
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
