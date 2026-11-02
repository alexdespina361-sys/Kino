import dns from "node:dns";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROVIDER_MAX_BYTES, providerFetch } from "./providerFetch";
import { SafeFetchError } from "./safe-fetch";

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
  vi.restoreAllMocks();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

/** The test server is on this machine, so a test that talks to it widens the address policy to that one address. */
const loopbackOnly = { isAllowedAddress: (ip: string) => ip === "127.0.0.1" };
const failure = async (promise: Promise<unknown>) => (await promise.then(() => null, (e: unknown) => e)) as SafeFetchError;
/** Makes names of the test (never real ones) lead to the address given. */
const namesLeadTo = (names: Record<string, string>) => {
  const real = dns.lookup;
  vi.spyOn(dns, "lookup").mockImplementation(((host: string, options: dns.LookupOptions, callback: never) => {
    const address = names[host];
    return address ? (callback as (e: null, a: dns.LookupAddress[]) => void)(null, [{ address, family: 4 }]) : real(host, options, callback);
  }) as never);
};

describe("providerFetch", () => {
  it("answers as fetch does: status, ok, the media type, and the body as text or json", async () => {
    handler = (_req, res) => res.writeHead(200, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify({ results: [1, 2] }));
    const res = await providerFetch(loopbackOnly)(`${base}/a`);
    expect(res).toMatchObject({ ok: true, status: 200 });
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({ results: [1, 2] });
  });

  it("is given an address as a string, a URL or a Request", async () => {
    handler = (_req, res) => res.writeHead(200, { "content-type": "text/plain" }).end("hi");
    const get = providerFetch(loopbackOnly);
    expect(await (await get(`${base}/a`)).text()).toBe("hi");
    expect(await (await get(new URL(`${base}/a`))).text()).toBe("hi");
    expect(await (await get(new Request(`${base}/a`))).text()).toBe("hi");
  });

  it("sends the headers it is given (a Headers, a list or an object), the one from a Request, and always asks for the plain body", async () => {
    let seen: http.IncomingHttpHeaders = {};
    handler = (req, res) => {
      seen = req.headers;
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    };
    const get = providerFetch(loopbackOnly);
    await get(`${base}/a`, { headers: { Referer: "https://player.example/1", "User-Agent": "Test/1" } });
    expect(seen).toMatchObject({ referer: "https://player.example/1", "user-agent": "Test/1", "accept-encoding": "identity" });
    await get(`${base}/a`, { headers: new Headers({ referer: "https://player.example/2" }) });
    expect(seen.referer).toBe("https://player.example/2");
    await get(`${base}/a`, { headers: [["referer", "https://player.example/3"]] });
    expect(seen.referer).toBe("https://player.example/3");
    await get(new Request(`${base}/a`, { headers: { referer: "https://player.example/4", "accept-encoding": "br" } }));
    expect(seen).toMatchObject({ referer: "https://player.example/4", "accept-encoding": "identity" });
  });

  it("an answer that says no is an answer with its status, not an error (whoever asks looks at `ok`)", async () => {
    handler = (_req, res) => res.writeHead(404, { "content-type": "application/json" }).end('{"status_code":404}');
    const res = await providerFetch(loopbackOnly)(`${base}/a`);
    expect(res).toMatchObject({ ok: false, status: 404 });
    handler = (_req, res) => res.writeHead(503).end();
    expect((await providerFetch(loopbackOnly)(`${base}/a`)).status).toBe(503);
  });

  it("an answer without a body is one without a body", async () => {
    for (const status of [204, 205, 304]) {
      handler = (_req, res) => res.writeHead(status).end();
      const none = await providerFetch(loopbackOnly)(`${base}/a`);
      expect(none.status).toBe(status);
      expect(await none.text()).toBe("");
    }
  });

  it("reads a body of any type whole (a module of the player is `application/wasm`)", async () => {
    const bytes = Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 255, 254, 0, 1]);
    handler = (_req, res) => res.writeHead(200, { "content-type": "application/wasm" }).end(bytes);
    const res = await providerFetch(loopbackOnly)(`${base}/m.wasm`);
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
  });

  it("reads no more than the bound, and lets go of an answer that does not end", async () => {
    let closed = false;
    handler = (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      const timer = setInterval(() => res.write(Buffer.alloc(64 * 1024, 0x20)), 2); // endless
      res.on("close", () => {
        closed = true;
        clearInterval(timer);
      });
    };
    const res = await providerFetch({ ...loopbackOnly, maxBytes: 100_000 })(`${base}/endless`);
    expect((await res.arrayBuffer()).byteLength).toBe(100_000);
    await vi.waitFor(() => expect(closed).toBe(true));
  });

  it("has a bound of its own when it is given none", async () => {
    expect(PROVIDER_MAX_BYTES).toBeGreaterThanOrEqual(1024 * 1024);
    expect(PROVIDER_MAX_BYTES).toBeLessThanOrEqual(8 * 1024 * 1024);
    handler = (_req, res) => res.writeHead(200, { "content-type": "text/html" }).end(Buffer.alloc(PROVIDER_MAX_BYTES + 50_000, 0x20));
    const res = await providerFetch(loopbackOnly)(`${base}/big`);
    expect((await res.arrayBuffer()).byteLength).toBe(PROVIDER_MAX_BYTES);
  });

  it("gives up on an answer that stalls, within the time it was given", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.write('{"a":');
    };
    const started = Date.now();
    const outcome = await providerFetch({ ...loopbackOnly, timeoutMs: 250 })(`${base}/stall`).then(
      async (res) => ({ text: await res.text() }),
      (error: unknown) => ({ error }),
    );
    expect(Date.now() - started).toBeLessThan(3000);
    if ("error" in outcome) expect((outcome.error as SafeFetchError).code).toBe("timeout");
    else expect(() => JSON.parse(outcome.text)).toThrow(); // (what came is not a whole answer: it does not parse)
  });

  it("ends when the signal of the question aborts (the library's questions carry one)", async () => {
    handler = () => {};
    const started = Date.now();
    expect((await failure(providerFetch(loopbackOnly)(`${base}/hang`, { signal: AbortSignal.timeout(150) }))).code).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(3000);
  });

  describe("only to public addresses", () => {
    it("turns away an address written out, in any of its spellings", async () => {
      handler = (_req, res) => res.writeHead(200, { "content-type": "text/plain" }).end("secret");
      const port = new URL(base).port;
      const get = providerFetch();
      for (const url of [`http://127.0.0.1:${port}/`, `http://localhost:${port}/`, "http://10.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "http://2130706433/", "http://0x7f.1/"]) {
        expect((await failure(get(url))).code, url).toBe("blocked");
      }
    });

    it("turns away a name that leads to a private address, at the moment of connecting", async () => {
      handler = (_req, res) => res.writeHead(200, { "content-type": "text/plain" }).end("secret");
      const port = new URL(base).port;
      namesLeadTo({ "player.test": "10.1.2.3", "rebind.test": "127.0.0.1" });
      const get = providerFetch();
      expect((await failure(get(`http://player.test:${port}/`))).code).toBe("blocked");
      expect((await failure(get(`http://rebind.test:${port}/`))).code).toBe("blocked");
    });

    it("looks again at every redirect: an allowed site that sends it to a private address does not get there", async () => {
      for (const target of ["http://10.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://[::1]:80/", "http://2852039166/"]) {
        handler = (_req, res) => res.writeHead(302, { location: target }).end();
        expect((await failure(providerFetch(loopbackOnly)(`${base}/x`))).code, target).toBe("blocked");
      }
    });

    it("turns away what is not http(s), a login in the address, and an address that is not one", async () => {
      const get = providerFetch(loopbackOnly);
      for (const url of ["file:///etc/passwd", "ftp://example.com/x", "javascript:alert(1)", "data:text/plain,hi"]) {
        expect((await failure(get(url))).code, url).toBe("invalid_url");
      }
      expect((await failure(get(`http://user:secret@127.0.0.1:${new URL(base).port}/`))).code).toBe("invalid_url");
      expect((await failure(get("/relative"))).code).toBe("invalid_url");
    });
  });
});
