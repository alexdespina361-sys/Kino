import { describe, expect, it } from "vitest";
import { decodeEntities, extractMedia, streamTypeOf } from "./html-extract";

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
});
