import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { PNG } from "pngjs";
import { MOVING_STICKER, PERSONAL_STICKER } from "../../shared";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const STICKER_MIN_SIDE = 16;

export interface PngHeader {
  width: number;
  height: number;
  depth: number;
  colour: number;
  compression: number;
  filter: number;
  interlace: number;
}

export function pngHeader(data: Buffer): PngHeader | undefined {
  if (data.length < 33 || !data.subarray(0, 8).equals(SIGNATURE)) return undefined;
  if (data.readUInt32BE(8) !== 13 || data.toString("latin1", 12, 16) !== "IHDR") return undefined;
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
    depth: data[24]!,
    colour: data[25]!,
    compression: data[26]!,
    filter: data[27]!,
    interlace: data[28]!,
  };
}

function dataOf(png: Buffer): Buffer | undefined {
  const parts: Buffer[] = [];
  let at = 8;
  while (at + 12 <= png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString("latin1", at + 4, at + 8);
    const end = at + 12 + length;
    if (end > png.length) return undefined;
    if (type === "IHDR" && at !== 8) return undefined;
    if (type === "IDAT") parts.push(png.subarray(at + 8, at + 8 + length));
    if (type === "IEND") return parts.length > 0 && end === png.length ? Buffer.concat(parts) : undefined;
    at = end;
  }
  return undefined;
}

export type MadeSticker = { ok: true; data: Buffer; hash: string } | { ok: false; error: "not_a_picture" | "too_big" };

export const pictureType = (data: Buffer): "image/webp" | "image/png" =>
  data.length >= 12 && data.toString("latin1", 0, 4) === "RIFF" && data.toString("latin1", 8, 12) === "WEBP" ? "image/webp" : "image/png";

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const DEPTHS: Record<number, readonly number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };

export function stickerShaped(head: PngHeader, frames = 1): boolean {
  return (
    head.height === head.width * frames &&
    head.width >= STICKER_MIN_SIDE &&
    head.width <= PERSONAL_STICKER.side &&
    (DEPTHS[head.colour]?.includes(head.depth) ?? false) &&
    head.compression === 0 &&
    head.filter === 0 &&
    head.interlace === 0
  );
}

const unpackedSize = (head: PngHeader) => (Math.ceil((head.width * CHANNELS[head.colour]! * head.depth) / 8) + 1) * head.height;

const NOT_A_PICTURE = { ok: false, error: "not_a_picture" } as const;

function pixelsOf(sent: Buffer, frames: number): { ok: true; head: PngHeader; pixels: Buffer; opaque: boolean } | typeof NOT_A_PICTURE {
  const head = pngHeader(sent);
  if (!head || !stickerShaped(head, frames)) return NOT_A_PICTURE;
  const packed = dataOf(sent);
  if (!packed) return NOT_A_PICTURE;
  const rows = unpackedSize(head);
  try {
    if (inflateSync(packed, { maxOutputLength: rows }).length !== rows) return NOT_A_PICTURE;
  } catch {
    return NOT_A_PICTURE;
  }
  let pixels: Buffer;
  try {
    const read = PNG.sync.read(sent, { checkCRC: true });
    if (read.width !== head.width || read.height !== head.height || read.data.length !== head.width * head.height * 4) return NOT_A_PICTURE;
    pixels = Buffer.from(read.data);
  } catch {
    return NOT_A_PICTURE;
  }
  let opaque = true;
  let seen = false;
  for (let at = 3; at < pixels.length; at += 4) {
    if (pixels[at] !== 255) opaque = false;
    if (pixels[at] !== 0) seen = true;
  }
  return seen ? { ok: true, head, pixels, opaque } : NOT_A_PICTURE;
}

function stillOf(pixels: Buffer, side: number, opaque: boolean): MadeSticker {
  const made = new PNG({ width: side, height: side });
  pixels.copy(made.data, 0, 0, side * side * 4);
  const data = PNG.sync.write(made, { colorType: opaque ? 2 : 6, inputColorType: 6, inputHasAlpha: true, deflateLevel: 9 });
  return { ok: true, data, hash: createHash("sha256").update(data).digest("base64url") };
}

export function makeSticker(sent: Buffer): MadeSticker {
  if (sent.length > PERSONAL_STICKER.sentBytes) return { ok: false, error: "too_big" };
  const read = pixelsOf(sent, 1);
  return read.ok ? stillOf(read.pixels, read.head.width, read.opaque) : read;
}

type Sharp = typeof import("sharp").default;
let sharpLoaded: Promise<Sharp> | undefined;
function loadSharp(): Promise<Sharp> {
  sharpLoaded ??= import("sharp").then(
    ({ default: sharp }) => {
      sharp.cache(false);
      sharp.concurrency(1);
      return sharp;
    },
    (error: unknown) => {
      sharpLoaded = undefined;
      throw error;
    },
  );
  return sharpLoaded;
}

const QUALITIES = [72, 50] as const;
const PACK_SECONDS = 10;

let packing: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(pack: () => Promise<T>): Promise<T> {
  const mine = packing.then(pack, pack);
  packing = mine.catch(() => {});
  return mine;
}

export async function makeMovingSticker(sent: Buffer, delays: readonly number[], spend: (ms: number) => void = () => {}): Promise<MadeSticker> {
  if (sent.length > MOVING_STICKER.sentBytes) return { ok: false, error: "too_big" };
  const frames = delays.length;
  if (
    frames < MOVING_STICKER.minFrames ||
    frames > MOVING_STICKER.maxFrames ||
    delays.some((delay) => !Number.isInteger(delay) || delay < MOVING_STICKER.minDelay || delay > MOVING_STICKER.maxDelay) ||
    delays.reduce((all, delay) => all + delay, 0) > MOVING_STICKER.maxDuration
  ) {
    return NOT_A_PICTURE;
  }
  const began = performance.now();
  let read: ReturnType<typeof pixelsOf>;
  let moves = false;
  try {
    read = pixelsOf(sent, frames);
    if (!read.ok) return read;
    const square = read.head.width * read.head.width * 4;
    const first = read.pixels.subarray(0, square);
    for (let frame = 1; frame < frames && !moves; frame++) moves = !read.pixels.subarray(frame * square, (frame + 1) * square).equals(first);
    if (!moves) return stillOf(read.pixels, read.head.width, read.opaque);
  } finally {
    spend(performance.now() - began);
  }
  const { pixels } = read;
  const side = read.head.width;
  const sharp = await loadSharp();
  return oneAtATime(async (): Promise<MadeSticker> => {
    const packing = performance.now();
    try {
      for (const quality of QUALITIES) {
        const data = await sharp(pixels, { raw: { width: side, height: side * frames, channels: 4, pageHeight: side } })
          .timeout({ seconds: PACK_SECONDS })
          .webp({ quality, alphaQuality: 90, effort: 4, loop: 0, delay: [...delays] })
          .toBuffer();
        if (data.length <= MOVING_STICKER.keptBytes) return { ok: true, data, hash: createHash("sha256").update(data).digest("base64url") };
      }
      return { ok: false, error: "too_big" };
    } finally {
      spend(performance.now() - packing);
    }
  });
}
