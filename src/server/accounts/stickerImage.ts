import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { PNG } from "pngjs";
import { PERSONAL_STICKER } from "../../shared";

/**
 * A personal sticker's picture, as the server keeps it (shared/stickers.ts). What comes is a PNG the page made; what is kept is a PNG made here from its
 * pixels, so nothing the sender put into the file (text, other chunks, a second picture, anything a viewer might read) is kept or sent on.
 *
 * The file's header is read before anything is unpacked: a square, no bigger than the page makes it, 8 bits of red, green and blue (and alpha), and not
 * interlaced. Then its data is unpacked here, never to more than the header says, and has to be exactly that; only then does `pngjs` read it. So a small
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

export type MadeSticker ={ ok: true; png: Buffer; hash: string } | { ok: false; error: "not_a_picture" | "too_big" };

/** Whether a header is one of a sticker the page made: checked before the picture is unpacked. */
export function stickerShaped(head: PngHeader): boolean {
  return (
    head.width === head.height &&
    head.width >= STICKER_MIN_SIDE &&
    head.width <= PERSONAL_STICKER.side &&
    head.depth === 8 &&
    (head.colour === 2 || head.colour === 6) &&
    head.compression === 0 &&
    head.filter === 0 &&
    head.interlace === 0
  );
}

/**
 * The sticker made of what a page sent: a PNG of its pixels, made here (an opaque picture without the alpha it does not use), and the hash of it (the same
 * picture made twice is one sticker). A file that is not such a PNG, is broken, or is all see-through, is not a picture.
 */
export function makeSticker(sent: Buffer): MadeSticker {
  if (sent.length > PERSONAL_STICKER.sentBytes) return { ok: false, error: "too_big" };
  const head = pngHeader(sent);
  if (!head || !stickerShaped(head)) return { ok: false, error: "not_a_picture" };
  // (What the picture's data unpacks to is exactly what its header says, and never more is unpacked: a file cut short, or one with more inside, is not one a page made.)
  const packed = dataOf(sent);
  if (!packed) return { ok: false, error: "not_a_picture" };
  const rows = (head.width * (head.colour === 6 ? 4 : 3) + 1) * head.height;
  try {
    if (inflateSync(packed, { maxOutputLength: rows }).length !== rows) return { ok: false, error: "not_a_picture" };
  } catch {
    return { ok: false, error: "not_a_picture" };
  }
  let pixels: Buffer;
  try {
    const read = PNG.sync.read(sent, { checkCRC: true });
    if (read.width !== head.width || read.height !== head.height || read.data.length !== head.width * head.height * 4) return { ok: false, error: "not_a_picture" };
    pixels = Buffer.from(read.data);
  } catch {
    return { ok: false, error: "not_a_picture" };
  }
  let opaque = true;
  let seen = false;
  for (let at = 3; at < pixels.length; at += 4) {
    if (pixels[at] !== 255) opaque = false;
    if (pixels[at] !== 0) seen = true;
  }
  if (!seen) return { ok: false, error: "not_a_picture" };
  const made = new PNG({ width: head.width, height: head.height });
  pixels.copy(made.data);
  const png = PNG.sync.write(made, { colorType: opaque ? 2 : 6, inputColorType: 6, inputHasAlpha: true, deflateLevel: 9 });
  return { ok: true, png, hash: createHash("sha256").update(png).digest("base64url") };
}
