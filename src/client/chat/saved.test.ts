import { describe, expect, it } from "vitest";
import { pictureOf, SAVED_MAX, savedPicture, savedPicturesOf, toggleKept, type SavedPicture, type SavedPictures } from "./saved";

const GIF = "https://static.klipy.com/ii/abc/de/sm/x.webp";

describe("which messages are pictures that can be saved", () => {
  it("is a GIF of KLIPY's, or one of Kino's stickers as the sticker sends it", () => {
    expect(pictureOf({ text: GIF })).toEqual({ kind: "gif", key: `gif:${GIF}`, text: GIF });
    expect(pictureOf({ text: ` ${GIF} ` })?.key).toBe(`gif:${GIF}`);
    expect(pictureOf({ text: "\u{1F37F}" })).toMatchObject({ kind: "sticker", key: "sticker:popcorn", text: "\u{1F37F}" });
    // (A heart typed without the mark is the same heart, kept as the sticker sends it.)
    expect(pictureOf({ text: "\u{2764}" })).toMatchObject({ key: "sticker:heart", text: "\u{2764}\u{FE0F}" });
  });

  it("is never words, an address of another host, or a personal sticker (which has Yours)", () => {
    expect(pictureOf({ text: "hello" })).toBeNull();
    expect(pictureOf({ text: "https://example.com/x.gif" })).toBeNull();
    expect(pictureOf({ text: `${GIF} and more` })).toBeNull();
    expect(pictureOf({ text: "\u{1F37F}", sticker: "st_abc" })).toBeNull();
  });

  it("shows a kept one only when what it says it is agrees with what it is", () => {
    expect(savedPicture({ key: `gif:${GIF}`, text: GIF })?.kind).toBe("gif");
    expect(savedPicture({ key: "sticker:popcorn", text: "\u{1F37F}" })?.kind).toBe("sticker");
    expect(savedPicture({ key: "sticker:heart", text: "\u{2764}" })).toBeNull(); // (not as the sticker sends it: a copy made by hand)
    expect(savedPicture({ key: "sticker:popcorn", text: "\u{1F3AC}" })).toBeNull();
    expect(savedPicture({ key: "gif:https://static.klipy.com/other.webp", text: GIF })).toBeNull();
    expect(savedPicture({ key: "gif:https://evil.example/x.gif", text: "https://evil.example/x.gif" })).toBeNull();
  });

  it("has no Save for a GIF whose address is too long for the profile to keep (it would have said Saved and kept nothing)", () => {
    const address = (length: number) => {
      const head = "https://static.klipy.com/ii/";
      return `${head}${"a".repeat(length - head.length - ".webp".length)}.webp`;
    };
    expect(address(396)).toHaveLength(396);
    expect(pictureOf({ text: address(396) })?.key).toHaveLength(400);
    expect(pictureOf({ text: address(397) })).toBeNull();
  });
});

describe("what the panel shows", () => {
  const keep = () => undefined;
  const gifs = (count: number) => Array.from({ length: count }, (_, n) => ({ key: `gif:https://static.klipy.com/ii/g${n}.webp`, text: `https://static.klipy.com/ii/g${n}.webp` }));

  it("is the kept ones that are pictures, GIFs and stickers apart, the newest first", () => {
    const shown = savedPicturesOf([{ key: "sticker:popcorn", text: "\u{1F37F}" }, ...gifs(2), { key: "sticker:nothing", text: "x" }], keep);
    expect(shown.stickers.map((picture) => picture.key)).toEqual(["sticker:popcorn"]);
    expect(shown.gifs.map((picture) => picture.key)).toEqual(["gif:https://static.klipy.com/ii/g0.webp", "gif:https://static.klipy.com/ii/g1.webp"]);
    expect(shown.has(pictureOf({ text: "\u{1F37F}" })!)).toBe(true);
    expect(shown.full).toBe(false);
  });

  it("is full when as many are kept as there can be, the ones it does not show counted too (one more would push the oldest out)", () => {
    expect(savedPicturesOf(gifs(SAVED_MAX - 1), keep).full).toBe(false);
    expect(savedPicturesOf(gifs(SAVED_MAX), keep).full).toBe(true);
    const withHidden = savedPicturesOf([...gifs(SAVED_MAX - 1), { key: "sticker:of-a-newer-set", text: "\u{1F9CB}" }], keep);
    expect(withHidden.gifs).toHaveLength(SAVED_MAX - 1);
    expect(withHidden.full).toBe(true);
  });
});

describe("Save on a message", () => {
  const kept = (has: boolean, full: boolean) => {
    const calls: Array<[string, boolean]> = [];
    const saved: SavedPictures = { gifs: [], stickers: [], has: () => has, full, keep: (picture, keep) => void calls.push([picture.key, keep]) };
    return { saved, calls };
  };
  const gif = pictureOf({ text: GIF }) as SavedPicture;
  const sticker = pictureOf({ text: "\u{1F37F}" }) as SavedPicture;

  it("saves it and says in which tab it is", () => {
    const { saved, calls } = kept(false, false);
    expect(toggleKept(saved, gif)).toBe("gif");
    expect(toggleKept(saved, sticker)).toBe("sticker");
    expect(calls).toEqual([
      [`gif:${GIF}`, true],
      ["sticker:popcorn", true],
    ]);
  });

  it("lets a saved one go, and pushes none out when as many are saved as there can be", () => {
    const one = kept(true, true);
    expect(toggleKept(one.saved, gif)).toBe("removed");
    expect(one.calls).toEqual([[`gif:${GIF}`, false]]);
    const full = kept(false, true);
    expect(toggleKept(full.saved, gif)).toBe("full");
    expect(full.calls).toEqual([]);
  });
});
