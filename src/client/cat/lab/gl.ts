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
}

const BG = "#15151b";
const GROUND = "#2a2a35";

const fromBase64 = (text: string): ArrayBuffer => {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
};

export function glSheet(canvas: HTMLCanvasElement, mesh: string, cells: readonly GlCell[], columns: number, scale = 1, seed = 7, cellW = 260, cellH = 220): void {
  const cw = cellW * scale;
  const ch = cellH * scale;
  const rows = Math.ceil(cells.length / columns);
  canvas.width = cw * columns;
  canvas.height = ch * rows;
  const ctx = canvas.getContext("2d")!;
  const glCanvas = document.createElement("canvas");
  const cat = GlCat.create(glCanvas, fromBase64(mesh), { preserve: true });
  if (!cat) throw new Error("no WebGL");
  cat.resize(cw, ch, 1);
  const px = 150 * scale;
  cells.forEach((cell, i) => {
    const x0 = (i % columns) * cw;
    const y0 = Math.floor(i / columns) * ch;
    const rig = new CatRig(seed + i);
    const base = frameOf(cell.frame);
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
  { label: "groom: the paw", frame: { clip: "groom", clipTime: 0.2 }, view: { tilt: 0.1 }, zoom: { at: [0.28, 0.82], by: 3.4 } },
  { label: "yawn", frame: { clip: "yawn", progress: 0.45 }, view: { tilt: 0.05 }, zoom: { at: [0.3, 0.96], by: 3.4 } },
];

export const FACES2: GlCell[] = [
  { label: "no fur", frame: { clip: "sit", viewer: true }, view: { tilt: 0.05, shells: 0 }, zoom: { at: [0.3, 0.96], by: 4.2 } },
  { label: "normals", frame: { clip: "sit", viewer: true }, view: { tilt: 0.05, debug: 1 }, zoom: { at: [0.3, 0.96], by: 4.2 } },
  { label: "ao", frame: { clip: "sit", viewer: true }, view: { tilt: 0.05, debug: 2 }, zoom: { at: [0.3, 0.96], by: 4.2 } },
  { label: "bones", frame: { clip: "sit", viewer: true }, view: { tilt: 0.05, debug: 3 }, zoom: { at: [0.3, 0.96], by: 4.2 } },
];

export const GL_POSES: GlCell[] = POSES.map((p) => ({ label: p.label, frame: p.frame }));


