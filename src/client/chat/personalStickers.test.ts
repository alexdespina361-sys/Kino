import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PERSONAL_STICKER_TEXT, type ChatLine } from "../../shared";
import { ApiError } from "../account/api";
import { ChatLines, type PersonalLines } from "./ChatLines";
import { count, has, line, tagOf } from "./fixtures";
import { addProblemOf, chatStickerSrc, forgetPersonalStickers, keptCollection, lookAgain, ownStickerSrc, StickerError, tookCollection } from "./personalStickers";

const NOW = Date.UTC(2026, 9, 18, 15, 0);
const SID = "Abcdefghijklmnopqrstuv";
const sticker = (base: ChatLine): ChatLine => ({ ...base, text: PERSONAL_STICKER_TEXT, sticker: SID });
const personal: PersonalLines = { src: (id) => `/pictures/${id}` };
const lines = (props: Partial<Parameters<typeof ChatLines>[0]> = {}) =>
  renderToStaticMarkup(createElement(ChatLines, { lines: [sticker(line(1, false)), line(2, true)], name: "Sam", now: NOW, ...props }));

describe("a message that is a personal sticker", () => {
  it("is its picture, from this chat's address, big and without a bubble, saying whose it is", () => {
    const html = lines({ personal });
    const picture = tagOf(html, "chat-personal-sticker")!;
    expect(picture).toContain(`src="/pictures/${SID}"`);
    expect(picture).toContain('alt="A sticker from Sam"');
    expect(picture).toContain('loading="lazy"');
    expect(html).toContain("chat-bubble-sticker");
    expect(html).not.toContain(PERSONAL_STICKER_TEXT);
  });

  it("says it is not available while they are off (no address to ask), and is never taken for a built-in sticker, a GIF or a title", () => {
    const html = lines({});
    expect(has(html, "chat-personal-gone")).toBe(true);
    expect(html).toContain("A sticker that is no longer available");
    expect(count(html, "chat-sticker")).toBe(0);
    // (a line with a name that is also the address of a GIF or a title, or a built-in sticker's emoji, is still the personal sticker)
    const odd = lines({ personal, lines: [{ ...sticker(line(1, false)), text: "\u{1F525}" }] });
    expect(has(odd, "chat-personal-sticker")).toBe(true);
    expect(has(odd, "chat-sticker")).toBe(false);
  });

  it("can be saved from a friend's message once it is pressed, and says so when it is in one's stickers already", () => {
    const saved: string[] = [];
    const open = (has_: boolean) =>
      lines({ personal: { ...personal, onSave: (id) => void saved.push(id), has: () => has_ }, picked: 1, onPick: () => {}, onReact: () => {} });
    const fresh = open(false);
    expect(tagOf(fresh, "chat-sticker-save")).not.toContain("disabled");
    expect(fresh).toContain("Save to my stickers");
    const already = open(true);
    expect(tagOf(already, "chat-sticker-save")).toContain("disabled");
    expect(already).toContain("In your stickers");
    // (not one's own, not one that is not pressed, and not without a way to save)
    expect(has(lines({ personal: { ...personal, onSave: () => {} }, lines: [sticker(line(1, true))], picked: 1, onPick: () => {}, onReact: () => {} }), "chat-sticker-save")).toBe(false);
    expect(has(lines({ personal: { ...personal, onSave: () => {} }, onPick: () => {}, onReact: () => {} }), "chat-sticker-save")).toBe(false);
    expect(has(lines({ personal, picked: 1, onPick: () => {}, onReact: () => {} }), "chat-sticker-save")).toBe(false);
  });

  it("is drawn in a report too, with who sent it: its picture goes with the report", () => {
    const html = lines({ personal, showWriter: true });
    expect(has(html, "chat-personal-sticker")).toBe(true);
    expect(html).toContain("chat-writer");
  });
});

describe("the page's side of personal stickers", () => {
  it("asks for each picture at an address of its own profile, or of the chat", () => {
    expect(ownStickerSrc("p 1", SID)).toBe(`/api/profiles/p%201/stickers/${SID}`);
    expect(chatStickerSrc("p1", "f/2", SID)).toBe(`/api/profiles/p1/friends/f%2F2/chat/stickers/${SID}`);
  });

  it("says what went wrong in the picker's words", () => {
    expect(addProblemOf(new StickerError("too_big"))).toBe("too_big");
    expect(addProblemOf(new ApiError(400, "not_a_picture"))).toBe("not_a_picture");
    expect(addProblemOf(new ApiError(409, "full"))).toBe("full");
    expect(addProblemOf(new ApiError(429, "rate_limited", 60))).toBe("too_many");
    expect(addProblemOf(new ApiError(429, "too_many", 60))).toBe("too_many");
    expect(addProblemOf(new ApiError(503, "site_full"))).toBe("site_full");
    expect(addProblemOf(new ApiError(0, "offline"))).toBe("failed");
    expect(addProblemOf(new Error("anything"))).toBe("failed");
  });

  describe("asking again when the stickers are opened", () => {
    const OTHER = "Zyxwvutsrqponmlkjihgfe";
    /** The server's answers, given out when the test says. */
    const answers: Array<(stickers: Array<{ id: string; mine: boolean }> | null) => void> = [];
    const fake = () =>
      vi.stubGlobal(
        "fetch",
        vi.fn(
          () =>
            new Promise<Response>((resolve, reject) =>
              answers.push((stickers) => (stickers ? resolve(new Response(JSON.stringify({ stickers }), { status: 200 })) : reject(new TypeError("offline")))),
            ),
        ),
      );
    afterEach(() => {
      vi.unstubAllGlobals();
      answers.length = 0;
      forgetPersonalStickers();
    });

    it("takes what another screen of the profile added", async () => {
      fake();
      tookCollection("p", { stickers: [] });
      const looked = lookAgain("p");
      answers[0]!([{ id: SID, mine: true }]);
      await looked;
      expect(keptCollection("p")).toEqual([{ id: SID, mine: true }]);
    });

    it("never undoes a change made on this page while it was asking, and changes nothing when there is no answer", async () => {
      fake();
      tookCollection("p", { stickers: [] });
      const looked = lookAgain("p");
      tookCollection("p", { stickers: [{ id: OTHER, mine: true }] }); // (one made here, meanwhile)
      answers[0]!([]);
      await looked;
      expect(keptCollection("p")).toEqual([{ id: OTHER, mine: true }]);
      const failed = lookAgain("p");
      answers[1]!(null);
      await failed;
      expect(keptCollection("p")).toEqual([{ id: OTHER, mine: true }]);
    });
  });
});
