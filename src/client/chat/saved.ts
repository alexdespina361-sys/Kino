import { useEffect, useMemo, useState } from "react";
import { SAVED_PICTURES_MAX } from "../../shared";
import { profileStore, useProfileData } from "../account/store";
import type { Key } from "../i18n";
import { gifOf } from "./gifs";
import { stickerOf, type Sticker } from "./stickers";

/**
 * The chat's pictures a profile keeps (the owner, 17 Nov 2026: "can save/pin stickers and gifs"): a GIF or one of Kino's stickers that was sent in a chat,
 * the profile's own or a friend's, kept at the top of its tab in the chat's panel (ChatPanel.tsx), on every screen of the profile (shared/account.ts
 * `SavedItemSchema`: the profile's data, as its lists are). One is sent from there as it was sent the first time, as a message whose text is the same.
 *
 * A personal sticker is not one of them: it has a place of its own, "Yours" (a friend's is saved there, personalStickers.ts). Words are not either.
 *
 * What is kept is read again as a message would be (`savedPicture`): a GIF only from KLIPY's hosts, a sticker only one of Kino's, and only when what it
 * says it is agrees with what it is. So a copy made by hand, or by a page that is not this one, shows nothing and asks nobody for anything.
 */
export type SavedPicture =
  | { kind: "gif"; key: string; text: string }
  | { kind: "sticker"; key: string; text: string; sticker: Sticker };

/** The picture a message is, as one that can be kept; none for words, and for a personal sticker. */
export function pictureOf(line: { text: string; sticker?: string | undefined }): SavedPicture | null {
  if (line.sticker) return null;
  const gif = gifOf(line.text);
  if (gif) return { kind: "gif", key: `gif:${gif}`, text: gif };
  const sticker = stickerOf(line.text);
  // (A heart typed without the mark is the same heart: kept as the sticker sends it.)
  if (sticker) return { kind: "sticker", key: `sticker:${sticker.id}`, text: sticker.emoji, sticker };
  return null;
}

/** A kept picture as the panel shows it, or none when it is not one (see the top of this file). */
export function savedPicture(item: { key: string; text: string }): SavedPicture | null {
  const picture = pictureOf({ text: item.text });
  return picture && picture.key === item.key && picture.text === item.text ? picture : null;
}

export interface SavedPictures {
  /** The GIFs kept, the one kept last first. */
  gifs: Extract<SavedPicture, { kind: "gif" }>[];
  /** Kino's stickers kept, the one kept last first. */
  stickers: Extract<SavedPicture, { kind: "sticker" }>[];
  /** Whether this one is kept. */
  has: (picture: SavedPicture) => boolean;
  /** Keep it (it comes first: one kept again moves to the front) or let it go. */
  keep: (picture: SavedPicture, kept: boolean) => void;
  /** As many are kept as there can be: one is let go before another is kept (none is pushed out unasked). */
  full: boolean;
}

export const SAVED_MAX = SAVED_PICTURES_MAX;

export type KeptNote = "gif" | "sticker" | "removed" | "full";
/** What a chat says for a few seconds after Save (or Remove from saved) on a message: where it went, so that the press is not one that seemed to do nothing. */
export const KEPT_NOTE: Record<KeptNote, Key> = {
  gif: "chat.savedGifNote",
  sticker: "chat.savedStickerNote",
  removed: "chat.unsavedNote",
  full: "chat.savedFull",
};

/** The note of the last Save, said for four seconds (as a personal sticker's, personalStickers.ts). */
export function useKeptNote(): [KeptNote | null, (note: KeptNote) => void] {
  const [note, setNote] = useState<KeptNote | null>(null);
  const [said, setSaid] = useState(0);
  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(null), 4000);
    return () => window.clearTimeout(timer);
  }, [note, said]);
  return [
    note,
    (next) => {
      setNote(next);
      setSaid((count) => count + 1); // (the same note again is said four seconds more)
    },
  ];
}

/** Keep a message's picture, or let it go: what then is to be said. */
export function toggleKept(saved: SavedPictures, picture: SavedPicture): KeptNote {
  if (saved.has(picture)) {
    saved.keep(picture, false);
    return "removed";
  }
  if (saved.full) return "full";
  saved.keep(picture, true);
  return picture.kind;
}

/** The pictures the profile in use keeps; the component shows again when they change. */
export function useSavedPictures(): SavedPictures {
  const { saved } = useProfileData();
  return useMemo(() => {
    const pictures = saved.flatMap((item) => {
      const picture = savedPicture(item);
      return picture ? [picture] : [];
    });
    const keys = new Set(pictures.map((picture) => picture.key));
    return {
      gifs: pictures.filter((picture): picture is Extract<SavedPicture, { kind: "gif" }> => picture.kind === "gif"),
      stickers: pictures.filter((picture): picture is Extract<SavedPicture, { kind: "sticker" }> => picture.kind === "sticker"),
      has: (picture) => keys.has(picture.key),
      keep: (picture, kept) => profileStore.setSaved(picture.key, kept ? picture.text : undefined),
      // (Counted among those shown: one that is not shown could not be let go.)
      full: pictures.length >= SAVED_PICTURES_MAX,
    };
  }, [saved]);
}
