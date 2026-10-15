import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { openTv, RawPhone, readPairingCode, tvRoot, tvTime } from "./helpers";

/**
 * The film that comes through the edge relay (scripts/edge-stream-worker.js, which is what EDGE_STREAM_PROXY_URL points at) does not come through
 * this server, which is the whole point of it: the host of this server charges for what it sends. The worker here is the real script, run by
 * Node as it would run on Cloudflare, and the place the film comes from is one that turns away any request that carries an Origin (a browser
 * from another website does), as the places that films come from do.
 */
const FILM = path.resolve("fixtures/hls");
const PLAYER_PAGE = "https://player.example/embed/42";

const listen = (server: http.Server) => new Promise<number>((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
const stop = (server: http.Server) => {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(resolve));
};

test("a film that comes through the edge relay plays without this server carrying a byte of it", async ({ browser, baseURL }) => {
  const heard: { path: string; origin?: string; referer?: string; answered: number }[] = [];
  const provider = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://provider");
    const note = { path: url.pathname, origin: request.headers.origin, referer: request.headers.referer, answered: 0 };
    heard.push(note);
    const file = path.join(FILM, url.pathname);
    if (note.origin || !file.startsWith(FILM) || !fs.existsSync(file)) {
      note.answered = note.origin ? 403 : 404;
      response.writeHead(note.answered, { "content-type": "text/html" });
      return void response.end("no");
    }
    note.answered = 200;
    response.writeHead(200, { "content-type": file.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/iso.segment", "content-length": fs.statSync(file).size });
    fs.createReadStream(file).pipe(response);
  });
  const { default: worker } = (await import(pathToFileURL(path.resolve("scripts/edge-stream-worker.js")).href)) as typeof import("../scripts/edge-stream-worker.js");
  const relay = http.createServer(async (req, res) => {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(name, value);
    const answer = await worker.fetch(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers }), {}, {});
    res.writeHead(answer.status, Object.fromEntries(answer.headers));
    if (answer.body) Readable.fromWeb(answer.body as never).pipe(res);
    else res.end();
  });
  const providerPort = await listen(provider);
  const relayPort = await listen(relay);
  try {
    const health = async () => (await (await fetch(`${baseURL}/api/health`)).json()) as { proxy: { bytes: number; requests: number } };
    const tv = await openTv(browser);
    // Where the screen's page asked for anything but the app's own files: the places, and this server's proxy when it is one of them.
    const filmAsked = new Set<string>();
    const app = new URL(baseURL!).host;
    tv.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/proxy") filmAsked.add(`${url.host}/api/proxy`);
      else if (url.host !== app) filmAsked.add(url.host);
    });
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    await expect(tv.getByTestId("tv-paired")).toBeVisible();
    const before = await health();

    const film = `http://127.0.0.1:${providerPort}/master.m3u8`;
    const viaRelay = `http://127.0.0.1:${relayPort}?url=${encodeURIComponent(film)}&referer=${encodeURIComponent(PLAYER_PAGE)}`;
    phone.cmd({ type: "LOAD", media: { title: "Through the relay", stream: { url: viaRelay, type: "hls" } } });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused", { timeout: 20_000 });
    phone.cmd({ type: "PLAY" });
    await expect.poll(() => tvTime(tv), { timeout: 20_000, intervals: [300] }).toBeGreaterThan(3);

    // The screen asked the relay and no one else (not the film's own place, not this server), ...
    expect([...filmAsked]).toEqual([`127.0.0.1:${relayPort}`]);
    // ... this server carried none of it, ...
    expect((await health()).proxy).toMatchObject({ bytes: before.proxy.bytes, requests: before.proxy.requests });
    // ... and the film's own place was asked as a player of its own would: its player's address, and no Origin.
    expect(heard.length).toBeGreaterThan(3);
    expect(heard.filter((note) => note.origin)).toEqual([]);
    expect(new Set(heard.map((note) => note.referer))).toEqual(new Set([PLAYER_PAGE]));
    expect(heard.filter((note) => note.answered !== 200)).toEqual([]);
    phone.close();
  } finally {
    await stop(relay);
    await stop(provider);
  }
});
