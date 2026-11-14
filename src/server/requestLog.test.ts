import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app";
import { addressForLog, looksLikePage, requestForLog } from "./requestLog";

describe("what the log says about a request", () => {
  it("keeps the path and the names of the questions, and drops what they were asked with", () => {
    expect(addressForLog("/api/health")).toBe("/api/health");
    expect(addressForLog("/api/library/search?q=a+film+somebody+looked+for&kind=movie")).toBe("/api/library/search?q=_&kind=movie");
    expect(addressForLog("/api/auth/google/callback?code=4/0AbCdEf&state=xyz123")).toBe("/api/auth/google/callback?code=_&state=_");
    expect(addressForLog("/?party=ABCD12&role=remote")).toBe("/?party=_&role=remote");
    // (A value that is one of the plain ones by name but not by looks is dropped as well.)
    expect(addressForLog("/api/library/rows?section=<script>&cursor=3")).toBe("/api/library/rows?section=_&cursor=3");
  });

  it("says which host the proxy was asked to carry from, and nothing more of the link", () => {
    const link = "https://media.example/hls/list.m3u8?token=SECRET-TOKEN&expires=99";
    const line = addressForLog(`/api/proxy?url=${encodeURIComponent(link)}&referer=${encodeURIComponent("https://site.example/watch/123")}&format=hls`);
    expect(line).toBe("/api/proxy?url=media.example&referer=_&format=hls");
    expect(addressForLog("/api/proxy?url=not%20a%20link")).toBe("/api/proxy?url=_");
    // (Only the proxy's: a `url` asked of another route is a page somebody pasted or a title.)
    expect(addressForLog(`/api/resolve?url=${encodeURIComponent(link)}`)).toBe("/api/resolve?url=_");
  });

  it("names the route as it is declared, so a profile, a file or a report is not named", () => {
    expect(requestForLog({ method: "GET", url: "/api/profiles/p_123456/friends?since=77", host: "kino.example", routeOptions: { url: "/api/profiles/:id/friends" } })).toEqual({
      method: "GET",
      url: "/api/profiles/:id/friends?since=_",
      host: "kino.example",
    });
    // (An address that found no route is written as asked, without its questions' values: what a scanner asks for is worth seeing.)
    expect(requestForLog({ method: "GET", url: "/wp-admin/install.php?step=1", routeOptions: {} })).toEqual({ method: "GET", url: "/wp-admin/install.php?step=_" });
    expect(requestForLog({ method: "GET", url: "/assets/index-abc.js", routeOptions: { url: "/*" } }).url).toBe("/assets/index-abc.js");
  });

  it("tells a page of the site from a file and from a place a scanner looks for", () => {
    for (const page of ["/", "/tv", "/tv/", "/?party=ABCD12", "/title/tt123", "/some/page?x=a.b"]) expect(looksLikePage(page), page).toBe(true);
    for (const other of ["/wp-admin/install.php", "/wp-admin/", "/WP-login", "/.env", "/.env.production", "/.git/config", "/a/%2egit/config", "/index.php?x=1", "/cgi-bin/luci", "/phpmyadmin", "/xmlrpc", "/x.aspx"]) {
      expect(looksLikePage(other), other).toBe(false);
    }
  });
});

describe("the server's log", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  async function served() {
    dir = await mkdtemp(path.join(tmpdir(), "kino-log-"));
    await mkdir(path.join(dir, "assets"), { recursive: true });
    await writeFile(path.join(dir, "index.html"), "<!doctype html><title>Kino</title>");
    const lines: Array<Record<string, unknown>> = [];
    const app = await buildApp({ clientDir: dir, logger: { stream: { write: (line: string) => void lines.push(JSON.parse(line) as Record<string, unknown>) } }, fetchesPerMinute: { proxy: 1 }, proxyVideo: false });
    return { app, lines, text: () => JSON.stringify(lines) };
  }

  it("has no visitor's address, no link and no code in the lines of a request, and names the visitor only where the request was refused", async () => {
    const { app, lines, text } = await served();
    try {
      const visitor = "203.0.113.77";
      const link = "https://media.example/subs/film.vtt?token=SECRET-TOKEN";
      await app.inject({ url: `/api/proxy?url=${encodeURIComponent(link)}`, remoteAddress: visitor });
      await app.inject({ url: "/api/library/search?q=words+somebody+searched", remoteAddress: visitor });
      expect(lines.some((line) => line.msg === "incoming request")).toBe(true);
      expect(text()).not.toContain(visitor);
      expect(text()).not.toContain("SECRET-TOKEN");
      expect(text()).not.toContain("somebody");
      expect(text()).toContain("media.example");
      expect(lines.some((line) => (line.res as { statusCode?: number } | undefined)?.statusCode !== undefined)).toBe(true); // (the answer's line is as it was)

      // (Past the limit of one a minute: refused, and that line says to whom.)
      const refused = await app.inject({ url: `/api/proxy?url=${encodeURIComponent(link)}`, remoteAddress: visitor });
      expect(refused.statusCode).toBe(429);
      expect(lines.filter((line) => line.msg === "refused")).toEqual([expect.objectContaining({ status: 429, visitor })]);
      expect(text()).not.toContain("SECRET-TOKEN");
    } finally {
      await app.close();
    }
  });

  it("answers 404 to what is no page of the site, and still gives the page to an address of the page's own", async () => {
    const { app } = await served();
    try {
      const html = { accept: "text/html,application/xhtml+xml" };
      for (const page of ["/", "/tv", "/tv?role=tv", "/some/page"]) {
        const answer = await app.inject({ url: page, headers: html });
        expect(answer.statusCode, page).toBe(200);
        expect(answer.body, page).toContain("<title>Kino</title>");
      }
      for (const other of ["/wp-admin/install.php", "/wp-admin/", "/.env", "/.git/config", "/index.php", "/phpmyadmin"]) {
        const answer = await app.inject({ url: other, headers: html });
        expect(answer.statusCode, other).toBe(404);
        expect(answer.body, other).not.toContain("<title>");
      }
    } finally {
      await app.close();
    }
  });
});
