import { HANG_AHEAD, HANG_DOWN } from "../engine/engine";
import type { CatCoat } from "../settings";
import { decodeClips } from "../render/gl/clipfile";
import { PLANS } from "../render/gl/director";
import { decodeMesh } from "../render/gl/format";
import { Skeleton, lengthOf } from "../render/gl/pose";
import { GlCat, type View } from "../render/gl/renderer";
import { CatRig, GALLOP_STRIDE, WALK_STRIDE } from "../render/rig";
import type { CatFrame } from "../types";
import { frameOf, POSES } from "./entry";

/**
 * The cat lab for the solid cat: pictures of it from several sides and in the poses of the pose sheet, made in a real browser by
 * scripts/cat/sheet.mjs. Development tooling only: nothing in the app imports this file.
 */

interface GlCell {
  label: string;
  frame: Partial<CatFrame>;
  view?: View;
  settle?: number;
  /** Looks closely at a place on the cat (its rest, in body lengths: x forward, y up, or `head` for where its head is) at this many times the size. */
  zoom?: { at: [number, number]; by: number } | { head: [number, number]; by: number };
  /** For the walk and the run: how far through a stride it is (0..1), which fixes where the feet are. */
  cycle?: number;
  /** How far the head is turned about the vertical against the body (radians), in place of what the rig says. */
  headYaw?: number;
  /** Draws the cat this many body lengths higher in its cell (one that hangs reaches below its feet line), and marks a point (x to the right, y up, from the feet) where a hand would be. */
  raise?: number;
  hand?: [number, number];
}

const STRIDE = { walk: WALK_STRIDE, run: GALLOP_STRIDE };

const BG = "#15151b";
const GROUND = "#2a2a35";

const fromBase64 = (text: string): ArrayBuffer => {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
};

export function glSheet(canvas: HTMLCanvasElement, mesh: string, clips: string, cells: readonly GlCell[], columns: number, scale = 1, seed = 7, cellW = 260, cellH = 220, coat: CatCoat = "ragdoll", over: View = {}): void {
  const cw = cellW * scale;
  const ch = cellH * scale;
  const rows = Math.ceil(cells.length / columns);
  canvas.width = cw * columns;
  canvas.height = ch * rows;
  const ctx = canvas.getContext("2d")!;
  const glCanvas = document.createElement("canvas");
  const cat = GlCat.create(glCanvas, fromBase64(mesh), fromBase64(clips), { preserve: true });
  if (!cat) throw new Error("no WebGL");
  cat.setCoat(coat);
  cat.resize(cw, ch, 1);
  const px = 150 * scale;
  cells.forEach((cell, i) => {
    const x0 = (i % columns) * cw;
    const y0 = Math.floor(i / columns) * ch;
    const rig = new CatRig(seed + i);
    const base = frameOf(cell.frame);
    // (a point of a cycle is a point of the clip's own stride: the ground one cycle of it carries the cat over)
    if (cell.cycle !== undefined) base.odometer = cell.cycle * (cat.director.strideOf(base.clip) || STRIDE[base.clip === "run" ? "run" : "walk"]) * px;
    rig.snapTo(base, px);
    const steps = Math.round((cell.settle ?? 1.2) * 60);
    for (let k = 0; k < steps; k++) {
      rig.update({ ...base, clipTime: k / 60 }, 1 / 60, px);
      // (headYawOf's own formula, the other way round)
      if (cell.headYaw !== undefined) rig.solved.head.yaw = 1 + cell.headYaw / ((Math.PI / 2) * rig.solved.flip);
      cat.step(rig.solved, { ox: cw / 2, oy: ch, px }, { ...cell.view, ...over });
    }
    ctx.fillStyle = BG;
    ctx.fillRect(x0, y0, cw, ch);
    const oy = ch - 24 * scale - (cell.raise ?? 0) * px;
    ctx.fillStyle = GROUND;
    ctx.fillRect(x0, y0 + oy, cw, 3 * scale);
    const z = cell.zoom;
    // (`head`: the place is where the head is, as the mesh's cat has it in this pose, and the number is how far from the head's centre to look at: ahead of it, and up)
    const at = z ? ("head" in z ? ((): [number, number] => { const head = cat.place("head"); return [head[0] + z.head[0], head[1] + z.head[1]]; })() : z.at) : undefined;
    const box = z && at ? { px: px * z.by, ox: cw / 2 - at[0] * px * z.by, oy: ch / 2 + at[1] * px * z.by } : { ox: cw / 2, oy, px };
    cat.draw(rig.solved, box, { ...cell.view, ...over });
    ctx.drawImage(glCanvas, x0, y0);
    if (cell.hand) {
      // (where the hand is: a cross)
      const hx = x0 + box.ox + cell.hand[0] * box.px;
      const hy = y0 + box.oy - cell.hand[1] * box.px;
      ctx.strokeStyle = "#4df";
      ctx.lineWidth = 2 * scale;
      ctx.beginPath();
      ctx.moveTo(hx - 9 * scale, hy);
      ctx.lineTo(hx + 9 * scale, hy);
      ctx.moveTo(hx, hy - 9 * scale);
      ctx.lineTo(hx, hy + 9 * scale);
      ctx.stroke();
    }
    ctx.fillStyle = "#9aa";
    ctx.font = `${13 * scale}px sans-serif`;
    ctx.fillText(cell.label, x0 + 8 * scale, y0 + 18 * scale);
  });
  cat.dispose();
}

/** How far the drawn cat reaches from its feet, in body lengths, as the pixels of a picture of it say (scripts/cat/extents.mjs). */
export interface Extent {
  label: string;
  /** The clip the engine calls it by (`walk@3` is a picture of `walk`). */
  clip: string;
  /** Furthest forward (the way it faces), furthest back (the tail), and how high; `down` is below the line its feet are on. */
  ahead: number;
  behind: number;
  up: number;
  down: number;
  /** Per band of a tenth of a body length from the feet up: how far back and forward the cat reaches at that height (both 0 where nothing is drawn). */
  profile: Array<[number, number]>;
  /** Where most of the cat is (all but the 12 % of its pixels furthest out at each end and the top 3 %: the body and the head, not the tail). */
  core: { behind: number; ahead: number; up: number };
}

/** The clip a picture of the extent cells is of. */
export const clipOfLabel = (label: string): string => (label.split("@")[0] ?? label).split(",")[0] ?? label;

/**
 * Pictures of the cat in each cell, one after another on one canvas, and what each takes of it: the box round every pixel the cat is drawn in (not the
 * faint ones: the fur's fringe and a whisker are not what covers a word). The cat faces right, its feet on a line at 0.8 of the canvas.
 */
export function glExtents(mesh: string, clips: string, cells: readonly GlCell[], coat: CatCoat = "ragdoll", seed = 7, alphaMin = 80): Extent[] {
  const W = 1200;
  const H = 900;
  const px = 150;
  const glCanvas = document.createElement("canvas");
  const cat = GlCat.create(glCanvas, fromBase64(mesh), fromBase64(clips), { preserve: true });
  if (!cat) throw new Error("no WebGL");
  cat.setCoat(coat);
  cat.resize(W, H, 1);
  const flat = document.createElement("canvas");
  flat.width = W;
  flat.height = H;
  const ctx = flat.getContext("2d", { willReadFrequently: true })!;
  const ox = W / 2;
  const oy = H * 0.8;
  const out: Extent[] = [];
  cells.forEach((cell, i) => {
    const rig = new CatRig(seed + i);
    const base = frameOf(cell.frame);
    // (a point of a cycle is a point of the clip's own stride: the ground one cycle of it carries the cat over)
    if (cell.cycle !== undefined) base.odometer = cell.cycle * (cat.director.strideOf(base.clip) || STRIDE[base.clip === "run" ? "run" : "walk"]) * px;
    rig.snapTo(base, px);
    const steps = Math.round((cell.settle ?? 1.2) * 60);
    for (let k = 0; k < steps; k++) {
      rig.update({ ...base, clipTime: k / 60 }, 1 / 60, px);
      cat.step(rig.solved, { ox, oy, px }, cell.view);
    }
    cat.draw(rig.solved, { ox, oy, px }, cell.view);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(glCanvas, 0, 0);
    const data = ctx.getImageData(0, 0, W, H).data;
    let x0 = W;
    let x1 = -1;
    let y0 = H;
    let y1 = -1;
    const bands = 16;
    const lo: number[] = new Array(bands).fill(W);
    const hi: number[] = new Array(bands).fill(-1);
    const column: number[] = new Array(W).fill(0);
    const row: number[] = new Array(H).fill(0);
    let mass = 0;
    for (let y = 0; y < H; y++) {
      const band = Math.floor(((oy - y - 1) / px) * 10);
      for (let x = 0; x < W; x++) {
        if ((data[(y * W + x) * 4 + 3] ?? 0) < alphaMin) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        column[x]!++;
        row[y]!++;
        mass++;
        if (band >= 0 && band < bands) {
          if (x < lo[band]!) lo[band] = x;
          if (x > hi[band]!) hi[band] = x;
        }
      }
    }
    const profile = lo.map((l, b): [number, number] => (hi[b]! < 0 ? [0, 0] : [(ox - l) / px, (hi[b]! + 1 - ox) / px]));
    // the places at which a share of the pixels has been passed, counting in from one end
    const share = (counts: number[], from: number, to: number, step: 1 | -1, part: number): number => {
      let sum = 0;
      for (let i = from; i !== to; i += step) {
        sum += counts[i]!;
        if (sum >= part * mass) return i;
      }
      return to;
    };
    const core = mass === 0 ? { behind: 0, ahead: 0, up: 0 } : { behind: (ox - share(column, 0, W, 1, 0.12)) / px, ahead: (share(column, W - 1, -1, -1, 0.12) + 1 - ox) / px, up: (oy - share(row, 0, H, 1, 0.03)) / px };
    const clip = clipOfLabel(cell.label);
    out.push(x1 < 0 ? { label: cell.label, clip, ahead: 0, behind: 0, up: 0, down: 0, profile, core } : { label: cell.label, clip, ahead: (x1 + 1 - ox) / px, behind: (ox - x0) / px, up: (oy - y0) / px, down: (y1 + 1 - oy) / px, profile, core });
  });
  cat.dispose();
  return out;
}

/**
 * Every posture the engine puts the cat in, a few moments of each that moves, for `glExtents`: as the page draws it (its own camera), the cat at rest at
 * several moments (the tail swishes and the head turns to what the cat looks at), the lively and the sleepy, so that the reach measured is the most of them.
 */
export const EXTENT_CELLS: GlCell[] = (() => {
  const cells: GlCell[] = [];
  const at = (label: string, frame: Partial<CatFrame>, settle = 1.2): void => void cells.push({ label, frame, settle });
  const base = (clip: string): Partial<CatFrame> => (clip === "curl" ? { clip: "curl", drowsy: 1 } : clip === "pet" ? { clip: "sit", petted: true } : clip === "yawn" ? { clip: "yawn", progress: 0.5 } : { clip: clip as CatFrame["clip"] });
  for (const clip of ["stand", "sit", "loaf", "curl", "crouch", "yawn", "point", "pet"] as const) at(clip, base(clip));
  // (a cat at rest for a while: the tail at other moments of its swish, a livelier tail, and the head turned up, down, forward and back)
  for (const clip of ["stand", "sit", "loaf", "curl"] as const) {
    for (const s of [0.6, 1.9, 2.6, 3.4]) at(`${clip}@t${s}`, base(clip), s);
    for (const s of [1.2, 2.2]) at(`${clip}@lively${s}`, { ...base(clip), energy: 1 }, s);
    if (clip === "curl") continue;
    for (const [name, look] of [["upfront", { x: 300, y: -200 }], ["upback", { x: -300, y: -200 }], ["downfront", { x: 300, y: 200 }], ["downback", { x: -300, y: 160 }]] as const) at(`${clip}@look-${name}`, { ...base(clip), look: { x: look.x, y: look.y } }, 1.6);
  }
  at("sit,viewer", { clip: "sit", viewer: true });
  for (const p of [0.25, 0.5, 0.75]) at(`stretch@${p}`, { clip: "stretch", progress: p });
  for (const p of [0.2, 0.5, 0.8]) at(`jump@${p}`, { clip: "jump", progress: p, grounded: false, vy: -300, vx: 300 }, 0.6);
  at("jump@down", { clip: "jump", progress: 0.7, grounded: false, vy: 600, vx: 300 }, 0.6);
  for (const t of [0.2, 0.6, 1.0, 1.4, 2.0]) at(`groom@${t}`, { clip: "groom", clipTime: t }, t);
  for (const s of [0.6, 1.0, 1.06, 1.3, 1.6]) {
    at(`scratch@${s}`, { clip: "scratch" }, s);
    at(`knead@${s}`, { clip: "knead" }, s);
    at(`wiggle@${s}`, { clip: "wiggle" }, s);
  }
  at("sniff", { clip: "sniff", progress: 0.5 });
  at("stalk", { clip: "stalk", odometer: 20 }, 1.0);
  // (looking over an edge; the paw out at the pointer, level, high and low, at several moments of its beat; nodding off through its cycle; a sleeper shifting)
  for (const s of [0.6, 1.4]) at(`peek@${s}`, { clip: "peek", look: { x: 240, y: 230 } }, s);
  for (const [name, reach] of [["level", { x: 105, y: -60 }], ["high", { x: 70, y: -190 }], ["low", { x: 100, y: 40 }]] as const) {
    at(`point@${name}`, { clip: "point", reach, look: reach }, 1.2);
    for (const t of [0.15, 0.4, 0.65]) at(`tap@${name}${t}`, { clip: "tap", clipTime: t, reach, look: reach }, t);
  }
  // (a swat at a poster: its beats, at the poster's lip -- just below the feet and a little ahead -- and, for the extent, level with the cat and high)
  for (const [name, reach] of [["lip", { x: 92, y: 14 }], ["level", { x: 105, y: -60 }], ["high", { x: 70, y: -190 }]] as const) {
    for (const p of [0.12, 0.3, 0.35, 0.44, 0.52, 0.66, 0.84]) at(`swat@${name}${p}`, { clip: "swat", progress: p, clipTime: p * 1.4, reach, look: reach }, 0.5 + p * 1.4);
  }
  for (const t of [0.9, 1.8, 2.7, 3.3]) at(`doze@${t}`, { clip: "doze", drowsy: 0.62 }, t);
  for (const p of [0.15, 0.35, 0.6, 0.85]) at(`shift@${p}`, { clip: "shift", progress: p, drowsy: 1 });
  // (and the feelings that last: the head cocked, and the look away and up; the flinch, the lift and the letdown are over in a moment and are not measured)
  for (const clip of ["sit", "stand"] as const) for (const emote of ["tilt", "think"] as const) at(`${clip}@${emote}`, { clip, emote }, 1.0);
  for (let i = 0; i < 8; i++) cells.push({ label: `walk@${i}`, frame: { clip: "walk", vx: 150 }, cycle: i / 8, settle: 1 });
  for (let i = 0; i < 12; i++) cells.push({ label: `run@${i}`, frame: { clip: "run", vx: 380 }, cycle: i / 12, settle: 1 });
  return cells;
})();

/** A recording of what the engine made a cat do (scripts/cat/record.mts), and which part of it to look at. */
export interface FilmFrame extends CatFrame {
  act?: string;
}
export interface Film {
  fps: number;
  bodyLength: number;
  frames: FilmFrame[];
}
export interface FilmOptions {
  mode: "strip" | "onion";
  cols: number;
  scale: number;
  /** Seconds into the recording. */
  from: number;
  to: number;
  /** For a strip: a picture every this many frames. For the onion skin: the same. */
  every: number;
  seed?: number;
  cellW?: number;
  cellH?: number;
  coat?: CatCoat;
  /** For a strip: a closer look (the cat this many times the size, about the place `at` of it: body lengths forward and up from the feet). */
  zoom?: number;
  at?: [number, number];
  /** The turn and tilt of the camera, as in a view (see `View`). */
  view?: View;
  /** The clips by themselves: nothing follows them (the tail, the back and the breath are as the clip has them). */
  plain?: boolean;
  /** A strip whose camera goes with the cat (it is in the same place of every cell): for a cat that is carried about. */
  follow?: boolean;
}

/**
 * Pictures of a recording, drawn by one rig that is stepped through every frame of it (so what the springs do shows, not only the poses): either a strip
 * of cells (the cat where it is, the shelf's line fixed, so that a leap shows as height) or one sheet with the cat drawn along its whole path, faintly.
 */
export function glFilm(canvas: HTMLCanvasElement, mesh: string, clips: string, film: Film, o: FilmOptions): void {
  const lab = 150 * o.scale;
  const k = lab / film.bodyLength;
  const dt = 1 / film.fps;
  const scaled = (f: FilmFrame): CatFrame => {
    const g: CatFrame = { ...f, x: f.x * k, y: f.y * k, vx: f.vx * k, vy: f.vy * k, odometer: f.odometer * k };
    if (f.look) g.look = { x: f.look.x * k, y: f.look.y * k };
    if (f.reach) g.reach = { x: f.reach.x * k, y: f.reach.y * k };
    return g;
  };
  const i0 = Math.max(0, Math.round(o.from * film.fps));
  const i1 = Math.min(film.frames.length - 1, Math.round(o.to * film.fps));
  const warm = Math.max(0, i0 - film.fps);
  const rig = new CatRig(o.seed ?? 7);
  rig.snapTo(scaled(film.frames[warm]!), lab);
  const glCanvas = document.createElement("canvas");
  const cat = GlCat.create(glCanvas, fromBase64(mesh), fromBase64(clips), { preserve: true });
  if (!cat) throw new Error("no WebGL");
  cat.setCoat(o.coat ?? "ragdoll");
  if (o.plain) cat.director.follows = false;
  const picks: number[] = [];
  for (let i = i0; i <= i1; i += o.every) picks.push(i);
  const ctx = canvas.getContext("2d")!;
  const ref = film.frames[i0]!;
  if (o.mode === "strip") {
    const cw = (o.cellW ?? 260) * o.scale;
    const ch = (o.cellH ?? 220) * o.scale;
    const rows = Math.ceil(picks.length / o.cols);
    canvas.width = cw * o.cols;
    canvas.height = ch * rows;
    cat.resize(cw, ch, 1);
    const zoom = o.zoom ?? 1;
    const at = o.at ?? [0, 0];
    // (zoomed in on a place, that place is the middle of the cell; otherwise the feet are on a line near the bottom of it)
    const line = o.zoom ? ch / 2 + at[1] * lab * zoom : ch - 24 * o.scale;
    for (let i = warm + 1; i <= i1; i++) {
      const f = film.frames[i]!;
      rig.update(scaled(f), dt, lab);
      const n = picks.indexOf(i);
      if (n < 0) continue;
      const x0 = (n % o.cols) * cw;
      const y0 = Math.floor(n / o.cols) * ch;
      ctx.fillStyle = BG;
      ctx.fillRect(x0, y0, cw, ch);
      ctx.fillStyle = GROUND;
      ctx.fillRect(x0, y0 + line, cw, 3 * o.scale);
      const oy = o.follow ? line : o.zoom ? line + (f.y - ref.y) * k * zoom : Math.min(ch - 4 * o.scale, line + (f.y - ref.y) * k);
      cat.draw(rig.solved, { ox: cw / 2 - at[0] * lab * zoom, oy, px: lab * zoom }, o.view);
      ctx.drawImage(glCanvas, x0, y0);
      ctx.fillStyle = "#9aa";
      ctx.font = `${12 * o.scale}px sans-serif`;
      ctx.fillText(`${(i / film.fps).toFixed(2)}s  ${f.act ?? ""}  ${f.clip}${f.grounded ? "" : " (air)"}`, x0 + 8 * o.scale, y0 + 16 * o.scale);
    }
  } else {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = i0; i <= i1; i++) {
      const f = film.frames[i]!;
      minX = Math.min(minX, f.x * k);
      maxX = Math.max(maxX, f.x * k);
      minY = Math.min(minY, f.y * k);
      maxY = Math.max(maxY, f.y * k);
    }
    const w = Math.min(2600, Math.ceil(maxX - minX + 3.4 * lab));
    const h = Math.min(1800, Math.ceil(maxY - minY + 2.1 * lab));
    canvas.width = w;
    canvas.height = h;
    cat.resize(w, h, 1);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);
    const ox = (x: number) => x * k - minX + 1.7 * lab;
    const oy = (y: number) => y * k - minY + 1.2 * lab;
    ctx.fillStyle = GROUND;
    ctx.fillRect(ox(ref.x) - 1.5 * lab, oy(ref.y), 3 * lab, 3 * o.scale);
    const last = film.frames[i1]!;
    ctx.fillRect(ox(last.x) - 1.5 * lab, oy(last.y), 3 * lab, 3 * o.scale);
    for (let i = warm + 1; i <= i1; i++) {
      const f = film.frames[i]!;
      rig.update(scaled(f), dt, lab);
      if (!picks.includes(i)) continue;
      cat.draw(rig.solved, { ox: ox(f.x), oy: oy(f.y), px: lab });
      ctx.globalAlpha = 0.45;
      ctx.drawImage(glCanvas, 0, 0);
      ctx.globalAlpha = 1;
    }
  }
  cat.dispose();
}

/** The same cat from seven sides, to judge the shape. */
export const VIEWS: GlCell[] = [
  { label: "side", frame: { clip: "stand" }, view: { tilt: 0 } },
  { label: "3/4 front", frame: { clip: "stand" }, view: { turn: -0.7, tilt: 0.1 } },
  { label: "front", frame: { clip: "stand" }, view: { turn: -1.5708, tilt: 0.1 } },
  { label: "3/4 back", frame: { clip: "stand" }, view: { turn: 0.7, tilt: 0.1 } },
  { label: "side normals", frame: { clip: "stand" }, view: { tilt: 0, debug: 1 } },
  { label: "side bones", frame: { clip: "stand" }, view: { tilt: 0, debug: 3 } },
  { label: "side ao", frame: { clip: "stand" }, view: { tilt: 0, debug: 2 } },
  { label: "top", frame: { clip: "stand" }, view: { tilt: 1.3 } },
];

/** The neck as the head is turned against the body, from straight ahead to over the shoulder: a row from the side, a row from three quarters in front, a row of the bones. */
export const NECK: GlCell[] = [
  { tilt: 0, turn: 0 },
  { tilt: 0.1, turn: -0.6 },
  { tilt: 0, turn: 0, debug: 3 },
].flatMap((view) => [0, 0.5, 1, 1.5].map((yaw): GlCell => ({ label: `head turned ${yaw}`, frame: { clip: "stand" }, view, headYaw: yaw, zoom: { head: [0, -0.02], by: 2.6 } })));

export const FACES: GlCell[] = [
  { label: "face, stand", frame: { clip: "stand" }, view: { tilt: 0 }, zoom: { head: [0.05, 0], by: 4.2 } },
  { label: "face, viewer", frame: { clip: "sit", viewer: true }, view: { tilt: 0.05 }, zoom: { head: [0.05, 0], by: 4.2 } },
  { label: "face, sleepy", frame: { clip: "sit", drowsy: 1 }, view: { tilt: 0.05 }, zoom: { head: [0.05, 0], by: 4.2 } },
  { label: "face, petted", frame: { clip: "sit", petted: true, viewer: true }, view: { tilt: 0.05 }, zoom: { head: [0.05, 0], by: 4.2 } },
];

/** The head in the postures where it is low or turned, and the paw raised in grooming. */
export const FACES3: GlCell[] = [
  { label: "face, asleep (curl)", frame: { clip: "curl", drowsy: 1 }, view: { tilt: 0.1 }, zoom: { head: [0.05, 0], by: 3.4 } },
  { label: "face, loaf", frame: { clip: "loaf" }, view: { tilt: 0.1 }, zoom: { head: [0.05, 0], by: 3.4 } },
  { label: "groom: the paw (mouth)", frame: { clip: "groom", clipTime: 3.12 }, view: { tilt: 0.1 }, zoom: { head: [0.05, 0], by: 3.4 }, settle: 0.1 },
  { label: "groom: the paw (ear)", frame: { clip: "groom", clipTime: 3.12 + 0.3125 }, view: { tilt: 0.1 }, zoom: { head: [0.05, 0], by: 3.4 }, settle: 0.1 },
  { label: "groom (stand-in 3/4)", frame: { clip: "groom", clipTime: 3.12 + 0.3125 }, view: { turn: -0.6, tilt: 0.1 }, zoom: { head: [0.05, 0], by: 3.4 }, settle: 0.1 },
  { label: "yawn", frame: { clip: "yawn", progress: 0.45 }, view: { tilt: 0.05 }, zoom: { head: [0.05, 0], by: 3.4 } },
];

/** The coat close up: the white of the chest and the socks, the stripes of a flank, the tail, the haunch. */
export const DETAIL: GlCell[] = [
  { label: "bib", frame: { clip: "stand" }, view: { tilt: 0 }, zoom: { at: [0.36, 0.34], by: 5.5 } },
  { label: "front socks", frame: { clip: "stand" }, view: { tilt: 0 }, zoom: { at: [0.28, 0.08], by: 5.5 } },
  { label: "flank", frame: { clip: "stand" }, view: { tilt: 0 }, zoom: { at: [-0.05, 0.42], by: 4.5 } },
  { label: "tail", frame: { clip: "stand" }, view: { tilt: 0 }, zoom: { at: [-0.5, 0.7], by: 4.5 } },
  { label: "haunch (sit)", frame: { clip: "sit" }, view: { tilt: 0.05 }, zoom: { at: [-0.18, 0.2], by: 4.5 } },
  { label: "back paws (sit)", frame: { clip: "sit" }, view: { tilt: 0.05 }, zoom: { at: [0.1, 0.06], by: 5.5 } },
  { label: "back, from above", frame: { clip: "stand" }, view: { tilt: 1.3 }, zoom: { at: [-0.05, 0.1], by: 3.2 } },
  { label: "silhouette edge", frame: { clip: "stand" }, view: { tilt: 0 }, zoom: { at: [-0.4, 0.55], by: 7 } },
];

/** The little scenes (scratching, kneading, sniffing, the stalk and the wiggle), close, at a few moments of each. */
const scene = (label: string, frame: Partial<CatFrame>, settle: number, turn = 0): GlCell => ({ label, frame, settle, view: { tilt: 0.05, turn }, zoom: { at: [0.15, 0.42], by: 2 } });
export const SCENES: GlCell[] = [
  scene("scratch 1.0 s", { clip: "scratch" }, 1.0),
  scene("scratch 1.06 s", { clip: "scratch" }, 1.06),
  scene("scratch (3/4)", { clip: "scratch" }, 1.0, -0.55),
  scene("knead 1.0 s", { clip: "knead" }, 1.0),
  scene("knead 1.3 s", { clip: "knead" }, 1.3),
  scene("knead (3/4)", { clip: "knead" }, 1.0, -0.55),
  scene("sniff", { clip: "sniff" }, 1.0),
  scene("sniff (3/4)", { clip: "sniff" }, 1.0, -0.55),
  scene("wiggle 1.0 s", { clip: "wiggle" }, 1.0),
  scene("wiggle 1.1 s", { clip: "wiggle" }, 1.1),
  scene("stalk", { clip: "stalk", odometer: 20 }, 1.0),
  scene("stalk (3/4)", { clip: "stalk", odometer: 20 }, 1.0, -0.55),
];

/** The beats of a swat at a poster's lip (just below the feet and a little ahead), close, the cat settled into each: the cocked paw, the stroke, the landing, the recoil. */
const swatAt = (p: number, turn = 0): GlCell => ({
  label: `swat ${p}${turn ? " (3/4)" : ""}`,
  frame: { clip: "swat", progress: p, clipTime: p * 1.4, reach: { x: 92, y: 14 }, look: { x: 92, y: 14 } },
  settle: 1.0,
  view: { tilt: 0.05, turn },
  zoom: { at: [0.3, 0.36], by: 2 },
});
export const SWAT: GlCell[] = [0, 0.12, 0.3, 0.35, 0.4, 0.44, 0.52, 0.66, 0.84].map((p) => swatAt(p)).concat([0.3, 0.44, 0.66].map((p) => swatAt(p, -0.55)));

const cycleOf = (clip: "walk" | "run", n: number): GlCell[] =>
  Array.from({ length: n }, (_, i) => ({ label: `${clip} ${i}/${n}`, frame: { clip, vx: clip === "run" ? 380 : 150 }, cycle: i / n, view: { tilt: 0 }, settle: 1 }));
export const WALK: GlCell[] = cycleOf("walk", 8);
export const RUN: GlCell[] = cycleOf("run", 12);

/**
 * `n` pictures of one clip of the file, evenly through it (a clip is named for the posture of the engine it serves, and is played the way the director plays that posture: by the ground
 * covered, by the clock, or by how far through a one-shot it is). For looking at a clip as the cat will show it, one side on.
 */
export function clipCells(mesh: string, clips: string, name: string, n: number, view: View = { tilt: 0 }, blind = false): GlCell[] {
  const skeleton = new Skeleton(decodeMesh(fromBase64(mesh)).skeleton);
  const clip = decodeClips(fromBase64(clips), skeleton).find((c) => c.name === name);
  if (!clip) throw new Error(`no clip ${name}`);
  const plan = PLANS[name as keyof typeof PLANS]?.find((p) => p.clip === name);
  if (!plan) throw new Error(`no posture plays the clip ${name}`);
  const seconds = lengthOf(clip);
  return Array.from({ length: n }, (_, i) => {
    // (a blind sheet says only which picture it is: a reviewer who is not to know what the clip is must not be told by the label)
    const label = blind ? String(i + 1) : `${name} ${i}/${n}`;
    if (plan.drive === "odometer") return { label, frame: { clip: name as CatFrame["clip"], vx: 150 }, cycle: i / n, view, settle: 1 };
    if (plan.drive === "progress") return { label, frame: { clip: name as CatFrame["clip"], progress: n > 1 ? i / (n - 1) : 0 }, view, settle: 1 };
    return { label, frame: { clip: name as CatFrame["clip"] }, view, settle: (clip.loop ? i / n : n > 1 ? i / (n - 1) : 0) * seconds };
  });
}

export const EYES: GlCell[] = [
  { label: "eyes, viewer", frame: { clip: "sit", viewer: true }, view: { tilt: 0.05 }, zoom: { head: [0.05, 0.005], by: 9 } },
  { label: "eyes, 3/4", frame: { clip: "sit", viewer: true }, view: { tilt: 0.05, turn: -0.5 }, zoom: { head: [0.05, 0.005], by: 9 } },
  { label: "eyes, stand", frame: { clip: "stand" }, view: { tilt: 0 }, zoom: { head: [0.05, 0.005], by: 9 } },
  { label: "eyes, wide", frame: { clip: "sit", viewer: true, energy: 1 }, view: { tilt: 0.05 }, zoom: { head: [0.05, 0.005], by: 9 } },
  { label: "eyes, as in the picture", frame: { clip: "sit", viewer: true }, view: { tilt: 0.05 }, zoom: { head: [0.05, 0.005], by: 6 } },
];

export const FACES2: GlCell[] = [
  { label: "mesh colour", frame: { clip: "sit", viewer: true }, view: { tilt: 0.05, debug: 4 }, zoom: { head: [0.05, 0], by: 4.2 } },
  { label: "normals", frame: { clip: "sit", viewer: true }, view: { tilt: 0.05, debug: 1 }, zoom: { head: [0.05, 0], by: 4.2 } },
  { label: "ao", frame: { clip: "sit", viewer: true }, view: { tilt: 0.05, debug: 2 }, zoom: { head: [0.05, 0], by: 4.2 } },
  { label: "bones", frame: { clip: "sit", viewer: true }, view: { tilt: 0.05, debug: 3 }, zoom: { head: [0.05, 0], by: 4.2 } },
];

export const GL_POSES: GlCell[] = POSES.map((p) => ({ label: p.label, frame: p.frame }));

/** Hanging by the scruff: from the side and from three quarters, the hand where the engine puts it (a cross), and the head close. */
const hung = (label: string, over: Partial<CatFrame> = {}, extra: Partial<GlCell> = {}): GlCell => ({
  label,
  frame: { clip: "stand", carried: true, grounded: false, viewer: true, ...over },
  raise: 0.85,
  hand: [(over.facing === -1 ? 1 : -1) * HANG_AHEAD, HANG_DOWN],
  view: { tilt: 0.05 },
  ...extra,
});
export const CARRIED: GlCell[] = [
  hung("carried, still", {}),
  hung("carried, facing left", { facing: -1 }),
  hung("carried, 3/4", {}, { view: { turn: -0.6, tilt: 0.05 } }),
  hung("carried, looking at the hand", { viewer: false, look: { x: 0, y: -400 } }),
  hung("head", {}, { zoom: { at: [-0.1, 0.95], by: 3.2 }, hand: undefined as never }),
  hung("head, 3/4", {}, { zoom: { at: [-0.1, 0.95], by: 3.2 }, view: { turn: -0.6, tilt: 0.05 }, hand: undefined as never }),
  hung("hind legs and tail", {}, { zoom: { at: [-0.1, 0.0], by: 2.6 }, hand: undefined as never }),
  hung("forelegs and chest", {}, { zoom: { at: [0.0, 0.55], by: 2.6 }, hand: undefined as never }),
];


