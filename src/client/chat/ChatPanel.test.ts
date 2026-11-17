import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatPanel, PANEL_TAB_KEY, savedTab } from "./ChatPanel";
import { count, fakeSession, has, tagOf } from "./fixtures";
import { STICKERS } from "./stickers";

/** A browser's storage holding `saved` (or one that refuses to be read). */
const storage = (saved: string | null, refuses = false) =>
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => {
        if (refuses) throw new Error("SecurityError");
        return key === PANEL_TAB_KEY ? saved : null;
      },
      setItem: () => {},
    },
  });

describe("the chat's panel of titles, GIFs and stickers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const panel = (props: Partial<Parameters<typeof ChatPanel>[0]> = {}) =>
    renderToStaticMarkup(createElement(ChatPanel, { session: fakeSession(), tv: false, nav: false, land: false, pointer: true, gifKey: "key", onClose: () => {}, onSent: () => {}, ...props }));

  it("has a tab each, at its foot, and opens on the stickers the first time", () => {
    const html = panel();
    expect(count(html, "chat-panel-tab")).toBe(3);
    expect(html.indexOf('data-testid="chat-panel-pane"'), "the tabs at the foot").toBeLessThan(html.indexOf('data-testid="chat-panel-tab"'));
    expect(html).toContain('role="tablist"');
    expect(tagOf(html, "chat-panel")).toContain('data-tab="stickers"');
    expect(count(html, "chat-sticker-pick")).toBe(STICKERS.length);
    expect(has(html, "chat-gif-search"), "the GIFs are not drawn, and KLIPY not asked").toBe(false);
    expect(html.match(/aria-selected="true"[^>]*data-tab="stickers"/), "the stickers' tab is the one chosen").not.toBeNull();
  });

  it("opens on the tab used last, on this browser; nothing kept, a storage that refuses, or words it never wrote: the stickers", () => {
    storage("titles");
    expect(savedTab()).toBe("titles");
    expect(tagOf(panel(), "chat-panel")).toContain('data-tab="titles"');
    storage("gifs");
    expect(tagOf(panel(), "chat-panel")).toContain('data-tab="gifs"');
    expect(has(panel(), "chat-gif-search")).toBe(true);
    for (const [saved, refuses] of [[null, false], ["titles", true], ["everything", false]] as const) {
      storage(saved, refuses);
      expect(savedTab(), `${saved} ${refuses}`).toBe("stickers");
    }
  });

  it("has no GIFs where the screen cannot type a search or the site has no KLIPY key: the GIFs kept as the last tab open the stickers", () => {
    storage("gifs");
    const html = panel({ gifKey: null });
    expect(count(html, "chat-panel-tab")).toBe(2);
    expect(html).not.toContain('data-tab="gifs"');
    expect(tagOf(html, "chat-panel")).toContain('data-tab="stickers"');
  });

  it("on the TV's pages is walked with the arrows, a TV that is only a remote landing on the first sticker", () => {
    const html = panel({ tv: true, nav: true, land: true, pointer: false, gifKey: null });
    expect(has(html, "tv-chat-panel")).toBe(true);
    for (const id of ["tv-chat-panel-tab", "chat-sticker-pick"]) expect(tagOf(html, id), id).toContain("data-nav");
    expect(tagOf(html, "chat-sticker-pick")).toContain("data-autofocus");
    expect(panel(), "the phone's: a finger's, no stops for the arrows").not.toContain("data-nav");
  });
});
