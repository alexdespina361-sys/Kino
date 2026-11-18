import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { buildStreamRelay } from "../src/server/streamRelay/app";
import { signedRelayUrl } from "../src/server/streamRelay/links";
import { FEEDBACK_TOKEN } from "./feedbackToken";
import { openTv, RawPhone, readPairingCode, tvRoot, tvTime } from "./helpers";

const FILM = path.resolve("fixtures/hls");
const PLAYER_PAGE = "https://player.example/embed/42";
const KEY = "a-key-for-this-test-only-0123456789abcdef";

const listen = (server: http.Server) => new Promise<number>((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
const stop = (server: http.Server) => {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(resolve));
};

test("a film that comes through the relay plays without this server carrying a byte of it", async ({ browser, baseURL }) => {
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
  const failures: unknown[] = [];
  const relay = buildStreamRelay({ key: KEY, isAllowedAddress: () => true, log: (failure) => void failures.push(failure) });
  const providerPort = await listen(provider);
  await relay.listen({ port: 0, host: "127.0.0.1" });
  const relayPort = (relay.server.address() as AddressInfo).port;
  try {
    const health = async () => (await (await fetch(`${baseURL}/api/health`, { headers: { authorization: `Bearer ${FEEDBACK_TOKEN}` } })).json()) as { proxy: { bytes: number; requests: number } };
    const tv = await openTv(browser);
    const filmAsked = new Set<string>();
    const app = new URL(baseURL!).host;
    tv.on("request", (request) => {
      const url = new URL(request.url());
      if (url.host === app && url.pathname === "/api/proxy") filmAsked.add(`${url.host}/api/proxy`);
      else if (url.host !== app) filmAsked.add(url.host);
    });
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    await expect(tv.getByTestId("tv-paired")).toBeVisible();
    const before = await health();

    const film = `http://127.0.0.1:${providerPort}/master.m3u8`;
    const viaRelay = signedRelayUrl(`http://127.0.0.1:${relayPort}/api/proxy`, { url: film, referer: PLAYER_PAGE, expires: Date.now() + 3600_000, hostToken: false }, KEY);
    phone.cmd({ type: "LOAD", media: { title: "Through the relay", stream: { url: viaRelay, type: "hls" } } });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused", { timeout: 20_000 });
    phone.cmd({ type: "PLAY" });
    await expect.poll(() => tvTime(tv), { timeout: 20_000, intervals: [300] }).toBeGreaterThan(3);

    expect([...filmAsked]).toEqual([`127.0.0.1:${relayPort}`]);
    expect((await health()).proxy).toMatchObject({ bytes: before.proxy.bytes, requests: before.proxy.requests });
    expect(heard.length).toBeGreaterThan(3);
    expect(heard.filter((note) => note.origin)).toEqual([]);
    expect(new Set(heard.map((note) => note.referer))).toEqual(new Set([PLAYER_PAGE]));
    expect(heard.filter((note) => note.answered !== 200)).toEqual([]);
    expect(failures).toEqual([]);
    phone.close();
  } finally {
    await relay.close();
    await stop(provider);
  }
});
