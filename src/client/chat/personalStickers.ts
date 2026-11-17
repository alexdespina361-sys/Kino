import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { MyStickersSchema, PERSONAL_STICKER, StickerIdSchema, type MyStickers } from "../../shared";
import { ApiError, ask } from "../account/api";
import { useProfileData } from "../account/store";
import type { Key } from "../i18n";
import type { PersonalLines } from "./ChatLines";

/**
 * Personal stickers on the page (shared/stickers.ts: what they are, and the server's rules). This is the page's side: whether the host has them on, the calls,
 * making a picture into the square PNG the server takes, and a profile's collection, kept once for every view of the page that shows it.
 */

export type PersonalSticker = MyStickers["stickers"][number];

/* ------------------------------ on or off ------------------------------ */

let offered: Promise<boolean> | undefined;
/** Whether the host has them on (`/api/features`). Asked once a page; a host that did not answer is asked again the next time. */
export function personalStickersOffered(): Promise<boolean> {
  offered ??= (async () => {
    try {
      const answer = await fetch("/api/features", { cache: "no-store" });
      if (!answer.ok) throw new Error(String(answer.status));
      return ((await answer.json()) as { stickers?: unknown }).stickers === true;
    } catch {
      offered = undefined;
      return false;
    }
  })();
  return offered;
}

/** Whether this profile has them: the host has them on, and the profile is not a child's (it has no friends, so no chat). */
export function usePersonalStickersOn(): boolean {
  const child = useProfileData().settings.child === true;
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    void personalStickersOffered().then((answer) => live && setOn(answer));
    return () => {
      live = false;
    };
  }, []);
  return on && !child;
}

/* ------------------------------ the calls ------------------------------ */

const own = (profileId: string) => `/api/profiles/${encodeURIComponent(profileId)}/stickers`;
const inChat = (profileId: string, friendId: string) => `/api/profiles/${encodeURIComponent(profileId)}/friends/${encodeURIComponent(friendId)}/chat`;
const MadeSchema = MyStickersSchema.extend({ id: StickerIdSchema });

export const personalStickerApi = {
  list: (profileId: string) => ask(MyStickersSchema, "GET", own(profileId)),
  /** Make one of a picture (the base64 of a PNG: `stickerPicture`). The answer is the collection, and the new one's name. */
  make: (profileId: string, data: string) => ask(MadeSchema, "POST", own(profileId), { data }),
  remove: (profileId: string, id: string) => ask(MyStickersSchema, "DELETE", `${own(profileId)}/${encodeURIComponent(id)}`),
  /** Keep one a friend sent in this chat. The answer is the collection. */
  save: (profileId: string, friendId: string, id: string) => ask(MyStickersSchema, "POST", `${inChat(profileId, friendId)}/stickers/${encodeURIComponent(id)}/save`),
};

/** A picture of one's own collection. */
export const ownStickerSrc = (profileId: string, id: string) => `${own(profileId)}/${encodeURIComponent(id)}`;
/** A picture sent in a chat (to either of the two). */
export const chatStickerSrc = (profileId: string, friendId: string, id: string) => `${inChat(profileId, friendId)}/stickers/${encodeURIComponent(id)}`;

/* ------------------------------ making the picture ------------------------------ */

/** The biggest file a phone is asked to open (a photo of 50 megapixels is less): anything bigger is not opened at all. */
const OPEN_BYTES = 40 * 1024 * 1024;

export type StickerAddProblem = "not_a_picture" | "too_big" | "full" | "too_many" | "site_full" | "failed";

/**
 * A picture the person chose, made into what the server takes: its middle square, at 192 by 192, as a PNG (base64). Nothing of the file but its pixels goes
 * (what a camera wrote into it, where and when, is left behind by the canvas). A file the browser cannot open as a picture is "not_a_picture".
 */
export async function stickerPicture(file: Blob): Promise<string> {
  if (file.size > OPEN_BYTES) throw new StickerError("too_big");
  const image = await openPicture(file);
  try {
    const side = Math.min(image.width, image.height);
    if (!(side > 0)) throw new StickerError("not_a_picture");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = PERSONAL_STICKER.side;
    const context = canvas.getContext("2d");
    if (!context) throw new StickerError("failed");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image.source, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, PERSONAL_STICKER.side, PERSONAL_STICKER.side);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) throw new StickerError("failed");
    if (png.size > PERSONAL_STICKER.sentBytes) throw new StickerError("too_big");
    return base64Of(new Uint8Array(await png.arrayBuffer()));
  } finally {
    image.close();
  }
}

export class StickerError extends Error {
  constructor(readonly problem: StickerAddProblem) {
    super(problem);
  }
}

/** The picture, drawn the right way up (a phone's photo says which way that is: both ways of opening it follow what it says). */
async function openPicture(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      /* (an older browser that does not take the options, or cannot open this kind: the picture element may) */
    }
  }
  const address = URL.createObjectURL(file);
  try {
    const element = new Image();
    element.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      element.onload = () => resolve();
      element.onerror = () => reject(new StickerError("not_a_picture"));
      element.src = address;
    });
    return { source: element, width: element.naturalWidth, height: element.naturalHeight, close: () => URL.revokeObjectURL(address) };
  } catch (error) {
    URL.revokeObjectURL(address);
    throw error instanceof StickerError ? error : new StickerError("not_a_picture");
  }
}

function base64Of(bytes: Uint8Array): string {
  let text = "";
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(text);
}

/** What went wrong, as the picker says it. */
export function addProblemOf(error: unknown): StickerAddProblem {
  if (error instanceof StickerError) return error.problem;
  if (error instanceof ApiError) {
    if (error.code === "not_a_picture" || error.code === "too_big" || error.code === "full" || error.code === "site_full") return error.code;
    if (error.status === 429) return "too_many";
  }
  return "failed";
}

/* ------------------------------ a profile's collection ------------------------------ */

interface Kept {
  stickers: PersonalSticker[] | null;
  status: "loading" | "ready" | "failed";
}
const kept = new Map<string, Kept>();
const listeners = new Set<() => void>();
const NOTHING: Kept = { stickers: null, status: "loading" };
const tell = () => listeners.forEach((listener) => listener());
/** (How many times the page has been told a collection: a look asked before the last of them is older than what the page has.) */
let told = 0;
const keep = (profileId: string, next: Kept) => {
  told++;
  kept.set(profileId, next);
  tell();
};
/** What the server answered about the collection: the page's from now on. */
export const tookCollection = (profileId: string, answer: MyStickers) => keep(profileId, { stickers: answer.stickers, status: "ready" });

/**
 * The collection asked again, quietly, when a view of it opens (one added on another screen of the profile, a phone, is there on the TV the next time its
 * stickers are opened). What the page shows stays while it is asked; an answer is taken only if nothing has changed the collection on this page since it was
 * asked (a sticker made meanwhile is not undone by an older answer), and one that does not come changes nothing.
 */
export function lookAgain(profileId: string): Promise<void> {
  const asked = told;
  return personalStickerApi.list(profileId).then(
    (answer) => {
      if (told === asked) tookCollection(profileId, answer);
    },
    () => undefined,
  );
}

/** (Tests: what the page has of a profile's collection.) */
export const keptCollection = (profileId: string): PersonalSticker[] | null => kept.get(profileId)?.stickers ?? null;

export interface MyStickersView {
  /** The collection, the newest first (null until the server has answered). */
  stickers: PersonalSticker[] | null;
  status: "loading" | "ready" | "failed";
  /** Make a sticker of a picture file: null when it was made, else why not. */
  add: (file: Blob) => Promise<StickerAddProblem | null>;
  remove: (id: string) => Promise<boolean>;
  retry: () => void;
}

/**
 * A profile's collection, asked of the server when a view first needs it (and again after it failed). `fresh`: a view that opens to be chosen from (the
 * stickers' sheet or page) asks again quietly each time it opens (see `lookAgain`); the chat's own lines use what the page has.
 */
export function useMyStickers(profileId: string, on: boolean, fresh = false): MyStickersView {
  const read = () => kept.get(profileId) ?? NOTHING;
  const now = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    read,
    read,
  );
  const load = useCallback(() => {
    keep(profileId, { stickers: kept.get(profileId)?.stickers ?? null, status: "loading" });
    personalStickerApi.list(profileId).then(
      (answer) => tookCollection(profileId, answer),
      () => keep(profileId, { stickers: kept.get(profileId)?.stickers ?? null, status: "failed" }),
    );
  }, [profileId]);
  useEffect(() => {
    if (!on) return;
    const now = kept.get(profileId);
    if (!now || now.status === "failed") load();
    else if (fresh && now.status === "ready") void lookAgain(profileId);
  }, [on, profileId, load, fresh]);
  const add = useCallback(
    async (file: Blob): Promise<StickerAddProblem | null> => {
      try {
        const made = await personalStickerApi.make(profileId, await stickerPicture(file));
        tookCollection(profileId, made);
        return null;
      } catch (error) {
        return addProblemOf(error);
      }
    },
    [profileId],
  );
  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        tookCollection(profileId, await personalStickerApi.remove(profileId, id));
        return true;
      } catch (error) {
        // (gone already, say from another screen: what the page shows is made right)
        if (error instanceof ApiError && error.status === 404) load();
        return false;
      }
    },
    [profileId, load],
  );
  return { stickers: now.stickers, status: now.status, add, remove, retry: load };
}

/* ------------------------------ in a chat ------------------------------ */

export type SaveNote = "saved" | "full" | "gone" | "failed";
/** What a chat says after a sticker was saved, or was not. */
export const SAVE_NOTE: Record<SaveNote, Key> = {
  saved: "chat.stickerSavedNote",
  full: "chat.stickerFull",
  gone: "chat.stickerGone",
  failed: "chat.stickerSaveFailed",
};

/**
 * What a chat's messages need of personal stickers while they are on (see ChatLines.tsx `personal`): where the pictures sent in it are, and, on a screen that
 * is touched or clicked (`interactive`), saving a friend's, with what came of it said for a few seconds (`note`).
 */
export function usePersonalLines(chat: { profileId: string; friendId: string }, interactive: boolean): { lines: PersonalLines | undefined; note: SaveNote | null } {
  const on = usePersonalStickersOn();
  const { profileId, friendId } = chat;
  const mine = useMyStickers(profileId, on && interactive);
  const [note, setNote] = useState<SaveNote | null>(null);
  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(null), 4000);
    return () => window.clearTimeout(timer);
  }, [note]);
  const save = useCallback(
    (id: string) => {
      setNote(null);
      personalStickerApi.save(profileId, friendId, id).then(
        (answer) => {
          tookCollection(profileId, answer);
          setNote("saved");
        },
        (error: unknown) => setNote(error instanceof ApiError && error.code === "full" ? "full" : error instanceof ApiError && error.status === 404 ? "gone" : "failed"),
      );
    },
    [profileId, friendId],
  );
  if (!on) return { lines: undefined, note: null };
  const src = (id: string) => chatStickerSrc(profileId, friendId, id);
  return {
    lines: interactive ? { src, onSave: save, has: (id) => mine.stickers?.some((sticker) => sticker.id === id) ?? false } : { src },
    note,
  };
}

/** (Tests: forget what was asked.) */
export function forgetPersonalStickers(): void {
  offered = undefined;
  kept.clear();
  tell();
}
