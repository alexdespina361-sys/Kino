// A small PNG reader (8 bits per channel, not interlaced: grey, grey + alpha, RGB, RGB + alpha, palette), for reading the colours a model was painted with.
// Development tooling only.
import { inflateSync } from "node:zlib";

export interface Png {
  w: number;
  h: number;
  /** Four bytes per pixel, rows from the top. */
  rgba: Uint8Array;
}

export function readPng(buf: Uint8Array): Png {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0) !== 0x89504e47) throw new Error("not a png");
  let off = 8;
  let w = 0;
  let h = 0;
  let depth = 0;
  let type = 0;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (off < buf.length) {
    const len = dv.getUint32(off);
    const kind = String.fromCharCode(buf[off + 4]!, buf[off + 5]!, buf[off + 6]!, buf[off + 7]!);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (kind === "IHDR") {
      w = dv.getUint32(off + 8);
      h = dv.getUint32(off + 12);
      depth = buf[off + 16]!;
      type = buf[off + 17]!;
      interlace = buf[off + 20]!;
    } else if (kind === "PLTE") palette = data;
    else if (kind === "tRNS") trns = data;
    else if (kind === "IDAT") idat.push(data);
    off += 12 + len;
  }
  if (depth !== 8 || interlace !== 0) throw new Error(`png: only 8-bit, not interlaced (depth ${depth}, interlace ${interlace})`);
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type];
  if (!channels) throw new Error(`png: colour type ${type}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const px = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[y * stride + x - channels]! : 0;
      const b = y > 0 ? px[(y - 1) * stride + x]! : 0;
      const c = x >= channels && y > 0 ? px[(y - 1) * stride + x - channels]! : 0;
      let v = raw[src + x]!;
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = v & 255;
    }
  }
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    let r: number, g: number, b: number, a = 255;
    if (type === 6) { r = px[i * 4]!; g = px[i * 4 + 1]!; b = px[i * 4 + 2]!; a = px[i * 4 + 3]!; }
    else if (type === 2) { r = px[i * 3]!; g = px[i * 3 + 1]!; b = px[i * 3 + 2]!; }
    else if (type === 0) { r = g = b = px[i]!; }
    else if (type === 4) { r = g = b = px[i * 2]!; a = px[i * 2 + 1]!; }
    else { const k = px[i]!; r = palette![k * 3]!; g = palette![k * 3 + 1]!; b = palette![k * 3 + 2]!; a = trns && k < trns.length ? trns[k]! : 255; }
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = a;
  }
  return { w, h, rgba };
}
