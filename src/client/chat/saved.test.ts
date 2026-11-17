import { describe, expect, it } from "vitest";
import { pictureOf, savedPicture, toggleKept, type SavedPicture, type SavedPictures } from "./saved";

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
