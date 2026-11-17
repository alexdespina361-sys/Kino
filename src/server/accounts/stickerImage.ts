import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { PNG } from "pngjs";
import { MOVING_STICKER, PERSONAL_STICKER } from "../../shared";

/**
 * A personal sticker's picture, as the server keeps it (shared/stickers.ts). What comes is a PNG the page made; what is kept is a PNG made here from its
 * pixels, so nothing the sender put into the file (text, other chunks, a second picture, anything a viewer might read) is kept or sent on.
 *
 * The file's header is read before anything is unpacked: a square, no bigger than the page makes it, a kind of PNG there is, and not interlaced. Then its data is unpacked here, never to more than the header says, and has to be exactly that; only then does `pngjs` read it. So a small
 * file that would unpack to a huge picture is turned away before it is unpacked, and one cut short (or with more inside) is not taken either.
 */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** The smallest side a sticker may have. */
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

/** What the header of a PNG says (the first chunk, which must be the header), or nothing for what is not a PNG. Nothing is unpacked. */
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

/** The picture's packed data (its IDAT chunks, one after another), or nothing for a file whose chunks do not add up to the file or that has no end. */
function dataOf(png: Buffer): Buffer | undefined {
  const parts: Buffer[] = [];
  let at = 8;
  while (at + 12 <= png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString("latin1", at + 4, at + 8);
    const end = at + 12 + length;
    if (end > png.length) return undefined;
    if (type === "IDAT") parts.push(png.subarray(at + 8, at + 8 + length));
    if (type === "IEND") return parts.length > 0 ? Buffer.concat(parts) : undefined;
    at = end;
  }
  return undefined;
}

/** A sticker made: its picture as kept (a PNG, or an animated WebP for one that moves) and the hash of it. */
export type MadeSticker = { ok: true; data: Buffer; hash: string } | { ok: false; error: "not_a_picture" | "too_big" };

/** What kind of picture kept bytes are, by their first bytes: what the server made is a PNG or a WebP, and nothing else. */
export const pictureType = (data: Buffer): "image/webp" | "image/png" =>
  data.length >= 12 && data.toString("latin1", 0, 4) === "RIFF" && data.toString("latin1", 8, 12) === "WEBP" ? "image/webp" : "image/png";

/**
 * The kinds of PNG there are (grey, colour, a palette, grey and alpha, colour and alpha), with how many values a pixel has and the depths each may have: what a
 * browser's canvas writes is one of them, and which one is the browser's to choose (all are made 8-bit colour with alpha when they are read).
 */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const DEPTHS: Record<number, readonly number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };

/**
 * Whether a header is one of a sticker the page made: checked before the picture is unpacked. A still one is a square; one that moves (`frames` of them) is its
 * squares one under the other.
 */
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

/** What the data of a picture with this header unpacks to: each row, with the byte in front of it that says how it was packed. */
const unpackedSize = (head: PngHeader) => (Math.ceil((head.width * CHANNELS[head.colour]! * head.depth) / 8) + 1) * head.height;

const NOT_A_PICTURE = { ok: false, error: "not_a_picture" } as const;

/**
 * The pixels of a PNG a page made (8-bit colour and alpha, four bytes a pixel), read only once its header is one of a sticker's (`frames` squares) and its data
 * unpacks to exactly what the header says; and whether any of them can be seen, and whether all of them are opaque. Nothing else of the file is kept.
 */
function pixelsOf(sent: Buffer, frames: number): { ok: true; head: PngHeader; pixels: Buffer; opaque: boolean } | typeof NOT_A_PICTURE {
  const head = pngHeader(sent);
  if (!head || !stickerShaped(head, frames)) return NOT_A_PICTURE;
  // (What the picture's data unpacks to is exactly what its header says, and never more is unpacked: a file cut short, or one with more inside, is not one a page made.)
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

/** A PNG made here of a square's pixels. */
function stillOf(pixels: Buffer, side: number, opaque: boolean): MadeSticker {
  const made = new PNG({ width: side, height: side });
  pixels.copy(made.data, 0, 0, side * side * 4);
  const data = PNG.sync.write(made, { colorType: opaque ? 2 : 6, inputColorType: 6, inputHasAlpha: true, deflateLevel: 9 });
  return { ok: true, data, hash: createHash("sha256").update(data).digest("base64url") };
}

/**
 * The sticker made of what a page sent: a PNG of its pixels, made here (an opaque picture without the alpha it does not use), and the hash of it (the same
 * picture made twice is one sticker). A file that is not such a PNG, is broken, or is all see-through, is not a picture.
 */
export function makeSticker(sent: Buffer): MadeSticker {
  if (sent.length > PERSONAL_STICKER.sentBytes) return { ok: false, error: "too_big" };
  const read = pixelsOf(sent, 1);
  return read.ok ? stillOf(read.pixels, read.head.width, read.opaque) : read;
}

/* ------------------------------ stickers that move ------------------------------ */

type Sharp = typeof import("sharp").default;
let sharpLoaded: Promise<Sharp> | undefined;
/**
 * sharp (libvips), asked for the first time a sticker that moves is made: a server that never makes one never loads it. It is given only pixels this file read
 * (never what a page sent), keeps nothing of them between pictures, and makes one picture with one thread at a time (a sticker is small; the site's other
 * work comes first).
 */
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

/** How good the WebP is made, the best first: one that does not fit what is kept is made again, worse. */
const QUALITIES = [72, 50] as const;
/** How long sharp may take over one WebP (seconds): it stops then, and the sticker is not made. A sticker's takes a fraction of one. */
const PACK_SECONDS = 10;

/**
 * One sticker is packed at a time, the whole site over (the judge, 17 Nov: four sent at once were four packed at once, each with a thread of its own, beside
 * everything else the server does): the next waits for the one before, made or not.
 */
let packing: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(pack: () => Promise<T>): Promise<T> {
  const mine = packing.then(pack, pack);
  packing = mine.catch(() => {});
  return mine;
}

/**
 * The sticker that moves made of what a page sent (shared/stickers.ts `MOVING_STICKER`): its pictures one under the other, as one PNG, read here as a still one
 * is, and how long each is shown. What is kept is an animated WebP made here of their pixels, that goes round and round. Pictures that are all the same are a
 * still sticker (a PNG). Too many pictures, too long a time, or a size that is not so many squares, is not a picture; one that does not fit in what is kept even
 * at the lesser quality is too big. sharp failing (or missing) is said by the error it throws: the page makes a still one then.
 */
export async function makeMovingSticker(sent: Buffer, delays: readonly number[]): Promise<MadeSticker> {
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
  const read = pixelsOf(sent, frames);
  if (!read.ok) return read;
  const side = read.head.width;
  const square = side * side * 4;
  const first = read.pixels.subarray(0, square);
  let moves = false;
  for (let frame = 1; frame < frames && !moves; frame++) moves = !read.pixels.subarray(frame * square, (frame + 1) * square).equals(first);
  if (!moves) return stillOf(read.pixels, side, read.opaque);
  const sharp = await loadSharp();
  return oneAtATime(async (): Promise<MadeSticker> => {
    for (const quality of QUALITIES) {
      const data = await sharp(read.pixels, { raw: { width: side, height: side * frames, channels: 4, pageHeight: side } })
        .timeout({ seconds: PACK_SECONDS })
        .webp({ quality, alphaQuality: 90, effort: 4, loop: 0, delay: [...delays] })
        .toBuffer();
      if (data.length <= MOVING_STICKER.keptBytes) return { ok: true, data, hash: createHash("sha256").update(data).digest("base64url") };
    }
    return { ok: false, error: "too_big" };
  });
}
