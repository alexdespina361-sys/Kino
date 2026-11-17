import { describe, expect, it } from "vitest";
import { PERSONAL_STICKER_TEXT, type ChatLine } from "../../shared";
import { findInChat, fold, marked, mediaOf, wordsOf } from "./search";
import { STICKERS, stickerSrc } from "./stickers";
import { messageOf, titleIn } from "./titles";

const line = (id: number, text: string, extra: Partial<ChatLine> = {}): ChatLine => ({ id, at: id * 1000, mine: id % 2 === 0, text, ...extra });
const ORIGIN = "https://kino4tv.com";

describe("searching a chat", () => {
  it("folds capitals and accents, both of Romanian's s and t with a comma or a cedilla", () => {
    expect(fold("  Mâine   la ȘAPTE  ")).toBe("maine la sapte");
    expect(fold("Şapte ţigări")).toBe(fold("Șapte țigări"));
    expect(fold("ÎNTÂLNIRE à côté")).toBe("intalnire a cote");
  });

  it("finds the messages that hold every word typed, the newest first, however it was typed", () => {
    const lines = [line(1, "Ne vedem mâine la cinema"), line(2, "Mâine nu pot"), line(3, "ok"), line(4, "Poate MAINE seara la Cinema City")];
    expect(findInChat(lines, "maine")).toEqual([4, 2, 1]);
    expect(findInChat(lines, "cinema mâine")).toEqual([4, 1]);
    expect(findInChat(lines, "Cinema   CITY")).toEqual([4]);
    expect(findInChat(lines, "")).toEqual([]);
    expect(findInChat(lines, "   ")).toEqual([]);
    expect(findInChat(lines, "teatru")).toEqual([]);
  });

  it("looks only in words: never in a GIF's address, a sticker's code or a personal sticker, nor in a title's address", () => {
    const gif = line(1, "https://static.klipy.com/ii/abc/cat-dance.gif");
    const sticker = line(2, STICKERS[0]!.emoji);
    const personal = line(3, PERSONAL_STICKER_TEXT, { sticker: "A".repeat(22) });
    const title = line(4, messageOf({ address: "movie-603", title: "The Matrix", year: 1999 }, ORIGIN));
    const lines = [gif, sticker, personal, title];
    expect(wordsOf(gif)).toBe("");
    expect(wordsOf(sticker)).toBe("");
    expect(wordsOf(personal)).toBe("");
    expect(wordsOf(title)).toBe("The Matrix (1999)");
    for (const query of ["klipy", "dance", "gif", STICKERS[0]!.emoji, "AAAA", "kino4tv", "movie-603", "title="]) expect(findInChat(lines, query), query).toEqual([]);
    expect(findInChat(lines, "matrix")).toEqual([4]);
  });

  it("finds a title by its name once the chat knows it, when only its address was sent", () => {
    const only = line(5, `${ORIGIN}/tv?title=movie-603`);
    const id = titleIn(only.text)!.id;
    expect(findInChat([only], "matrix")).toEqual([]);
    const names = (asked: string) => (asked === id ? "The Matrix (1999)" : undefined);
    expect(findInChat([only], "matrix", names)).toEqual([5]);
    expect(findInChat([only], "603", names)).toEqual([]);
  });

  it("gathers the chat's pictures for its gallery, the newest first: GIFs, Kino's stickers and personal ones, and nothing else", () => {
    const lines = [
      line(1, "https://static.klipy.com/ii/abc/cat.gif"),
      line(2, "hello"),
      line(3, STICKERS[1]!.emoji),
      line(4, PERSONAL_STICKER_TEXT, { sticker: "B".repeat(22) }),
      line(5, PERSONAL_STICKER_TEXT, { sticker: "not a name" }),
      line(6, messageOf({ address: "movie-603", title: "The Matrix", year: 1999 }, ORIGIN)),
      line(7, "https://example.com/cat.gif"),
    ];
    expect(mediaOf(lines)).toEqual([
      { id: 4, at: 4000, mine: true, kind: "personal", sticker: "B".repeat(22) },
      { id: 3, at: 3000, mine: false, kind: "sticker", src: stickerSrc(STICKERS[1]!) },
      { id: 1, at: 1000, mine: false, kind: "gif", src: "https://static.klipy.com/ii/abc/cat.gif" },
    ]);
    expect(mediaOf([])).toEqual([]);
  });

  it("lights the words found as they were written, accents and capitals kept", () => {
    expect(marked("Ne vedem MÂINE la cinema", "maine")).toEqual([
      { text: "Ne vedem ", hit: false },
      { text: "MÂINE", hit: true },
      { text: " la cinema", hit: false },
    ]);
    expect(marked("Șapte și șapte", "sapte")).toEqual([
      { text: "Șapte", hit: true },
      { text: " și ", hit: false },
      { text: "șapte", hit: true },
    ]);
    // (a letter written with its accent apart, as some keyboards do, is lit whole)
    expect(marked("ăsta", "asta")).toEqual([{ text: "ăsta", hit: true }]);
    expect(marked("nothing here", "")).toEqual([{ text: "nothing here", hit: false }]);
    expect(marked("hello 👋 world", "world")).toEqual([
      { text: "hello 👋 ", hit: false },
      { text: "world", hit: true },
    ]);
  });
});
