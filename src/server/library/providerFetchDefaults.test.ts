import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { providerFetch } from "../resolvers/providerFetch";
import { animeHeavenSource, fetchTmdbAnimeSeasonDetails } from "./animeheaven";
import { filmpireSource } from "./filmpire";
import { internetArchive } from "./internet-archive";

// (`providerFetch` is the real one unless a test hands out another for the next call: the sources take theirs from it when they are given none.)
vi.mock("../resolvers/providerFetch", async (importOriginal) => {
  const original = await importOriginal<typeof import("../resolvers/providerFetch")>();
  return { ...original, providerFetch: vi.fn(original.providerFetch) };
});

/** A fetch for a test: `answer` makes the answers up, and every address asked is written down. Nothing goes anywhere. */
function scripted(answer: (url: URL) => Response) {
  const asked: URL[] = [];
  const fake = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    asked.push(url);
    return answer(url);
  }) as typeof fetch;
  return { fetch: fake, asked };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the library's sources, when they are given no fetch, ask through providerFetch()", () => {
  const noGlobalFetch = () => {
    const global = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", global);
    return global;
  };

  it("Filmpire's (TMDB)", async () => {
    const global = noGlobalFetch();
    const net = scripted(() => Response.json({ results: [], total_pages: 1 }));
    vi.mocked(providerFetch).mockReturnValueOnce(net.fetch);
    await filmpireSource().search!("matrix");
    expect(net.asked.map((url) => url.hostname)).toEqual(["api.themoviedb.org"]);
    expect(global).not.toHaveBeenCalled();
  });

  it("Filmpire's check that a title plays (data.vidsrc.sh) is asked the same way, and a title that site does not have is left out", async () => {
    vi.stubEnv("FILTER_UNPLAYABLE", "1");
    const global = noGlobalFetch();
    const net = scripted((url) =>
      url.hostname === "data.vidsrc.sh"
        ? Response.json({ status_code: url.searchParams.get("tmdb") === "1" ? "200" : "404" })
        : Response.json({
            results: [
              { id: 1, media_type: "movie", title: "Kept", poster_path: "/a.jpg", release_date: "2001-01-01" },
              { id: 2, media_type: "movie", title: "Left out", poster_path: "/b.jpg", release_date: "2002-01-01" },
            ],
            total_pages: 1,
          }),
    );
    vi.mocked(providerFetch).mockReturnValueOnce(net.fetch);
    const found = await filmpireSource().search!("matrix");
    expect(found.map((item) => item.title)).toEqual(["Kept"]);
    expect(net.asked.map((url) => url.hostname).sort()).toEqual(["api.themoviedb.org", "data.vidsrc.sh", "data.vidsrc.sh"]);
    expect(global).not.toHaveBeenCalled();
  });

  it("AnimeHeaven's", async () => {
    const global = noGlobalFetch();
    const net = scripted(() => new Response("<html></html>"));
    vi.mocked(providerFetch).mockReturnValueOnce(net.fetch);
    await animeHeavenSource().load();
    expect(net.asked.map((url) => url.pathname).sort()).toEqual(["/new.php", "/popular.php"]);
    expect(global).not.toHaveBeenCalled();
  });

  it("the Internet Archive's", async () => {
    const global = noGlobalFetch();
    const net = scripted(() => Response.json({ response: { docs: [] } }));
    vi.mocked(providerFetch).mockReturnValueOnce(net.fetch);
    await internetArchive({ rows: [{ collection: "feature_films", title: "Feature films" }] }).load();
    expect(net.asked.map((url) => url.hostname)).toEqual(["archive.org"]);
    expect(global).not.toHaveBeenCalled();
  });
});

describe("an answer that does not end is cut off at the bound, and the source gives up on it", () => {
  let server: http.Server;
  let local: string;
  let sent: number;
  let closed: boolean;
  beforeEach(async () => {
    sent = 0;
    closed = false;
    server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.write('{"results":[');
      const timer = setInterval(() => {
        sent += 64 * 1024;
        res.write(Buffer.alloc(64 * 1024, 0x20));
      }, 2);
      res.on("close", () => {
        closed = true;
        clearInterval(timer);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    local = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it("Filmpire's search (TMDB's answer is read into memory to be parsed)", async () => {
    const bounded = providerFetch({ isAllowedAddress: (ip) => ip === "127.0.0.1", maxBytes: 200_000 });
    const toThisMachine = ((input, init) => bounded(String(input).replace("https://api.themoviedb.org/3", `${local}/3`), init)) as typeof fetch;
    expect(await filmpireSource({ fetch: toThisMachine, verifyPlayback: false }).search!("matrix")).toEqual([]);
    await vi.waitFor(() => expect(closed).toBe(true));
    expect(sent).toBeLessThan(2 * 1024 * 1024);
  });
});

describe("what AnimeHeaven's source keeps of the names its pages give it", () => {
  it("keeps the seasons it looked up for 500 titles at most", async () => {
    const calls: string[] = [];
    const fetcher = (async (input: string | URL) => {
      const url = String(input);
      calls.push(url);
      return url.includes("/search/tv") ? Response.json({ results: [{ id: 7, name: "Show" }] }) : Response.json({ episodes: [] });
    }) as typeof fetch;
    const ask = (title: string) => fetchTmdbAnimeSeasonDetails(title, 1, "key", fetcher, 1000);
    for (let i = 0; i < 600; i++) await ask(`bounded cache title ${i}`);
    expect(calls).toHaveLength(1200);
    await ask("bounded cache title 599");
    expect(calls).toHaveLength(1200); // (the newest is still kept)
    await ask("bounded cache title 100");
    expect(calls).toHaveLength(1200); // (so is the five hundredth newest)
    await ask("bounded cache title 99");
    expect(calls).toHaveLength(1202); // (the one before it is not)
  });

  it("keeps the shows it looked into for episodes for 1000 slugs at most", async () => {
    const probes = new Map<string, number>();
    const card = (slug: string) =>
      `<div class='p1'><a href='anime.php?${slug}'><img class='coverimg' src='image.php?${slug}' alt='Show ${slug} Anime Poster'></a><div class='similarname c'><a href='anime.php?${slug}'>Show ${slug}</a></div></div>`;
    const net = scripted((url) => {
      if (url.pathname === "/search.php") {
        const query = url.searchParams.get("s")!;
        if (query === "edge") return new Response([card("a0b5"), card("a0b4")].join(""));
        const n = query.slice(1);
        return new Response(Array.from({ length: 15 }, (_, i) => card(`a${n}b${i}`)).join(""));
      }
      const slug = url.search.slice(1);
      probes.set(slug, (probes.get(slug) ?? 0) + 1);
      return new Response(`<a class='c' id="6f31e2ab5faa70eb14183e66185b46e3" href='gate.php'><div class='watch2'>1</div></a>`);
    });
    const source = animeHeavenSource({ fetch: net.fetch });
    for (let n = 0; n < 67; n++) expect(await source.search!(`q${n}`)).toHaveLength(15); // (1005 shows)
    await source.search!("edge");
    expect(probes.get("a0b5")).toBe(1); // (the thousandth newest is kept)
    expect(probes.get("a0b4")).toBe(2); // (the one before it is gone, and asked again)
    expect(probes.get("a66b14")).toBe(1);
  });
});
