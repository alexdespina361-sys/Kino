/**
 * The chat's own stickers: what the owner asked for after the GIFs ("built-in stickers"), from Microsoft's Fluent Emoji in their 3D style (MIT; the source,
 * the licence and each file's hash are in public/stickers/NOTICE.txt). They are this site's own files, so they ask nobody else for anything, and a child's
 * profile has them too.
 *
 * A sticker is sent as its emoji, alone in the message: so a page that does not know stickers (an older one, the phone remote, a report) shows the emoji,
 * and the server keeps a message as any other. A screen draws a message whose whole text is one of these emoji as the sticker, big and with no bubble, as
 * messengers draw an emoji sent alone; one typed alone is drawn so too.
 */

export interface Sticker {
  id: string;
  emoji: string;
}

export const STICKERS: readonly Sticker[] = [
  { id: "popcorn", emoji: "\u{1F37F}" },
  { id: "clapper", emoji: "\u{1F3AC}" },
  { id: "camera", emoji: "\u{1F3A5}" },
  { id: "tv", emoji: "\u{1F4FA}" },
  { id: "tickets", emoji: "\u{1F39F}\u{FE0F}" },
  { id: "couch", emoji: "\u{1F6CB}\u{FE0F}" },
  { id: "joy", emoji: "\u{1F602}" },
  { id: "rofl", emoji: "\u{1F923}" },
  { id: "heart-eyes", emoji: "\u{1F60D}" },
  { id: "star-struck", emoji: "\u{1F929}" },
  { id: "scream", emoji: "\u{1F631}" },
  { id: "sob", emoji: "\u{1F62D}" },
  { id: "mind-blown", emoji: "\u{1F92F}" },
  { id: "thinking", emoji: "\u{1F914}" },
  { id: "pleading", emoji: "\u{1F97A}" },
  { id: "yawn", emoji: "\u{1F971}" },
  { id: "sleeping", emoji: "\u{1F634}" },
  { id: "heart", emoji: "\u{2764}\u{FE0F}" },
  { id: "fire", emoji: "\u{1F525}" },
  { id: "thumbs-up", emoji: "\u{1F44D}" },
  { id: "clap", emoji: "\u{1F44F}" },
  { id: "party", emoji: "\u{1F389}" },
  { id: "wave", emoji: "\u{1F44B}" },
  { id: "ghost", emoji: "\u{1F47B}" },
  { id: "skull", emoji: "\u{1F480}" },
  { id: "eyes", emoji: "\u{1F440}" },
  { id: "pizza", emoji: "\u{1F355}" },
  { id: "alarm", emoji: "\u{23F0}" },
];

const MARK = "\u{FE0F}";
const BY_TEXT = new Map<string, Sticker>();
for (const sticker of STICKERS) {
  const bare = sticker.emoji.endsWith(MARK) ? sticker.emoji.slice(0, -MARK.length) : sticker.emoji;
  for (const form of [bare, bare + MARK]) BY_TEXT.set(form, sticker);
}

export function stickerOf(text: string): Sticker | null {
  const written = text.trim();
  if (written.length === 0 || written.length > 3) return null;
  return BY_TEXT.get(written) ?? null;
}

export const stickerSrc = (sticker: Sticker) => `/stickers/${sticker.id}.webp`;
