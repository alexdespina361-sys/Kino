import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { profileStore } from "../account/store";
import { MediaGrid } from "./ChatMedia";
import { count, line, tagOf } from "./fixtures";
import { STICKERS, stickerSrc } from "./stickers";

const NOW = Date.UTC(2026, 10, 17, 15, 0);
const GIF = "https://static.klipy.com/ii/abc/def/sm/x.webp";

describe("the chat's GIFs and stickers", () => {
  const grid = (lines: Parameters<typeof MediaGrid>[0]["lines"]) => renderToStaticMarkup(createElement(MediaGrid, { lines, name: "Sam", now: NOW, onShow: () => {} }));

  it("are small squares, the newest first, each one's picture asked for only as it comes into view", () => {
    const html = grid([line(1, false, GIF), line(2, true, "hello"), line(3, true, STICKERS[0]!.emoji)]);
    expect(count(html, "chat-media-tile")).toBe(2);
    const first = tagOf(html, "chat-media-tile");
    expect(first).toContain('data-kind="sticker"');
    expect(html.indexOf(stickerSrc(STICKERS[0]!))).toBeLessThan(html.indexOf(GIF));
    expect(html).toContain('loading="lazy"');
    expect(html.toLowerCase()).toContain('referrerpolicy="no-referrer"');
  });

  it("say when there are none", () => {
    expect(grid([line(1, false, "hello")])).toContain('data-testid="chat-media-none"');
    expect(grid([])).toContain('data-testid="chat-media-none"');
  });

  it("on a child's profile are the stickers alone: no GIF, and nothing asked of KLIPY", () => {
    profileStore.setSetting("child", true);
    try {
      const html = grid([line(1, false, GIF), line(2, false, STICKERS[1]!.emoji)]);
      expect(count(html, "chat-media-tile")).toBe(1);
      expect(html).not.toContain("static.klipy.com");
      expect(grid([line(1, false, GIF)])).toContain('data-testid="chat-media-none"');
    } finally {
      profileStore.setSetting("child", undefined);
    }
  });
});
