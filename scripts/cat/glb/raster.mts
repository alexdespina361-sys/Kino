// A tiny software renderer for looking at meshes while the free model is being fitted: orthographic views with a z-buffer, flat shading, a labelled grid, PNG out.
// Development tooling only.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

export interface Soup {
  /** Three numbers per vertex: x forward, y up, z toward the viewer. */
  pos: ArrayLike<number>;
  tri: ArrayLike<number>;
  /** Optional colour per vertex (three numbers, 0..1). */
  color?: ArrayLike<number>;
  /** Optional normals per vertex (in the same axes as pos) and ambient light per vertex (0..1): when given, the picture is lit from them. */
  normal?: ArrayLike<number>;
  open?: ArrayLike<number>;
}

export type ViewName = "side" | "front" | "top" | "three" | "threeBack";

export interface Shot {
  view: ViewName;
  /** Pixels per unit and the point of the view's plane that is at the middle of the picture. */
  scale: number;
  centre: [number, number];
  width: number;
  height: number;
  /** Grid spacing in units (0: none). */
  grid?: number;
  label?: string;
  /** Mark these points (x, y, z) with a cross and the given text. */
  marks?: Array<{ p: [number, number, number]; text: string; color?: [number, number, number] }>;
}

const FONT: Record<string, number[]> = {
  "0": [7, 5, 5, 5, 7],
  "1": [2, 6, 2, 2, 7],
  "2": [7, 1, 7, 4, 7],
  "3": [7, 1, 7, 1, 7],
  "4": [5, 5, 7, 1, 1],
  "5": [7, 4, 7, 1, 7],
  "6": [7, 4, 7, 5, 7],
  "7": [7, 1, 1, 1, 1],
  "8": [7, 5, 7, 5, 7],
  "9": [7, 5, 7, 1, 7],
  ".": [0, 0, 0, 0, 2],
  "-": [0, 0, 7, 0, 0],
  " ": [0, 0, 0, 0, 0],
  a: [2, 5, 7, 5, 5],
  b: [6, 5, 6, 5, 6],
  c: [3, 4, 4, 4, 3],
  d: [6, 5, 5, 5, 6],
  e: [7, 4, 6, 4, 7],
  f: [7, 4, 6, 4, 4],
  g: [3, 4, 5, 5, 3],
  h: [5, 5, 7, 5, 5],
  i: [7, 2, 2, 2, 7],
  k: [5, 6, 4, 6, 5],
  l: [4, 4, 4, 4, 7],
  m: [5, 7, 7, 5, 5],
  n: [6, 5, 5, 5, 5],
  o: [2, 5, 5, 5, 2],
  p: [6, 5, 6, 4, 4],
  r: [6, 5, 6, 5, 5],
  s: [3, 4, 2, 1, 6],
  t: [7, 2, 2, 2, 2],
  u: [5, 5, 5, 5, 7],
  w: [5, 5, 7, 7, 5],
  x: [5, 5, 2, 5, 5],
  y: [5, 5, 2, 2, 2],
};

function text(img: Uint8Array, w: number, h: number, x: number, y: number, s: string, rgb: [number, number, number], k = 2): void {
  let cx = x;
  for (const ch of s.toLowerCase()) {
    const g = FONT[ch] ?? FONT[" "]!;
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
      if (!(g[r]! & (4 >> c))) continue;
      for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) {
        const px = cx + c * k + dx;
        const py = y + r * k + dy;
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        const o = (py * w + px) * 4;
        img[o] = rgb[0]; img[o + 1] = rgb[1]; img[o + 2] = rgb[2]; img[o + 3] = 255;
      }
    }
    cx += 4 * k;
  }
}

/** Rotates a point into a view: returns (screen x, screen y up, depth toward the viewer). */
function project(view: ViewName, x: number, y: number, z: number): [number, number, number] {
  switch (view) {
    case "side": return [x, y, z];
    case "front": return [-z, y, x];
    case "top": return [x, -z, y];
    case "three": { const a = 0.6; const c = Math.cos(a), s = Math.sin(a); return [x * c - z * s, y, x * s + z * c]; }
    case "threeBack": { const a = 0.6 + Math.PI; const c = Math.cos(a), s = Math.sin(a); return [x * c - z * s, y, x * s + z * c]; }
  }
}

export function renderSoup(soup: Soup, shot: Shot): Uint8Array {
  const { width: W, height: H } = shot;
  const img = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { img[i * 4] = 24; img[i * 4 + 1] = 24; img[i * 4 + 2] = 30; img[i * 4 + 3] = 255; }
  const depth = new Float32Array(W * H).fill(-1e9);
  const nV = soup.pos.length / 3;
  // the vertices, projected
  const sx = new Float64Array(nV), sy = new Float64Array(nV), sz = new Float64Array(nV);
  const px = (u: number) => W / 2 + (u - shot.centre[0]) * shot.scale;
  const py = (v: number) => H / 2 - (v - shot.centre[1]) * shot.scale;
  for (let v = 0; v < nV; v++) {
    const [u, w, d] = project(shot.view, soup.pos[v * 3]!, soup.pos[v * 3 + 1]!, soup.pos[v * 3 + 2]!);
    sx[v] = px(u); sy[v] = py(w); sz[v] = d;
  }
  // smooth normals in the view
  const nx = new Float64Array(nV), ny = new Float64Array(nV), nz = new Float64Array(nV);
  const T = soup.tri.length / 3;
  if (soup.normal) {
    for (let v = 0; v < nV; v++) {
      const [a, b, c] = project(shot.view, soup.normal[v * 3]!, soup.normal[v * 3 + 1]!, soup.normal[v * 3 + 2]!);
      nx[v] = a; ny[v] = b; nz[v] = c;
    }
  }
  for (let t = 0; t < T && !soup.normal; t++) {
    const a = soup.tri[t * 3]!, b = soup.tri[t * 3 + 1]!, c = soup.tri[t * 3 + 2]!;
    const ux = sx[b]! - sx[a]!, uy = -(sy[b]! - sy[a]!), uz = sz[b]! - sz[a]!;
    const vx = sx[c]! - sx[a]!, vy = -(sy[c]! - sy[a]!), vz = sz[c]! - sz[a]!;
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    for (const i of [a, b, c]) { nx[i]! += x; ny[i]! += y; nz[i]! += z; }
  }
  for (let v = 0; v < nV; v++) { const l = Math.hypot(nx[v]!, ny[v]!, nz[v]!) || 1; nx[v]! /= l; ny[v]! /= l; nz[v]! /= l; }
  const L = soup.normal ? [-0.45, 0.75, 0.55] : [-0.35, 0.6, 0.72];
  const ll = Math.hypot(L[0]!, L[1]!, L[2]!);
  for (let t = 0; t < T; t++) {
    const a = soup.tri[t * 3]!, b = soup.tri[t * 3 + 1]!, c = soup.tri[t * 3 + 2]!;
    const minX = Math.max(0, Math.floor(Math.min(sx[a]!, sx[b]!, sx[c]!)));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(sx[a]!, sx[b]!, sx[c]!)));
    const minY = Math.max(0, Math.floor(Math.min(sy[a]!, sy[b]!, sy[c]!)));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(sy[a]!, sy[b]!, sy[c]!)));
    const x0 = sx[a]!, y0 = sy[a]!, x1 = sx[b]!, y1 = sy[b]!, x2 = sx[c]!, y2 = sy[c]!;
    const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (Math.abs(den) < 1e-12) continue;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const qx = x + 0.5, qy = y + 0.5;
      const l0 = ((y1 - y2) * (qx - x2) + (x2 - x1) * (qy - y2)) / den;
      const l1 = ((y2 - y0) * (qx - x2) + (x0 - x2) * (qy - y2)) / den;
      const l2 = 1 - l0 - l1;
      if (l0 < -1e-4 || l1 < -1e-4 || l2 < -1e-4) continue;
      const d = l0 * sz[a]! + l1 * sz[b]! + l2 * sz[c]!;
      const o = y * W + x;
      if (d <= depth[o]!) continue;
      depth[o] = d;
      const x_ = l0 * nx[a]! + l1 * nx[b]! + l2 * nx[c]!;
      const y_ = l0 * ny[a]! + l1 * ny[b]! + l2 * ny[c]!;
      const z_ = l0 * nz[a]! + l1 * nz[b]! + l2 * nz[c]!;
      const nl = Math.hypot(x_, y_, z_) || 1;
      const lam = Math.max(0, (x_ * L[0]! + y_ * L[1]! + z_ * L[2]!) / (nl * ll));
      let shade = 0.28 + 0.72 * lam;
      if (soup.normal) {
        // a warm key from above and the front with a wrap, a cool fill, and the ambient light each point has
        const wrap = Math.min(1, Math.max(0, ((x_ * L[0]! + y_ * L[1]! + z_ * L[2]!) / (nl * ll) + 0.45) / 1.45));
        const sky = 0.5 + 0.5 * (y_ / nl);
        const o = soup.open ? l0 * soup.open[a]! + l1 * soup.open[b]! + l2 * soup.open[c]! : 1;
        shade = (0.22 + 0.62 * wrap * wrap * (3 - 2 * wrap) + 0.22 * sky) * (0.55 + 0.45 * o);
      }
      let r = 0.78, g = 0.78, bl = 0.8;
      if (soup.color) {
        r = l0 * soup.color[a * 3]! + l1 * soup.color[b * 3]! + l2 * soup.color[c * 3]!;
        g = l0 * soup.color[a * 3 + 1]! + l1 * soup.color[b * 3 + 1]! + l2 * soup.color[c * 3 + 1]!;
        bl = l0 * soup.color[a * 3 + 2]! + l1 * soup.color[b * 3 + 2]! + l2 * soup.color[c * 3 + 2]!;
      }
      img[o * 4] = Math.round(255 * Math.min(1, r * shade));
      img[o * 4 + 1] = Math.round(255 * Math.min(1, g * shade));
      img[o * 4 + 2] = Math.round(255 * Math.min(1, bl * shade));
    }
  }
  // the grid, over the picture: thin lines, a thicker one at each whole unit, labelled
  if (shot.grid && shot.view !== "three" && shot.view !== "threeBack") {
    const g = shot.grid;
    const uMin = shot.centre[0] - W / 2 / shot.scale, uMax = shot.centre[0] + W / 2 / shot.scale;
    const vMin = shot.centre[1] - H / 2 / shot.scale, vMax = shot.centre[1] + H / 2 / shot.scale;
    const blend = (x: number, y: number, rgb: [number, number, number], a: number): void => {
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      const o = (y * W + x) * 4;
      img[o] = Math.round(img[o]! * (1 - a) + rgb[0] * a);
      img[o + 1] = Math.round(img[o + 1]! * (1 - a) + rgb[1] * a);
      img[o + 2] = Math.round(img[o + 2]! * (1 - a) + rgb[2] * a);
    };
    for (let u = Math.ceil(uMin / g) * g; u <= uMax; u += g) {
      const x = Math.round(px(u));
      const major = Math.abs(u / (g * 5) - Math.round(u / (g * 5))) < 1e-6;
      for (let y = 0; y < H; y++) blend(x, y, [255, 200, 80], major ? 0.5 : 0.18);
      if (major) text(img, W, H, x + 2, H - 12, u.toFixed(2), [255, 210, 120]);
    }
    for (let v = Math.ceil(vMin / g) * g; v <= vMax; v += g) {
      const y = Math.round(py(v));
      const major = Math.abs(v / (g * 5) - Math.round(v / (g * 5))) < 1e-6;
      for (let x = 0; x < W; x++) blend(x, y, [255, 200, 80], major ? 0.5 : 0.18);
      if (major) text(img, W, H, 2, y - 12, v.toFixed(2), [255, 210, 120]);
    }
  }
  for (const m of shot.marks ?? []) {
    const [u, w] = project(shot.view, m.p[0], m.p[1], m.p[2]);
    const x = Math.round(px(u)), y = Math.round(py(w));
    const col = m.color ?? [255, 60, 60];
    for (let d = -5; d <= 5; d++) {
      for (const [ax, ay] of [[x + d, y], [x, y + d]] as const) {
        if (ax < 0 || ay < 0 || ax >= W || ay >= H) continue;
        const o = (ay * W + ax) * 4;
        img[o] = col[0]; img[o + 1] = col[1]; img[o + 2] = col[2];
      }
    }
    text(img, W, H, x + 7, y - 4, m.text, col, 2);
  }
  if (shot.label) text(img, W, H, 6, 6, shot.label, [235, 235, 240], 2);
  return img;
}

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Uint8Array): number => {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]!) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
export function writePng(path: string, rgba: Uint8Array, w: number, h: number): void {
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1); }
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 6;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))];
  writeFileSync(path, Buffer.concat(parts));
}

/** Several shots side by side in one picture. */
export function sheet(path: string, soup: Soup, shots: Shot[], cols = shots.length): void {
  const w = shots[0]!.width, h = shots[0]!.height;
  const rows = Math.ceil(shots.length / cols);
  const out = new Uint8Array(w * cols * h * rows * 4);
  shots.forEach((s, i) => {
    const img = renderSoup(soup, s);
    const cx = (i % cols) * w, cy = Math.floor(i / cols) * h;
    for (let y = 0; y < h; y++) out.set(img.subarray(y * w * 4, (y + 1) * w * 4), ((cy + y) * w * cols + cx) * 4);
  });
  writePng(path, out, w * cols, h * rows);
}
