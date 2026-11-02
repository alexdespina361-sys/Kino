import { describe, expect, it } from "vitest";
import { decodeEntities, extractMedia, mediaUrlsIn, streamTypeOf, tags } from "./html-extract";

const page = new URL("https://site.example/movies/42/watch");
const extract = (html: string) => extractMedia(html, page);
const urls = (html: string) => extract(html).candidates.map((c) => [c.strategy, c.type, c.url]);

describe("html5 <video>", () => {
  it("reads <video src> and resolves relative URLs against the page", () => {
    expect(urls('<video src="/media/a.mp4"></video>')).toEqual([["html5-video", "mp4", "https://site.example/media/a.mp4"]]);
    expect(urls('<video src="clip.m3u8" controls></video>')).toEqual([["html5-video", "hls", "https://site.example/movies/42/clip.m3u8"]]);
  });

  it("reads <source> children, using the type attribute over the extension", () => {
    const html = `<video controls>
      <source src="/v/stream?id=7" type="application/x-mpegURL">
      <source src="/v/fallback.mp4" type="video/mp4">
      <source src="/v/other.webm" type="video/webm">
    </video>`;
    expect(urls(html)).toEqual([
      ["html5-video", "hls", "https://site.example/v/stream?id=7"],
      ["html5-video", "mp4", "https://site.example/v/fallback.mp4"],
    ]);
  });

  it("decodes &amp; in attributes and ignores blob:/data: sources", () => {
    expect(urls('<video src="/a.mp4?x=1&amp;y=2"></video>')[0]![2]).toBe("https://site.example/a.mp4?x=1&y=2");
    expect(urls('<video src="blob:https://site.example/uuid"></video><video src="data:video/mp4;base64,AAAA"></video>')).toEqual([]);
  });

  it("handles attribute quoting styles and a self-closed/unclosed video tag", () => {
    expect(urls("<video src='/q.mp4'>")).toHaveLength(1);
    expect(urls("<video src=/u.mp4 controls></video>")[0]![2]).toBe("https://site.example/u.mp4");
  });
});

describe("other strategies", () => {
  it("reads JSON-LD VideoObject (also nested in @graph) and its name", () => {
    const html = `<script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":"VideoObject","name":"Big Movie","contentUrl":"https://cdn.example/m/master.m3u8"}]}</script>`;
    const result = extract(html);
    expect(result.candidates[0]).toMatchObject({ strategy: "json-ld", type: "hls", url: "https://cdn.example/m/master.m3u8" });
    expect(result.title).toBe("Big Movie");
  });

  it("survives broken JSON-LD", () => {
    expect(extract('<script type="application/ld+json">{oops</script>').candidates).toEqual([]);
  });

  it("trusts og:video only when it is clearly media, not an HTML embed page", () => {
    expect(urls('<meta property="og:video" content="https://site.example/embed/42">')).toEqual([]);
    expect(urls('<meta property="og:video" content="https://cdn.example/v.mp4">')).toEqual([["open-graph", "mp4", "https://cdn.example/v.mp4"]]);
    expect(urls('<meta property="og:video:url" content="https://cdn.example/play?id=1"><meta property="og:video:type" content="application/vnd.apple.mpegurl">')).toEqual([
      ["open-graph", "hls", "https://cdn.example/play?id=1"],
    ]);
  });

  it("finds plain media URLs in inline scripts, including JSON-escaped ones", () => {
    const html = String.raw`<script>window.cfg={"file":"https:\/\/cdn.example\/h\/master.m3u8?t=1&s=2","other":"x"}</script>`;
    expect(urls(html)).toEqual([["url-pattern", "hls", "https://cdn.example/h/master.m3u8?t=1&s=2"]]);
  });

  it("returns nothing for a page without media", () => {
    expect(extract("<html><body><h1>Hello</h1><a href='/x.pdf'>pdf</a></body></html>").candidates).toEqual([]);
  });
});

describe("candidate ranking", () => {
  it("orders by confidence: html5-video > json-ld > open-graph > url-pattern", () => {
    const html = `
      <meta property="og:video" content="https://cdn.example/og.mp4">
      <script>var u = "https://cdn.example/pattern.mp4";</script>
      <script type="application/ld+json">{"@type":"VideoObject","contentUrl":"https://cdn.example/ld.mp4"}</script>
      <video src="https://cdn.example/video.mp4"></video>`;
    expect(extract(html).candidates.map((c) => c.strategy)).toEqual(["html5-video", "json-ld", "open-graph", "url-pattern"]);
  });

  it("de-duplicates the same URL, keeping the most confident strategy", () => {
    const html = `<video src="https://cdn.example/a.mp4"></video><script>x="https://cdn.example/a.mp4"</script>`;
    expect(extract(html).candidates).toEqual([{ url: "https://cdn.example/a.mp4", type: "mp4", strategy: "html5-video", confidence: 0.99 }]);
  });

  it("takes the title from og:title, then <title>", () => {
    expect(extract('<title>Page &amp; Co</title><meta property="og:title" content="OG Title">').title).toBe("OG Title");
    expect(extract("<title>  Page &amp;\n Co </title>").title).toBe("Page & Co");
    expect(extract('<meta property="og:title" content="Elephants Dream : Free Download, Borrow, and Streaming : Internet Archive">').title).toBe("Elephants Dream");
  });
});

describe("helpers", () => {
  it("streamTypeOf", () => {
    expect(streamTypeOf("https://x/a.M3U8?t=1")).toBe("hls");
    expect(streamTypeOf("https://x/a.mp4#t=10")).toBe("mp4");
    expect(streamTypeOf("https://x/a")).toBeNull();
    expect(streamTypeOf("https://x/a.mp4", "video/webm")).toBeNull();
  });

  it("decodeEntities handles named, decimal and hex, and leaves unknowns", () => {
    expect(decodeEntities("a&amp;b &#39;q&#39; &#x41; &unknown;")).toBe("a&b 'q' A &unknown;");
  });

  it("decodeEntities leaves a name that only every object has alone, instead of printing the function behind it", () => {
    expect(decodeEntities("&constructor; &toString; &hasOwnProperty; &valueOf;")).toBe("&constructor; &toString; &hasOwnProperty; &valueOf;");
  });
});

describe("a page that is made to be slow to read", () => {
  // The resolver reads up to 2 MiB of any page it is sent to, and the whole server waits meanwhile. Each of these cost the square of the page's length
  // (about a minute for 512 KiB of the worst; many minutes for 2 MiB).
  const fill = (piece: string, bytes = 512 * 1024) => piece.repeat(Math.ceil(bytes / piece.length));
  const shapes: [string, string][] = [
    ["video tags that are never closed", fill("<video>")],
    ["video tags that never end", fill("<video ")],
    ["meta tags that never end", fill("<meta ")],
    ["JSON-LD scripts that are never closed", fill('<script type="application/ld+json">')],
    ["script tags that never end", fill("<script ")],
    ["title tags that are never closed", fill("<title>")],
    ["source tags that never end inside a video", "<video>" + fill("<source ")],
    ["track tags that never end inside a video", "<video>" + fill("<track ") + "</video>"],
    ["http:// over and over in one word", fill("http://")],
    ["=// over and over in one word", fill("=//")],
    ["a title of nothing but white space", `<meta property="og:title" content="${" ".repeat(512 * 1024)}">`],
    // (A tag runs on to the first `>`, so a `>` far on is one tag that is read once, and none at all is no tag.)
    ["video tags with one > at the very end", fill("<video ") + ">"],
    ["meta tags with one > at the very end", fill("<meta ") + ">"],
    ["source tags with one > at the very end of a video", "<video>" + fill("<source ") + "></video>"],
    ["a > only after every start, and a closing tag that is never there", fill("<video <video <video >")],
  ];

  it.each(shapes)("is read in a moment: %s", (_name, html) => {
    const started = performance.now();
    extract(html);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("still finds the video that comes after all that", () => {
    expect(urls(fill("<video ", 64 * 1024) + '<video src="/found.mp4"></video>')).toEqual([["html5-video", "mp4", "https://site.example/found.mp4"]]);
    expect(urls(fill("http://", 64 * 1024) + ' "https://cdn.example/found.m3u8"')).toEqual([["url-pattern", "hls", "https://cdn.example/found.m3u8"]]);
  });

  it("goes through no more than 10,000 tags of one kind", () => {
    expect([...tags("<b>".repeat(20_000), "b")]).toHaveLength(10_000);
  });
});

describe("the scans find what the plain patterns find", () => {
  // The plain patterns are what the scans replaced: simple, and slow on a page like the ones above. On any small text they must give the same answer,
  // including a text with a `<` inside a tag (`<video a<b>` is a tag, as it is for a browser's first look at it).
  const random = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const textOf = (pieces: string[], next: () => number, longest: number) =>
    Array.from({ length: Math.floor(next() * longest) }, () => pieces[Math.floor(next() * pieces.length)]).join("");

  it("media URLs written out in a text", () => {
    const pieces = ["http://", "https://", "HTTP://", "//", "=", '"', "'", " ", "\n", "a", "b/", "x=1", ".mp4", ".m3u8", ".MP4", "?", ".", "mp4", "(", ")", "<", ">", "\\", "&", ":"];
    const plain = (text: string) => [
      ...[...text.matchAll(/https?:\/\/[^\s"'<>\\()]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\()]*)?/gi)].map((m) => ({ raw: m[0], confidence: 0.5 })),
      ...[...text.matchAll(/(?:^|["'\s=])(\/\/[^\s"'<>\\()]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\()]*)?)/gi)].map((m) => ({ raw: m[1]!, confidence: 0.45 })),
    ];
    const next = random(7);
    for (let round = 0; round < 6000; round++) {
      const text = textOf(pieces, next, 40);
      expect(mediaUrlsIn(text), JSON.stringify(text)).toEqual(plain(text));
    }
  });

  it("tags, with what is inside them for the ones that have an end", () => {
    const pieces = ["<video", "<video>", "</video>", "</VIDEO>", "<script", " type=application/ld+json", ' type="application/ld+json"', "</script>", "<title>", "</title>", "<meta ", "<", ">", " ", "a=b", '"', "x"];
    const ldJson = (attrs: string) => /type\s*=\s*["']?application\/ld\+json/i.test(attrs);
    const next = random(11);
    for (let round = 0; round < 6000; round++) {
      const html = textOf(pieces, next, 30);
      const why = JSON.stringify(html);
      const plainVideos = [...html.matchAll(/<video\b([^>]*)>([\s\S]*?)<\/video>|<video\b([^>]*)>/gi)].map((m) => ({ attrs: m[1] ?? m[3], inner: m[2] }));
      expect([...tags(html, "video", () => true)], why).toEqual(plainVideos);
      const plainScripts = [...html.matchAll(/<script\b([^>]*type\s*=\s*["']?application\/ld\+json[^>]*)>([\s\S]*?)<\/script>/gi)].map((m) => m[2]);
      expect([...tags(html, "script", ldJson)].filter((tag) => tag.inner !== undefined).map((tag) => tag.inner), why).toEqual(plainScripts);
      const plainTitle = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
      expect([...tags(html, "title", () => true)][0]?.inner, why).toEqual(plainTitle);
      expect([...tags(html, "meta")].map((tag) => tag.attrs), why).toEqual([...html.matchAll(/<meta\b([^>]*)>/gi)].map((m) => m[1]));
    }
  });

  it("a tag with a `<` inside it is a tag, as it always was", () => {
    expect(urls('<video data-note="1 < 2" src="/a.mp4"></video>')).toEqual([["html5-video", "mp4", "https://site.example/a.mp4"]]);
    expect(urls('<video\n<source src="/b.mp4" type="video/mp4">')).toEqual([["html5-video", "mp4", "https://site.example/b.mp4"]]);
  });
});

describe("what a page can make of the answer", () => {
  // A page decides how many addresses and tracks it lists and how long each is, and what is found goes to every screen that watches. A screen throws a message
  // away whole when an address in it is longer than 2048 characters, a label longer than 100 or a language longer than 20: then the video never starts.
  const track = (n: number) => `<track src="/s${n}.vtt" label="${"L".repeat(300)}" srclang="${"x".repeat(50)}">`;

  it("gives a video the first 40 of its subtitle tracks, each with a label and a language a screen takes", () => {
    const subtitles = extract(`<video src="/a.mp4">${Array.from({ length: 200 }, (_, n) => track(n)).join("")}</video>`).candidates[0]!.subtitles!;
    expect(subtitles).toHaveLength(40);
    expect(subtitles.map((subtitle) => subtitle.url)).toEqual(Array.from({ length: 40 }, (_, n) => `https://site.example/s${n}.vtt`));
    for (const subtitle of subtitles) {
      expect(subtitle.label).toHaveLength(100);
      expect(subtitle.lang).toHaveLength(20);
    }
  });

  it("leaves out an address longer than 2048 characters and keeps one of exactly that length", () => {
    const start = "https://site.example/";
    const address = (length: number) => start + "b".repeat(length - start.length - ".mp4".length) + ".mp4";
    expect(urls(`<video src="${address(2048)}"></video>`)).toEqual([["html5-video", "mp4", address(2048)]]);
    expect(urls(`<video src="${address(2049)}"></video>`)).toEqual([]);
    expect(urls(`<video><source src="${address(3000)}" type="video/mp4"><source src="/ok.mp4" type="video/mp4"></video>`)).toEqual([["html5-video", "mp4", "https://site.example/ok.mp4"]]);
    // (A track with such an address is left out of the menu, not the video.)
    expect(extract(`<video src="/a.mp4"><track src="${address(2049)}"><track src="/ok.vtt"></video>`).candidates[0]!.subtitles).toEqual([
      { id: 0, url: "https://site.example/ok.vtt", label: "Subtitle 1", lang: undefined },
    ]);
  });

  it("takes the first 1000 media addresses written out in a text, and no more", () => {
    expect(mediaUrlsIn("https://cdn.example/a.mp4 ".repeat(5000))).toHaveLength(1000);
    expect(mediaUrlsIn(" //cdn.example/a.mp4".repeat(5000))).toHaveLength(1000);
    expect(mediaUrlsIn("https://cdn.example/a.mp4 ".repeat(999))).toHaveLength(999);
  });
});
