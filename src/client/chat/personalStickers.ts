import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { MOVING_STICKER, MyStickersSchema, PERSONAL_STICKER, StickerIdSchema, type MyStickers } from "../../shared";
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

/** What the host has on: personal stickers, and stickers that move (shared/stickers.ts `MOVING_STICKER`: only with the others). */
interface Offered {
  stickers: boolean;
  moving: boolean;
}
let offered: Promise<Offered | null> | undefined;
/** Whether the host has them on (`/api/features`), null when it did not answer. Asked once a page; a host that did not answer is asked again the next time. */
function askOffered(): Promise<Offered | null> {
  offered ??= (async () => {
    try {
      const answer = await fetch("/api/features", { cache: "no-store" });
      if (!answer.ok) throw new Error(String(answer.status));
      const said = (await answer.json()) as { stickers?: unknown; movingStickers?: unknown };
      return { stickers: said.stickers === true, moving: said.stickers === true && said.movingStickers === true };
    } catch {
      offered = undefined;
      return null;
    }
  })();
  return offered;
}
export const personalStickersOffered = (): Promise<boolean> => askOffered().then((answer) => answer?.stickers === true);

/** Whether the host makes stickers that move as well: a picture that moves is then made one that moves (else its first picture), and WhatsApp's GIFs are offered. */
export function useMovingStickersOn(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    void askOffered().then((answer) => live && setOn(answer?.moving === true));
    return () => {
      live = false;
    };
  }, []);
  return on;
}

/**
 * How long after a host that did not say whether they are on it is asked again (a moment's lost network is not "off" for as long as the page is open): soon at
 * first, then once a minute for as long as it does not say.
 */
const ASK_AGAIN_MS = [5_000, 20_000, 60_000] as const;

/** Whether this profile has them: the host has them on, and the profile is not a child's (it has no friends, so no chat). */
export function usePersonalStickersOn(): boolean {
  const child = useProfileData().settings.child === true;
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    let timer: number | undefined;
    const look = (tries: number) => {
      void askOffered().then((answer) => {
        if (!live) return;
        if (answer !== null) return setOn(answer.stickers);
        timer = window.setTimeout(() => look(tries + 1), ASK_AGAIN_MS[Math.min(tries, ASK_AGAIN_MS.length - 1)]);
      });
    };
    look(0);
    return () => {
      live = false;
      window.clearTimeout(timer);
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
  /** Make one of a picture (the base64 of a PNG: `stickerPicture`; one that moves says how long each picture is shown). The answer is the collection, and the new one's name. */
  make: (profileId: string, data: string, delays?: number[]) => ask(MadeSchema, "POST", own(profileId), delays ? { data, delays } : { data }),
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
 * How many pixels a picture may have to be opened here. Opening one takes four bytes a pixel at once, before it is made small (a photo of 50 megapixels is
 * 200 MB), which a phone with little memory may not have (the judge, 17 Nov): 14 megapixels for each gigabyte the browser says the phone has (Chrome says, up
 * to 8; a browser that does not, Safari, is taken to have 4), never fewer than 16 and never more than 112. So a usual photo (12.2 or 16 megapixels) opens on
 * any phone, one of 48 or 50 on a phone of 4 GB or that does not say (an iPhone's), and one of 108 on a phone of 8; one of 200 nowhere (800 MB at once).
 */
export function pixelBudget(memoryGb: number | undefined): number {
  const gb = typeof memoryGb === "number" && memoryGb > 0 ? memoryGb : 4;
  return Math.min(112, Math.max(16, gb * 14)) * 1_000_000;
}

const ascii = (bytes: Uint8Array, at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length));
/** JPEG's frame headers (they say the size): C0 to CF, but for C4, C8 and CC, which are other things. */
const JPEG_FRAMES = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/**
 * The width and height a picture file says it has, read from its first bytes with nothing decoded: PNG, WebP and JPEG (whose frame header can come after a
 * camera's notes: its parts are stepped over, never read whole). Null for another kind (HEIC, GIF), or one that does not say.
 */
export async function pictureSize(file: Blob): Promise<{ width: number; height: number } | null> {
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  if (head.length >= 24 && head[0] === 0x89 && ascii(head, 1, 3) === "PNG") {
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (head.length >= 30 && ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WEBP") {
    const at = (index: number) => head[index]!;
    switch (ascii(head, 12, 4)) {
      case "VP8X":
        return { width: 1 + (at(24) | (at(25) << 8) | (at(26) << 16)), height: 1 + (at(27) | (at(28) << 8) | (at(29) << 16)) };
      case "VP8 ":
        return { width: (at(26) | (at(27) << 8)) & 0x3fff, height: (at(28) | (at(29) << 8)) & 0x3fff };
      case "VP8L": {
        const bits = (at(21) | (at(22) << 8) | (at(23) << 16) | (at(24) << 24)) >>> 0;
        return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
      }
      default:
        return null;
    }
  }
  if (head[0] !== 0xff || head[1] !== 0xd8) return null;
  let at = 2;
  for (let parts = 0; parts < 100 && at + 9 <= file.size; parts++) {
    const part = new Uint8Array(await file.slice(at, at + 9).arrayBuffer());
    if (part[0] !== 0xff) return null;
    if (part[1] === 0xff) {
      at += 1; // (a byte that only fills)
      continue;
    }
    if (JPEG_FRAMES.has(part[1]!)) return { height: (part[5]! << 8) | part[6]!, width: (part[7]! << 8) | part[8]! };
    if (part[1] === 0xd9 || part[1] === 0xda) return null; // (the end, or the picture's data, before any frame header)
    const length = (part[2]! << 8) | part[3]!;
    if (length < 2) return null;
    at += 2 + length;
  }
  return null;
}

/**
 * A picture the person chose, made into what the server takes: its middle square, at 192 by 192, as a PNG (base64). Nothing of the file but its pixels goes
 * (what a camera wrote into it, where and when, is left behind by the canvas). A file the browser cannot open as a picture is "not_a_picture"; one with more
 * pixels than this phone can open at once (`pixelBudget`) is "too_big", and is not opened.
 */
export async function stickerPicture(file: Blob): Promise<string> {
  if (file.size > OPEN_BYTES) throw new StickerError("too_big");
  const size = await pictureSize(file).catch(() => null);
  const memory = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (size && size.width * size.height > pixelBudget(memory)) throw new StickerError("too_big");
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

/* ------------------------------ a picture that moves ------------------------------ */

/** A picture that moves, made into what the server takes (shared/stickers.ts `MOVING_STICKER`): its pictures one under the other, how long each is shown, and its first picture alone (made a still sticker when the host makes only those). */
export interface MovingPicture {
  data: string;
  delays: number[];
  still: string;
}
/** A picture that does not move after all (a video whose pictures are all the same): its picture alone. */
export interface StillPicture {
  still: string;
  data?: undefined;
  delays?: undefined;
}

/** How long a picture is shown at the least: 15 a second at the most. */
const FRAME_MS = Math.ceil(1000 / 15);

interface Frames {
  pictures: ImageData[];
  delays: number[];
}

/** What kind of file it is, by its first bytes (a phone's chooser does not always say): a picture that may move, or a video. */
async function movingKind(file: Blob): Promise<"image/gif" | "image/webp" | "image/png" | "video" | null> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (ascii(head, 0, 4) === "GIF8") return "image/gif";
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WEBP") return "image/webp";
  if (head[0] === 0x89 && ascii(head, 1, 3) === "PNG") return "image/png";
  if (ascii(head, 4, 4) === "ftyp" || (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3)) return "video";
  return file.type.startsWith("video/") ? "video" : null;
}

/**
 * A picture that moves, made into a sticker that moves: an animated GIF, WebP or PNG (read with the browser's ImageDecoder, where it has one), or a short video
 * such as WhatsApp keeps a GIF as (a picture taken at each step of it). Its first 8 seconds, at most 48 pictures and 15 a second, each fitted whole in the
 * square (what is left over is see-through); the same picture twice in a row is one shown longer. Null for a picture that does not move, or that this browser
 * cannot read as one: it is made a still sticker as any picture is. A video whose pictures are all the same is its picture (`still`); one that this browser
 * cannot play, or that is all black, is not a picture (the judge's guard of 17 Nov: nothing of it can be tried on a phone here). One too big to send is sent
 * with every other picture, and so on; at the last, as its first picture.
 */
export async function movingPicture(file: Blob): Promise<MovingPicture | StillPicture | null> {
  if (file.size > OPEN_BYTES) throw new StickerError("too_big");
  const kind = await movingKind(file).catch(() => null);
  if (!kind) return null;
  let frames: Frames | null;
  if (kind === "video") {
    frames = await videoFrames(file).catch(() => null);
    if (!frames) throw new StickerError("not_a_picture");
  } else {
    frames = await decodedFrames(file, kind).catch(() => null);
    if (!frames) return null;
  }
  if (frames.pictures.every(blank)) throw new StickerError("not_a_picture");
  const first = await pngOf([frames.pictures[0]!]);
  if (first.size > PERSONAL_STICKER.sentBytes) throw new StickerError("too_big");
  const still = base64Of(new Uint8Array(await first.arrayBuffer()));
  for (let step = 1; ; step *= 2) {
    const now = everyOther(frames, step);
    if (!now || now.pictures.length < MOVING_STICKER.minFrames) return { still };
    const strip = await pngOf(now.pictures);
    if (strip.size <= MOVING_STICKER.sentBytes) return { data: base64Of(new Uint8Array(await strip.arrayBuffer())), delays: now.delays, still };
  }
}

/** The times (ms) its pictures are taken at, and how long each is shown: of its first 8 seconds, at most 48 pictures and 15 a second, each in the middle of its time. */
function steps(duration: number): { at: number[]; delay: number } {
  const total = Math.min(duration, MOVING_STICKER.maxDuration);
  const count = Math.max(MOVING_STICKER.minFrames, Math.min(MOVING_STICKER.maxFrames, Math.ceil(total / FRAME_MS)));
  const delay = Math.min(MOVING_STICKER.maxDelay, Math.max(MOVING_STICKER.minDelay, Math.floor(total / count)));
  return { at: Array.from({ length: count }, (_, step) => (step + 0.5) * (total / count)), delay };
}

/** A square of the sticker's side to draw on, read back often. */
function square(): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = PERSONAL_STICKER.side;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new StickerError("failed");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  return context;
}

/** A picture fitted whole in the square, in its middle; what is left over is see-through. */
function fitted(context: CanvasRenderingContext2D, source: CanvasImageSource, width: number, height: number): ImageData {
  const side = PERSONAL_STICKER.side;
  context.clearRect(0, 0, side, side);
  const scale = Math.min(side / width, side / height);
  const drawnWidth = Math.max(1, Math.round(width * scale));
  const drawnHeight = Math.max(1, Math.round(height * scale));
  context.drawImage(source, 0, 0, width, height, Math.round((side - drawnWidth) / 2), Math.round((side - drawnHeight) / 2), drawnWidth, drawnHeight);
  return context.getImageData(0, 0, side, side);
}

/** (What the page needs of the browser's ImageDecoder: its types are not in every TypeScript's.) */
interface DecodedPicture {
  image: CanvasImageSource & { displayWidth: number; displayHeight: number; duration: number | null; close(): void };
}
interface PictureDecoder {
  tracks: { ready: Promise<void>; selectedTrack: { animated: boolean; frameCount: number } | null };
  completed: Promise<void>;
  decode(options: { frameIndex: number }): Promise<DecodedPicture>;
  close(): void;
}
interface PictureDecoderClass {
  new (init: { data: ArrayBuffer; type: string }): PictureDecoder;
  isTypeSupported(type: string): Promise<boolean>;
}

/** The pictures of an animated GIF, WebP or PNG, by the browser's ImageDecoder: null where there is none, or the picture does not move. */
async function decodedFrames(file: Blob, type: string): Promise<Frames | null> {
  const Decoder = (globalThis as { ImageDecoder?: PictureDecoderClass }).ImageDecoder;
  if (!Decoder || !(await Decoder.isTypeSupported(type))) return null;
  const decoder = new Decoder({ data: await file.arrayBuffer(), type });
  try {
    await decoder.tracks.ready;
    await decoder.completed;
    const track = decoder.tracks.selectedTrack;
    if (!track?.animated || track.frameCount < MOVING_STICKER.minFrames) return null;
    // (When each picture starts: read first, each let go at once. One that says less than 20 ms is shown for 100, as browsers show it.)
    const starts: number[] = [];
    let time = 0;
    for (let index = 0; index < track.frameCount && time < MOVING_STICKER.maxDuration; index++) {
      const { image } = await decoder.decode({ frameIndex: index });
      const shown = image.duration ? image.duration / 1000 : 0;
      image.close();
      starts.push(time);
      time += shown >= MOVING_STICKER.minDelay ? shown : 100;
    }
    const { at, delay } = steps(time);
    const context = square();
    const pictures: ImageData[] = [];
    for (const when of at) {
      let index = 0;
      while (index + 1 < starts.length && starts[index + 1]! <= when) index++;
      const { image } = await decoder.decode({ frameIndex: index });
      try {
        pictures.push(fitted(context, image, image.displayWidth, image.displayHeight));
      } finally {
        image.close();
      }
    }
    return { pictures, delays: at.map(() => delay) };
  } finally {
    decoder.close();
  }
}

/** `start`, then whether the video said `event` (within 5 seconds, and not that it failed). */
function videoSays(video: HTMLVideoElement, event: string, start: () => void): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      window.clearTimeout(timer);
      video.removeEventListener(event, yes);
      video.removeEventListener("error", no);
      resolve(ok);
    };
    const yes = () => done(true);
    const no = () => done(false);
    const timer = window.setTimeout(() => done(false), 5000);
    video.addEventListener(event, yes);
    video.addEventListener("error", no);
    start();
  });
}

/** The pictures of a video, a picture taken at each step (the video is not played, nor heard): null when this browser cannot play it. */
async function videoFrames(file: Blob): Promise<Frames | null> {
  const address = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    if (!(await videoSays(video, "loadeddata", () => (video.src = address)))) return null;
    // (A video that does not say how long it is (one a browser recorded) says so once it has been to its end.)
    if (video.duration === Infinity && !(await videoSays(video, "seeked", () => (video.currentTime = 1e6)))) return null;
    const duration = video.duration * 1000;
    if (!Number.isFinite(duration) || !(duration > 0) || !video.videoWidth || !video.videoHeight) return null;
    const { at, delay } = steps(duration);
    const context = square();
    const pictures: ImageData[] = [];
    for (const when of at) {
      if (!(await videoSays(video, "seeked", () => (video.currentTime = when / 1000)))) return null;
      pictures.push(fitted(context, video, video.videoWidth, video.videoHeight));
    }
    return { pictures, delays: at.map(() => delay) };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(address);
  }
}

/** A picture with nothing to see: every pixel see-through or black. */
function blank(picture: ImageData): boolean {
  const data = picture.data;
  for (let at = 0; at < data.length; at += 4) if (data[at + 3]! > 0 && (data[at]! > 8 || data[at + 1]! > 8 || data[at + 2]! > 8)) return false;
  return true;
}

const samePicture = (a: ImageData, b: ImageData) => {
  const x = new Uint32Array(a.data.buffer, a.data.byteOffset, a.data.byteLength / 4);
  const y = new Uint32Array(b.data.buffer, b.data.byteOffset, b.data.byteLength / 4);
  if (x.length !== y.length) return false;
  for (let at = 0; at < x.length; at++) if (x[at] !== y[at]) return false;
  return true;
};

/**
 * Every `step`-th picture, each shown for the time of those it stands for, and the same picture twice in a row one shown longer: null when a picture would be
 * shown longer than a picture may be.
 */
function everyOther({ pictures, delays }: Frames, step: number): Frames | null {
  const kept: ImageData[] = [];
  const shown: number[] = [];
  for (let at = 0; at < pictures.length; at += step) {
    const time = delays.slice(at, at + step).reduce((all, delay) => all + delay, 0);
    if (time > MOVING_STICKER.maxDelay) return null;
    const last = kept.length - 1;
    if (last >= 0 && shown[last]! + time <= MOVING_STICKER.maxDelay && samePicture(kept[last]!, pictures[at]!)) shown[last] = shown[last]! + time;
    else {
      kept.push(pictures[at]!);
      shown.push(time);
    }
  }
  return { pictures: kept, delays: shown };
}

/** The pictures one under the other, as one PNG. */
async function pngOf(pictures: ImageData[]): Promise<Blob> {
  const side = PERSONAL_STICKER.side;
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side * pictures.length;
  const context = canvas.getContext("2d");
  if (!context) throw new StickerError("failed");
  pictures.forEach((picture, at) => context.putImageData(picture, 0, at * side));
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!png) throw new StickerError("failed");
  return png;
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
/**
 * (How many times the page has been told a profile's collection, or has begun to ask for it: an answer to a look asked before the last of them is older than
 * what the page has, and is not taken. One count for each profile: another profile's change makes no look of this one's old.)
 */
const told = new Map<string, number>();
const toldOf = (profileId: string) => told.get(profileId) ?? 0;
const keep = (profileId: string, next: Kept) => {
  told.set(profileId, toldOf(profileId) + 1);
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
  const asked = toldOf(profileId);
  return personalStickerApi.list(profileId).then(
    (answer) => {
      if (toldOf(profileId) === asked) tookCollection(profileId, answer);
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
  /** Make a sticker of a picture file (`moving`: one that moves, while the host makes those): null when it was made, else why not. */
  add: (file: Blob, moving?: boolean) => Promise<StickerAddProblem | null>;
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
  // (An answer is taken only if nothing changed the collection on this page since it was asked: a sticker made or saved meanwhile, whose answer came first,
  // is not undone by it, the judge, 17 Nov. That change has made the collection "ready" already.)
  const load = useCallback(() => {
    keep(profileId, { stickers: kept.get(profileId)?.stickers ?? null, status: "loading" });
    const asked = toldOf(profileId);
    personalStickerApi.list(profileId).then(
      (answer) => {
        if (toldOf(profileId) === asked) tookCollection(profileId, answer);
      },
      () => {
        if (toldOf(profileId) === asked) keep(profileId, { stickers: kept.get(profileId)?.stickers ?? null, status: "failed" });
      },
    );
  }, [profileId]);
  useEffect(() => {
    if (!on) return;
    const now = kept.get(profileId);
    if (!now || now.status === "failed") load();
    else if (fresh && now.status === "ready") void lookAgain(profileId);
  }, [on, profileId, load, fresh]);
  const add = useCallback(
    async (file: Blob, moving = false): Promise<StickerAddProblem | null> => {
      // (The site takes a few pictures at once, and one at a time from an account: one that comes while another is on its way waits as long as it is told,
      // once, and goes again.)
      const make = (picture: string, delays?: number[]) =>
        personalStickerApi.make(profileId, picture, delays).catch(async (error: unknown) => {
          if (!(error instanceof ApiError && error.status === 503 && error.code === "busy")) throw error;
          await new Promise((resolve) => setTimeout(resolve, Math.min(10, Math.max(1, error.retryAfter ?? 5)) * 1000));
          return personalStickerApi.make(profileId, picture, delays);
        });
      try {
        // (While the host makes stickers that move: a picture that moves is made one, and its first picture when the server could not; the collection full,
        // the day's made, or the site without room, are said as they are.)
        const picture = moving ? await movingPicture(file) : null;
        let made: Awaited<ReturnType<typeof make>>;
        if (picture && picture.delays !== undefined) {
          made = await make(picture.data, picture.delays).catch((error: unknown) => {
            const problem = addProblemOf(error);
            if (problem === "full" || problem === "too_many" || problem === "site_full") throw error;
            return make(picture.still);
          });
        } else {
          made = await make(picture ? picture.still : await stickerPicture(file));
        }
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
  told.clear();
  tell();
}
