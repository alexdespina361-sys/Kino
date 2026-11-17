import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PERSONAL_STICKER_TEXT, type ChatLine } from "../../shared";
import { ApiError } from "../account/api";
import { ChatLines, PERSONAL_RECHECK_MS, type PersonalLines } from "./ChatLines";
import { count, has, line, tagOf } from "./fixtures";
import { addProblemOf, chatStickerSrc, forgetPersonalStickers, keptCollection, lookAgain, ownStickerSrc, pictureSize, pixelBudget, StickerError, stickerPicture, tookCollection } from "./personalStickers";

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
    // (with the five minutes it is asked for in, so that one taken down goes from a chat that stays open)
    const period = Number(new RegExp(`src="/pictures/${SID}\\?v=(\\d+)"`).exec(picture)?.[1]);
    expect(Math.abs(period - Math.floor(Date.now() / PERSONAL_RECHECK_MS))).toBeLessThanOrEqual(1);
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

  it("can still be saved while the friend takes no messages (no reactions then), when a text of theirs can no longer be pressed", () => {
    const closed = lines({ personal: { ...personal, onSave: () => {} }, lines: [sticker(line(1, false)), line(2, false)], picked: 1, onPick: () => {} });
    expect(has(closed, "chat-sticker-save")).toBe(true);
    expect(count(closed, "chat-bubble")).toBe(1);
    expect(has(closed, "chat-react-bar")).toBe(false);
    // (and not in a report, where nothing is pressed)
    expect(has(lines({ personal: { ...personal, onSave: () => {} }, showWriter: true, picked: 1, onPick: () => {} }), "chat-sticker-save")).toBe(false);
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

  describe("how big a chosen picture is, read before it is opened", () => {
    const bytes = (...parts: Array<number[] | string>) => new Blob(parts.map((part) => (typeof part === "string" ? new TextEncoder().encode(part) : new Uint8Array(part))));
    const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    const u16be = (n: number) => [(n >>> 8) & 255, n & 255];
    const le = (n: number, length: number) => Array.from({ length }, (_, at) => (n >>> (8 * at)) & 255);

    it("reads a PNG's, and the three kinds of WebP's", async () => {
      expect(await pictureSize(bytes([0x89], "PNG\r\n\x1a\n", u32be(13), "IHDR", u32be(4000), u32be(3000), [8, 6, 0, 0, 0]))).toEqual({ width: 4000, height: 3000 });
      const riff = (kind: string, ...rest: number[][]) => bytes("RIFF", le(100, 4), "WEBP", kind, le(50, 4), ...rest);
      expect(await pictureSize(riff("VP8X", [0, 0, 0, 0], le(6143, 3), le(4095, 3)))).toEqual({ width: 6144, height: 4096 });
      expect(await pictureSize(riff("VP8 ", [0, 0, 0], [0x9d, 0x01, 0x2a], le(1024, 2), le(768, 2), [0, 0]))).toEqual({ width: 1024, height: 768 });
      expect(await pictureSize(riff("VP8L", [0x2f], le((499 | (399 << 14)) >>> 0, 4), [0, 0, 0, 0, 0]))).toEqual({ width: 500, height: 400 });
    });

    it("finds a JPEG's frame header after what a camera wrote first, stepping over it", async () => {
      const notes = [0xff, 0xe1, ...u16be(2 + 5000), ...new Array(5000).fill(7)];
      const frame = (marker: number) => [0xff, marker, ...u16be(17), 8, ...u16be(4000), ...u16be(6000), 3];
      expect(await pictureSize(bytes([0xff, 0xd8], notes, [0xff], frame(0xc0), [0xff, 0xd9]))).toEqual({ width: 6000, height: 4000 });
      expect(await pictureSize(bytes([0xff, 0xd8], frame(0xc2)))).toEqual({ width: 6000, height: 4000 }); // (progressive)
      // (a table that is not a frame header is stepped over too)
      expect(await pictureSize(bytes([0xff, 0xd8, 0xff, 0xc4, ...u16be(4), 0, 0], frame(0xc1)))).toEqual({ width: 6000, height: 4000 });
      // (none before the picture's data, or the file ends: it does not say)
      expect(await pictureSize(bytes([0xff, 0xd8, 0xff, 0xda, ...u16be(8), 0, 0, 0, 0, 0, 0], frame(0xc0)))).toBeNull();
      expect(await pictureSize(bytes([0xff, 0xd8], notes))).toBeNull();
    });

    it("does not say for another kind of picture, nor for what is not one", async () => {
      expect(await pictureSize(bytes("GIF89a", le(100, 2), le(100, 2), new Array(30).fill(0)))).toBeNull();
      expect(await pictureSize(bytes([0, 0, 0, 0x18], "ftypheic", new Array(30).fill(0)))).toBeNull();
      expect(await pictureSize(bytes("hello"))).toBeNull();
      expect(await pictureSize(new Blob([]))).toBeNull();
    });

    it("allows so many megapixels for each gigabyte of the phone: real phones' photos open where they are taken, and more is turned away without opening it", async () => {
      const fits = (width: number, height: number, gb: number | undefined) => width * height <= pixelBudget(gb);
      // (a usual photo, 12.2 and 16 megapixels, on any phone, the smallest Chrome says included)
      for (const gb of [0.25, 0.5, 1, undefined]) expect(fits(4032, 3024, gb) && fits(4608, 3456, gb), String(gb)).toBe(true);
      // (48 and 50 megapixels: an iPhone's, whose Safari does not say its memory, and a phone of 4 GB)
      for (const gb of [undefined, 4]) expect(fits(8064, 6048, gb) && fits(8000, 6000, gb) && fits(8160, 6120, gb) && fits(8192, 6144, gb), String(gb)).toBe(true);
      // (108 on a phone of 8, which is the most Chrome says; 200 nowhere: 800 MB at once)
      expect(fits(12_000, 9000, 8)).toBe(true);
      expect(fits(12_000, 9000, 2)).toBe(false);
      expect(fits(16_320, 12_240, 8)).toBe(false);
      expect([pixelBudget(1), pixelBudget(2), pixelBudget(32)]).toEqual([16_000_000, 28_000_000, 112_000_000]);
      const huge = bytes([0x89], "PNG\r\n\x1a\n", u32be(13), "IHDR", u32be(20_000), u32be(20_000), [8, 6, 0, 0, 0]);
      await expect(stickerPicture(huge)).rejects.toMatchObject({ problem: "too_big" });
    });
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

    it("takes an answer about one profile when another profile's collection changed meanwhile", async () => {
      fake();
      tookCollection("p", { stickers: [] });
      const looked = lookAgain("p");
      tookCollection("q", { stickers: [{ id: OTHER, mine: true }] });
      answers[0]!([{ id: SID, mine: true }]);
      await looked;
      expect(keptCollection("p")).toEqual([{ id: SID, mine: true }]);
      expect(keptCollection("q")).toEqual([{ id: OTHER, mine: true }]);
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
