import type { CatCoat } from "../settings";
import { GlCat, type View } from "../render/gl/renderer";
import { CatRig } from "../render/rig";
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
  /** Looks closely at a place on the cat (its rest, in body lengths: x forward, y up) at this many times the size. */
  zoom?: { at: [number, number]; by: number };
  /** For the walk and the run: how far through a stride it is (0..1), which fixes where the feet are. */
  cycle?: number;
}

const STRIDE = { walk: 0.6, run: 0.92 };

const BG = "#15151b";
const GROUND = "#2a2a35";

const fromBase64 = (text: string): ArrayBuffer => {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
};

export function glSheet(canvas: HTMLCanvasElement, mesh: string, cells: readonly GlCell[], columns: number, scale = 1, seed = 7, cellW = 260, cellH = 220, coat: CatCoat = "ginger"): void {
  const cw = cellW * scale;
  const ch = cellH * scale;
  const rows = Math.ceil(cells.length / columns);
  canvas.width = cw * columns;
  canvas.height = ch * rows;
  const ctx = canvas.getContext("2d")!;
  const glCanvas = document.createElement("canvas");
  const cat = GlCat.create(glCanvas, fromBase64(mesh), { preserve: true });
  if (!cat) throw new Error("no WebGL");
  cat.setCoat(coat);
  cat.resize(cw, ch, 1);
  const px = 150 * scale;
  cells.forEach((cell, i) => {
    const x0 = (i % columns) * cw;
    const y0 = Math.floor(i / columns) * ch;
    const rig = new CatRig(seed + i);
    const base = frameOf(cell.frame);
    if (cell.cycle !== undefined) base.odometer = cell.cycle * STRIDE[base.clip === "run" ? "run" : "walk"] * px;
    rig.snapTo(base, px);
    const steps = Math.round((cell.settle ?? 1.2) * 60);
    for (let k = 0; k < steps; k++) rig.update({ ...base, clipTime: k / 60 }, 1 / 60, px);
    ctx.fillStyle = BG;
    ctx.fillRect(x0, y0, cw, ch);
    const oy = ch - 24 * scale;
    ctx.fillStyle = GROUND;
    ctx.fillRect(x0, y0 + oy, cw, 3 * scale);
    const z = cell.zoom;
    const box = z ? { px: px * z.by, ox: cw / 2 - z.at[0] * px * z.by, oy: ch / 2 + z.at[1] * px * z.by } : { ox: cw / 2, oy, px };
    cat.draw(rig.solved, box, cell.view);
    ctx.drawImage(glCanvas, x0, y0);
    ctx.fillStyle = "#9aa";
    ctx.font = `${13 * scale}px sans-serif`;
    ctx.fillText(cell.label, x0 + 8 * scale, y0 + 18 * scale);
  });
  cat.dispose();
}

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
}

/**
 * Pictures of a recording, drawn by one rig that is stepped through every frame of it (so what the springs do shows, not only the poses): either a strip
 * of cells (the cat where it is, the shelf's line fixed, so that a leap shows as height) or one sheet with the cat drawn along its whole path, faintly.
 */
export function glFilm(canvas: HTMLCanvasElement, mesh: string, film: Film, o: FilmOptions): void {
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
  const cat = GlCat.create(glCanvas, fromBase64(mesh), { preserve: true });
  if (!cat) throw new Error("no WebGL");
  cat.setCoat(o.coat ?? "ginger");
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
    const line = ch - 24 * o.scale;
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
      const oy = Math.min(ch - 4 * o.scale, line + (f.y - ref.y) * k);
      cat.draw(rig.solved, { ox: cw / 2, oy, px: lab });
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

export const FACES: GlCell[] = [
  { label: "face, stand", frame: { clip: "stand" }, view: { tilt: 0 }, zoom: { at: [0.5, 0.76], by: 4.2 } },
  { label: "face, viewer", frame: { clip: "sit", viewer: true }, view: { tilt: 0.05 }, zoom: { at: [0.3, 0.96], by: 4.2 } },
  { label: "face, sleepy", frame: { clip: "sit", drowsy: 1 }, view: { tilt: 0.05 }, zoom: { at: [0.3, 0.96], by: 4.2 } },
  { label: "face, petted", frame: { clip: "sit", petted: true, viewer: true }, view: { tilt: 0.05 }, zoom: { at: [0.3, 0.96], by: 4.2 } },
];

/** The head in the postures where it is low or turned, and the paw raised in grooming. */
export const FACES3: GlCell[] = [
  { label: "face, asleep (curl)", frame: { clip: "curl", drowsy: 1 }, view: { tilt: 0.1 }, zoom: { at: [0.36, 0.22], by: 3.4 } },
  { label: "face, loaf", frame: { clip: "loaf" }, view: { tilt: 0.1 }, zoom: { at: [0.44, 0.6], by: 3.4 } },
  { label: "groom: the paw (mouth)", frame: { clip: "groom", clipTime: 3.12 }, view: { tilt: 0.1 }, zoom: { at: [0.3, 0.8], by: 3.4 }, settle: 0.1 },
  { label: "groom: the paw (ear)", frame: { clip: "groom", clipTime: 3.12 + 0.3125 }, view: { tilt: 0.1 }, zoom: { at: [0.3, 0.8], by: 3.4 }, settle: 0.1 },
  { label: "groom (stand-in 3/4)", frame: { clip: "groom", clipTime: 3.12 + 0.3125 }, view: { turn: -0.6, tilt: 0.1 }, zoom: { at: [0.3, 0.8], by: 3.4 }, settle: 0.1 },
  { label: "yawn", frame: { clip: "yawn", progress: 0.45 }, view: { tilt: 0.05 }, zoom: { at: [0.3, 0.96], by: 3.4 } },
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

const cycleOf = (clip: "walk" | "run", n: number): GlCell[] =>
  Array.from({ length: n }, (_, i) => ({ label: `${clip} ${i}/${n}`, frame: { clip, vx: clip === "run" ? 380 : 150 }, cycle: i / n, view: { tilt: 0 }, settle: 1 }));
export const WALK: GlCell[] = cycleOf("walk", 8);
export const RUN: GlCell[] = cycleOf("run", 8);

export const FACES2: GlCell[] = [
  { label: "no fur", frame: { clip: "sit", viewer: true }, view: { tilt: 0.05, shells: 0 }, zoom: { at: [0.3, 0.96], by: 4.2 } },
  { label: "normals", frame: { clip: "sit", viewer: true }, view: { tilt: 0.05, debug: 1 }, zoom: { at: [0.3, 0.96], by: 4.2 } },
  { label: "ao", frame: { clip: "sit", viewer: true }, view: { tilt: 0.05, debug: 2 }, zoom: { at: [0.3, 0.96], by: 4.2 } },
  { label: "bones", frame: { clip: "sit", viewer: true }, view: { tilt: 0.05, debug: 3 }, zoom: { at: [0.3, 0.96], by: 4.2 } },
];

export const GL_POSES: GlCell[] = POSES.map((p) => ({ label: p.label, frame: p.frame }));


