import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { MOVING_STICKER, MyStickersSchema, PERSONAL_STICKER, StickerIdSchema, type MyStickers } from "../../shared";
import { ApiError, ask } from "../account/api";
import { useProfileData } from "../account/store";
import type { Key } from "../i18n";
import type { PersonalLines } from "./ChatLines";

export type PersonalSticker = MyStickers["stickers"][number];

interface Offered {
  stickers: boolean;
  moving: boolean;
}
let offered: Promise<Offered | null> | undefined;
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

const ASK_AGAIN_MS = [5_000, 20_000, 60_000] as const;

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

const own = (profileId: string) => `/api/profiles/${encodeURIComponent(profileId)}/stickers`;
const inChat = (profileId: string, friendId: string) => `/api/profiles/${encodeURIComponent(profileId)}/friends/${encodeURIComponent(friendId)}/chat`;
const MadeSchema = MyStickersSchema.extend({ id: StickerIdSchema });

export const personalStickerApi = {
  list: (profileId: string) => ask(MyStickersSchema, "GET", own(profileId)),
  make: (profileId: string, data: string, delays?: number[]) => ask(MadeSchema, "POST", own(profileId), delays ? { data, delays } : { data }),
  remove: (profileId: string, id: string) => ask(MyStickersSchema, "DELETE", `${own(profileId)}/${encodeURIComponent(id)}`),
  save: (profileId: string, friendId: string, id: string) => ask(MyStickersSchema, "POST", `${inChat(profileId, friendId)}/stickers/${encodeURIComponent(id)}/save`),
};

export const ownStickerSrc = (profileId: string, id: string) => `${own(profileId)}/${encodeURIComponent(id)}`;
export const chatStickerSrc = (profileId: string, friendId: string, id: string) => `${inChat(profileId, friendId)}/stickers/${encodeURIComponent(id)}`;

const OPEN_BYTES = 40 * 1024 * 1024;

export type StickerAddProblem = "not_a_picture" | "too_big" | "full" | "too_many" | "site_full" | "failed";

export function pixelBudget(memoryGb: number | undefined): number {
  const gb = typeof memoryGb === "number" && memoryGb > 0 ? memoryGb : 4;
  return Math.min(112, Math.max(16, gb * 14)) * 1_000_000;
}

const ascii = (bytes: Uint8Array, at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length));
const JPEG_FRAMES = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

export async function pictureSize(file: Blob): Promise<{ width: number; height: number } | null> {
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  if (head.length >= 10 && ascii(head, 0, 4) === "GIF8") return { width: head[6]! | (head[7]! << 8), height: head[8]! | (head[9]! << 8) };
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
      at += 1;
      continue;
    }
    if (JPEG_FRAMES.has(part[1]!)) return { height: (part[5]! << 8) | part[6]!, width: (part[7]! << 8) | part[8]! };
    if (part[1] === 0xd9 || part[1] === 0xda) return null;
    const length = (part[2]! << 8) | part[3]!;
    if (length < 2) return null;
    at += 2 + length;
  }
  return null;
}

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

export interface MovingPicture {
  data: string;
  delays: number[];
  still: string;
}
export interface StillPicture {
  still: string;
  data?: undefined;
  delays?: undefined;
}

const FRAME_MS = Math.ceil(1000 / 15);
const MOVING_PIXELS = 4_000_000;
const VIDEO_MS = 20_000;

interface Frames {
  pictures: ImageData[];
  delays: number[];
}

const STILL_BRANDS = new Set(["avif", "avis", "heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

export async function movingKind(file: Blob): Promise<"image/gif" | "image/webp" | "image/png" | "video" | null> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (ascii(head, 0, 4) === "GIF8") return "image/gif";
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WEBP") return "image/webp";
  if (head[0] === 0x89 && ascii(head, 1, 3) === "PNG") return "image/png";
  if (ascii(head, 4, 4) === "ftyp") return STILL_BRANDS.has(ascii(head, 8, 4)) || file.type.startsWith("image/") ? null : "video";
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "video";
  return file.type.startsWith("video/") ? "video" : null;
}

export async function movingPicture(file: Blob): Promise<MovingPicture | StillPicture | null> {
  if (file.size > OPEN_BYTES) throw new StickerError("too_big");
  const kind = await movingKind(file).catch(() => null);
  if (!kind) return null;
  let frames: Frames | null;
  if (kind === "video") {
    frames = await videoFrames(file).catch((error: unknown) => {
      if (error instanceof StickerError) throw error;
      return null;
    });
    if (!frames) throw new StickerError("not_a_picture");
  } else {
    const size = await pictureSize(file).catch(() => null);
    if (!size || size.width * size.height > MOVING_PIXELS) return null;
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
    const strip = await pngOf(now.pictures).catch(() => null);
    if (strip && strip.size <= MOVING_STICKER.sentBytes) return { data: base64Of(new Uint8Array(await strip.arrayBuffer())), delays: now.delays, still };
  }
}

export function steps(duration: number): { at: number[]; delay: number } {
  const total = Math.min(duration, MOVING_STICKER.maxDuration);
  const count = Math.max(MOVING_STICKER.minFrames, Math.min(MOVING_STICKER.maxFrames, Math.floor(total / FRAME_MS)));
  const delay = Math.min(MOVING_STICKER.maxDelay, Math.max(FRAME_MS, Math.floor(total / count)));
  return { at: Array.from({ length: count }, (_, step) => (step + 0.5) * (total / count)), delay };
}

export function asItWas(shown: readonly number[]): { index: number; delay: number }[] | null {
  const all: { index: number; delay: number }[] = [];
  let total = 0;
  for (const [index, time] of shown.entries()) {
    if (!Number.isFinite(time) || total + Math.floor(time) > MOVING_STICKER.maxDuration) return null;
    for (let left = Math.floor(time); left > 0; ) {
      const delay = left > MOVING_STICKER.maxDelay ? Math.min(MOVING_STICKER.maxDelay, left - MOVING_STICKER.minDelay) : left;
      all.push({ index, delay });
      total += delay;
      left -= delay;
    }
    if (all.length > MOVING_STICKER.maxFrames || total > MOVING_STICKER.maxDuration) return null;
  }
  return all.length >= MOVING_STICKER.minFrames ? all : null;
}

function square(): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = PERSONAL_STICKER.side;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new StickerError("failed");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  return context;
}

function fitted(context: CanvasRenderingContext2D, source: CanvasImageSource, width: number, height: number): ImageData {
  const side = PERSONAL_STICKER.side;
  context.clearRect(0, 0, side, side);
  const scale = Math.min(side / width, side / height);
  const drawnWidth = Math.max(1, Math.round(width * scale));
  const drawnHeight = Math.max(1, Math.round(height * scale));
  context.drawImage(source, 0, 0, width, height, Math.round((side - drawnWidth) / 2), Math.round((side - drawnHeight) / 2), drawnWidth, drawnHeight);
  return context.getImageData(0, 0, side, side);
}

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

async function decodedFrames(file: Blob, type: string): Promise<Frames | null> {
  const Decoder = (globalThis as { ImageDecoder?: PictureDecoderClass }).ImageDecoder;
  if (!Decoder || !(await Decoder.isTypeSupported(type))) return null;
  const decoder = new Decoder({ data: await file.arrayBuffer(), type });
  try {
    await decoder.tracks.ready;
    await decoder.completed;
    const track = decoder.tracks.selectedTrack;
    if (!track?.animated || track.frameCount < MOVING_STICKER.minFrames) return null;
    const shown: number[] = [];
    let time = 0;
    for (let index = 0; index < track.frameCount && time < MOVING_STICKER.maxDuration; index++) {
      const { image } = await decoder.decode({ frameIndex: index });
      const says = image.duration ? image.duration / 1000 : 0;
      image.close();
      shown.push(says >= MOVING_STICKER.minDelay ? says : 100);
      time += shown[index]!;
    }
    const context = square();
    const pictures: ImageData[] = [];
    let last = -1;
    const take = async (index: number) => {
      if (index !== last) {
        const { image } = await decoder.decode({ frameIndex: index });
        try {
          pictures.push(fitted(context, image, image.displayWidth, image.displayHeight));
        } finally {
          image.close();
        }
        last = index;
      } else pictures.push(pictures.at(-1)!);
    };
    const whole = shown.length === track.frameCount ? asItWas(shown) : null;
    if (whole) {
      for (const { index } of whole) await take(index);
      return { pictures, delays: whole.map((each) => each.delay) };
    }
    const { at, delay } = steps(time);
    let index = 0;
    let ends = shown[0]!;
    for (const when of at) {
      while (index + 1 < shown.length && ends <= when) ends += shown[++index]!;
      await take(index);
    }
    return { pictures, delays: at.map(() => delay) };
  } finally {
    decoder.close();
  }
}

function videoSays(video: HTMLVideoElement, event: string, start: () => void, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      window.clearTimeout(timer);
      video.removeEventListener(event, yes);
      video.removeEventListener("error", no);
      resolve(ok);
    };
    const yes = () => done(true);
    const no = () => done(false);
    const timer = window.setTimeout(() => done(false), ms);
    video.addEventListener(event, yes);
    video.addEventListener("error", no);
    start();
  });
}

async function videoFrames(file: Blob): Promise<Frames | null> {
  const address = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  const until = performance.now() + VIDEO_MS;
  const left = () => Math.min(5000, until - performance.now());
  try {
    if (!(await videoSays(video, "loadedmetadata", () => (video.src = address), left()))) return null;
    if (video.videoWidth * video.videoHeight > MOVING_PIXELS) throw new StickerError("too_big");
    video.preload = "auto";
    if (video.duration === Infinity && !(await videoSays(video, "seeked", () => (video.currentTime = 1e6), left()))) return null;
    const duration = video.duration * 1000;
    if (!Number.isFinite(duration) || !(duration > 0) || !video.videoWidth || !video.videoHeight) return null;
    const { at, delay } = steps(duration);
    const context = square();
    const pictures: ImageData[] = [];
    for (const when of at) {
      const ms = left();
      if (!(ms > 0 && (await videoSays(video, "seeked", () => (video.currentTime = when / 1000), ms)))) {
        if (left() <= 0 && pictures.length >= MOVING_STICKER.minFrames) break;
        return null;
      }
      pictures.push(fitted(context, video, video.videoWidth, video.videoHeight));
    }
    return { pictures, delays: pictures.map(() => delay) };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(address);
  }
}

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

async function openPicture(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
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

export function addProblemOf(error: unknown): StickerAddProblem {
  if (error instanceof StickerError) return error.problem;
  if (error instanceof ApiError) {
    if (error.code === "not_a_picture" || error.code === "too_big" || error.code === "full" || error.code === "site_full") return error.code;
    if (error.status === 429) return "too_many";
  }
  return "failed";
}

interface Kept {
  stickers: PersonalSticker[] | null;
  status: "loading" | "ready" | "failed";
}
const kept = new Map<string, Kept>();
const listeners = new Set<() => void>();
const NOTHING: Kept = { stickers: null, status: "loading" };
const tell = () => listeners.forEach((listener) => listener());
const told = new Map<string, number>();
const toldOf = (profileId: string) => told.get(profileId) ?? 0;
const keep = (profileId: string, next: Kept) => {
  told.set(profileId, toldOf(profileId) + 1);
  kept.set(profileId, next);
  tell();
};
export const tookCollection = (profileId: string, answer: MyStickers) => keep(profileId, { stickers: answer.stickers, status: "ready" });

export function lookAgain(profileId: string): Promise<void> {
  const asked = toldOf(profileId);
  return personalStickerApi.list(profileId).then(
    (answer) => {
      if (toldOf(profileId) === asked) tookCollection(profileId, answer);
    },
    () => undefined,
  );
}

export const keptCollection = (profileId: string): PersonalSticker[] | null => kept.get(profileId)?.stickers ?? null;

export interface MyStickersView {
  stickers: PersonalSticker[] | null;
  status: "loading" | "ready" | "failed";
  add: (file: Blob, moving?: boolean) => Promise<StickerAddProblem | null>;
  remove: (id: string) => Promise<boolean>;
  retry: () => void;
}

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
      const make = (picture: string, delays?: number[]) =>
        personalStickerApi.make(profileId, picture, delays).catch(async (error: unknown) => {
          if (!(error instanceof ApiError && error.status === 503 && error.code === "busy")) throw error;
          await new Promise((resolve) => setTimeout(resolve, Math.min(10, Math.max(1, error.retryAfter ?? 5)) * 1000));
          return personalStickerApi.make(profileId, picture, delays);
        });
      try {
        const picture = moving ? await movingPicture(file) : null;
        let made: Awaited<ReturnType<typeof make>>;
        if (picture && picture.delays !== undefined) {
          made = await make(picture.data, picture.delays).catch((error: unknown) => {
            if (error instanceof ApiError && (error.code === "not_a_picture" || error.code === "too_big")) return make(picture.still);
            throw error;
          });
        } else {
          made = await make(picture ? picture.still : await stickerPicture(file));
        }
        tookCollection(profileId, made);
        return null;
      } catch (error) {
        const problem = addProblemOf(error);
        if (problem === "failed") void lookAgain(profileId);
        return problem;
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
        if (error instanceof ApiError && error.status === 404) load();
        return false;
      }
    },
    [profileId, load],
  );
  return { stickers: now.stickers, status: now.status, add, remove, retry: load };
}

export type SaveNote = "saved" | "full" | "gone" | "failed";
export const SAVE_NOTE: Record<SaveNote, Key> = {
  saved: "chat.stickerSavedNote",
  full: "chat.stickerFull",
  gone: "chat.stickerGone",
  failed: "chat.stickerSaveFailed",
};

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

export function forgetPersonalStickers(): void {
  offered = undefined;
  kept.clear();
  told.clear();
  tell();
}
