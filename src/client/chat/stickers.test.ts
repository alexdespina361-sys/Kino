import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkChatText } from "../../shared";
import { STICKERS, stickerOf, stickerSrc } from "./stickers";

describe("the chat's stickers", () => {
  it("are a message that is one of their emoji alone, with or without the picture mark, and nothing else", () => {
    expect(stickerOf("\u{1F37F}")?.id).toBe("popcorn");
    expect(stickerOf("  \u{1F37F} ")?.id).toBe("popcorn");
    expect(stickerOf("\u{2764}\u{FE0F}")?.id).toBe("heart");
    expect(stickerOf("\u{2764}")?.id).toBe("heart"); // (a heart typed without the mark is the same heart)
    expect(stickerOf("\u{1F37F}\u{1F37F}")).toBeNull(); // (two of them are text)
    expect(stickerOf("popcorn \u{1F37F}")).toBeNull();
    expect(stickerOf("\u{1F680}")).toBeNull(); // (an emoji that is not one of them)
    expect(stickerOf("")).toBeNull();
    expect(stickerOf("hi")).toBeNull();
  });

  it("each has its own emoji and its own file, which the server takes as any message", () => {
    expect(new Set(STICKERS.map((sticker) => sticker.emoji)).size).toBe(STICKERS.length);
    expect(new Set(STICKERS.map((sticker) => sticker.id)).size).toBe(STICKERS.length);
    const notice = readFileSync(join(process.cwd(), "public", "stickers", "NOTICE.txt"), "utf8");
    for (const sticker of STICKERS) {
      expect(stickerOf(sticker.emoji)).toBe(sticker);
      expect(checkChatText(sticker.emoji).ok, sticker.id).toBe(true);
      expect(existsSync(join(process.cwd(), "public", stickerSrc(sticker))), sticker.id).toBe(true);
      expect(notice, `${sticker.id} is in the notice`).toContain(`${sticker.id}.webp`);
    }
    expect(notice).toContain("MIT License");
  });
});
