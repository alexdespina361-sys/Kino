import { useEffect, useMemo, useState } from "react";
import { SAVED_PICTURES_MAX } from "../../shared";
import { profileStore, useProfileData } from "../account/store";
import type { Key } from "../i18n";
import { gifOf } from "./gifs";
import { stickerOf, type Sticker } from "./stickers";

export type SavedPicture =
  | { kind: "gif"; key: string; text: string }
  | { kind: "sticker"; key: string; text: string; sticker: Sticker };

const KEY_MAX = 400;

export function pictureOf(line: { text: string; sticker?: string | undefined }): SavedPicture | null {
  if (line.sticker) return null;
  const gif = gifOf(line.text);
  if (gif) return `gif:${gif}`.length > KEY_MAX ? null : { kind: "gif", key: `gif:${gif}`, text: gif };
  const sticker = stickerOf(line.text);
  if (sticker) return { kind: "sticker", key: `sticker:${sticker.id}`, text: sticker.emoji, sticker };
  return null;
}

export function savedPicture(item: { key: string; text: string }): SavedPicture | null {
  const picture = pictureOf({ text: item.text });
  return picture && picture.key === item.key && picture.text === item.text ? picture : null;
}

export interface SavedPictures {
  gifs: Extract<SavedPicture, { kind: "gif" }>[];
  stickers: Extract<SavedPicture, { kind: "sticker" }>[];
  has: (picture: SavedPicture) => boolean;
  keep: (picture: SavedPicture, kept: boolean) => void;
  full: boolean;
}

export const SAVED_MAX = SAVED_PICTURES_MAX;

export type KeptNote = "gif" | "sticker" | "removed" | "full";
export const KEPT_NOTE: Record<KeptNote, Key> = {
  gif: "chat.savedGifNote",
  sticker: "chat.savedStickerNote",
  removed: "chat.unsavedNote",
  full: "chat.savedFull",
};

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
      setSaid((count) => count + 1);
    },
  ];
}

export function toggleKept(saved: SavedPictures, picture: SavedPicture): KeptNote {
  if (saved.has(picture)) {
    saved.keep(picture, false);
    return "removed";
  }
  if (saved.full) return "full";
  saved.keep(picture, true);
  return picture.kind;
}

export function savedPicturesOf(saved: readonly { key: string; text: string }[], keep: SavedPictures["keep"]): SavedPictures {
  const pictures = saved.flatMap((item) => {
    const picture = savedPicture(item);
    return picture ? [picture] : [];
  });
  const keys = new Set(pictures.map((picture) => picture.key));
  return {
    gifs: pictures.filter((picture): picture is Extract<SavedPicture, { kind: "gif" }> => picture.kind === "gif"),
    stickers: pictures.filter((picture): picture is Extract<SavedPicture, { kind: "sticker" }> => picture.kind === "sticker"),
    has: (picture) => keys.has(picture.key),
    keep,
    full: saved.length >= SAVED_PICTURES_MAX,
  };
}

export function useSavedPictures(): SavedPictures {
  const { saved } = useProfileData();
  return useMemo(() => savedPicturesOf(saved, (picture, kept) => profileStore.setSaved(picture.key, kept ? picture.text : undefined)), [saved]);
}
