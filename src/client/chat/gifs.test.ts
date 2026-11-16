import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatLines } from "./ChatLines";
import { line } from "./fixtures";
import { gifOf, gifPageOf, GIFS_PER_PAGE, klipyAddress, klipyLocale } from "./gifs";

const GIF = "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/SE72470w.webp";

describe("a message that is a GIF", () => {
  it("is the whole text, the https address of a GIF or WebP on one of KLIPY's hosts, given back as written", () => {
    expect(gifOf(GIF)).toBe(GIF);
    expect(gifOf(`  ${GIF}  `)).toBe(GIF);
    expect(gifOf("https://static1.klipy.com/a/b.gif")).toBe("https://static1.klipy.com/a/b.gif");
    expect(gifOf("https://static2.klipy.com/a/b.GIF")).toBe("https://static2.klipy.com/a/b.GIF");
    // (KLIPY's rule: the address as they gave it, its query too)
    expect(gifOf("https://static.klipy.com/a/b.webp?v=2&t=x")).toBe("https://static.klipy.com/a/b.webp?v=2&t=x");
  });

  it("is not anything else: other words, another host (however it is dressed up), another kind of file, another scheme", () => {
    for (const text of [
      `Look ${GIF}`,
      `${GIF} lol`,
      `${GIF}\n${GIF}`,
      "http://static.klipy.com/a/b.gif",
      "https://static.klipy.com.evil.example/a/b.gif",
      "https://evil.example/static.klipy.com/a/b.gif",
      "https://evil.example/a/b.gif?u=https://static.klipy.com/c.gif",
      "https://user:pass@static.klipy.com/a/b.gif",
      "https://static.klipy.com@evil.example/a/b.gif",
      "https://static.klipy.com\\@evil.example/a/b.gif",
      "https://static.klipy.com:8443/a/b.gif",
      "https://static.klipy.com/a/b.gif#x",
      "https://STATIC.klipy.com/a/b.gif",
      "https://api.klipy.com/a/b.gif",
      "https://klipy.com/a/b.gif",
      "https://static3.klipy.com/a/b.gif",
      "https://static.klipy.com/a/b.mp4",
      "https://static.klipy.com/a/b.svg",
      "https://static.klipy.com/a/b.gif.html",
      "https://static.klipy.com/",
      "javascript:alert(1)//static.klipy.com/a.gif",
      "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
      `https://static.klipy.com/${"a".repeat(400)}.gif`,
      "",
    ]) {
      expect(gifOf(text), text).toBeNull();
    }
  });

  it("shows as the picture in the chat, never a link, with its time; any other text stays text", () => {
    const html = renderToStaticMarkup(createElement(ChatLines, { lines: [{ ...line(1, false), text: GIF }, { ...line(2, true), text: `see ${GIF}` }], name: "Sam", now: Date.UTC(2026, 9, 18, 15) }));
    const picture = /<img[^>]*data-testid="chat-gif"[^>]*>/.exec(html)?.[0] ?? "";
    expect(picture).toContain(`src="${GIF}"`);
    expect(picture).toContain('referrerPolicy="no-referrer"');
    expect(picture).toContain('alt="GIF"');
    expect(html).not.toContain("<a ");
    expect(html.split('data-testid="chat-gif"').length - 1).toBe(1);
    expect(html).toContain(`see ${GIF}`); // (the second is words with an address in them: text)
    expect(html).toContain("chat-bubble-gif");
  });

  it("is its address, as it would be sent, in what a report shows", () => {
    const html = renderToStaticMarkup(createElement(ChatLines, { lines: [{ ...line(1, false), text: GIF }], name: "Sam", now: Date.UTC(2026, 9, 18, 15), showWriter: true }));
    expect(html).not.toContain('data-testid="chat-gif"');
    expect(html).toContain(GIF);
  });
});

const file = (url: string, width = 220, height = 180) => ({ url, width, height, size: 1000 });
const entry = (slug: string, files: Record<string, Record<string, unknown>>) => ({ id: 1, slug, title: `T ${slug}`, file: files, type: "gif" });

describe("KLIPY's answer, as the grid shows it", () => {
  it("keeps KLIPY's order and every GIF, with a small WebP to show and the sm WebP to send", () => {
    const answer = {
      result: true,
      data: {
        data: [
          entry("b", { sm: { webp: file("https://static.klipy.com/b-sm.webp"), gif: file("https://static.klipy.com/b-sm.gif") }, xs: { webp: file("https://static.klipy.com/b-xs.webp", 90, 70) } }),
          entry("a", { md: { gif: file("https://static1.klipy.com/a-md.gif", 498, 300) } }),
        ],
        current_page: 1,
        per_page: 24,
        has_next: true,
      },
    };
    const page = gifPageOf(answer);
    expect(page.more).toBe(true);
    expect(page.gifs.map((gif) => gif.slug)).toEqual(["b", "a"]);
    expect(page.gifs[0]).toEqual({ slug: "b", title: "T b", thumb: "https://static.klipy.com/b-sm.webp", width: 220, height: 180, sent: "https://static.klipy.com/b-sm.webp" });
    expect(page.gifs[1]!.sent).toBe("https://static1.klipy.com/a-md.gif");
  });

  it("can draw nothing that has no picture of KLIPY's (an ad left on in the panel, an address on another host), and says when there is no next page", () => {
    const page = gifPageOf({ data: { data: [{ type: "ad", content: "<div>ad</div>" }, entry("x", { sm: { webp: file("https://evil.example/x.webp") } }), entry("y", { sm: { webp: file("https://static.klipy.com/y.webp") } })], has_next: false } });
    expect(page.gifs.map((gif) => gif.slug)).toEqual(["y"]);
    expect(page.more).toBe(false);
  });

  it("is empty, not an error, for an answer of another shape", () => {
    for (const answer of [null, {}, { data: null }, { data: { data: "x" } }, "text"]) expect(gifPageOf(answer)).toEqual({ gifs: [], more: false });
  });
});

describe("what is asked of KLIPY", () => {
  it("is Trending without words and Search with them, a page of 24, the browser's own number, the country, and KLIPY's own filter (the strictest for a child)", () => {
    const trending = new URL(klipyAddress("Key_123-abc", { query: "  ", page: 1, customer: "c-1", locale: "ro" }));
    expect(`${trending.origin}${trending.pathname}`).toBe("https://api.klipy.com/api/v1/Key_123-abc/gifs/trending");
    expect(Object.fromEntries(trending.searchParams)).toEqual({ page: "1", per_page: String(GIFS_PER_PAGE), customer_id: "c-1", locale: "ro", content_filter: "medium" });
    const search = new URL(klipyAddress("Key_123-abc", { query: " happy cat ", page: 3, customer: "c-1", locale: "us", strict: true }));
    expect(search.pathname).toBe("/api/v1/Key_123-abc/gifs/search");
    expect(search.searchParams.get("q")).toBe("happy cat");
    expect(search.searchParams.get("page")).toBe("3");
    expect(search.searchParams.get("content_filter")).toBe("high");
  });

  it("names the country of the browser, else the one of the site's language", () => {
    expect(klipyLocale("en", "ro-RO")).toBe("ro");
    expect(klipyLocale("ro", "en-GB")).toBe("gb");
    expect(klipyLocale("it", "it")).toBe("it");
    expect(klipyLocale("ro", "")).toBe("ro");
    expect(klipyLocale("en", "en")).toBe("us");
  });
});
