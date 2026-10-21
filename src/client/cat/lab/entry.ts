import { drawCat, MARMALADE } from "../render/draw";
import { CatRig, GALLOP_STRIDE, WALK_STRIDE } from "../render/rig";
import { JUMP_LANDING, JUMP_TAKEOFF, type CatFrame } from "../types";

/**
 * The cat lab: pictures of the cat for looking at it (pose sheets, strips of a walk or a jump), made in a real browser by scripts/cat/sheet.mjs.
 * Development tooling only: nothing in the app imports this file, so none of it is in the build that is served.
 */

export const frameOf = (over: Partial<CatFrame> = {}): CatFrame => ({
  x: 0,
  y: 0,
  facing: 1,
  clip: "stand",
  clipTime: 0,
  progress: 0,
  odometer: 0,
  vx: 0,
  vy: 0,
  grounded: true,
  viewer: false,
  drowsy: 0,
  energy: 0.3,
  appear: 1,
  petted: false,
  ...over,
});

interface Cell {
  label: string;
  frame: Partial<CatFrame>;
  /** Seconds to let the body settle into the pose before the picture. */
  settle?: number;
  /** Seconds of a moving clip to run before the picture (for a walk, the distance is in `frame.odometer` at the end). */
  run?: number;
}

const BG = "#15151b";
const GROUND = "#2a2a35";

function cellBox(w: number, h: number, scale: number) {
  return { ox: w / 2, oy: h - 24 * scale, px: 150 * scale };
}

function paintCell(ctx: CanvasRenderingContext2D, cell: Cell, x0: number, y0: number, w: number, h: number, scale: number, seed: number): void {
  const px = 150 * scale;
  const rig = new CatRig(seed);
  const base = frameOf(cell.frame);
  rig.snapTo(base, px);
  const steps = Math.round((cell.settle ?? 1.2) * 60);
  for (let i = 0; i < steps; i++) rig.update({ ...base, clipTime: i / 60 }, 1 / 60, px);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, w, h);
  ctx.clip();
  ctx.fillStyle = BG;
  ctx.fillRect(x0, y0, w, h);
  const box = cellBox(w, h, scale);
  ctx.fillStyle = GROUND;
  ctx.fillRect(x0, y0 + box.oy, w, 3 * scale);
  ctx.translate(x0, y0);
  drawCat(ctx, MARMALADE, rig.solved, box);
  ctx.restore();
  ctx.save();
  ctx.fillStyle = "#9aa";
  ctx.font = `${13 * scale}px sans-serif`;
  ctx.fillText(cell.label, x0 + 8 * scale, y0 + 18 * scale);
  ctx.restore();
}

/** A sheet of cells in a grid. */
export function sheet(canvas: HTMLCanvasElement, cells: readonly Cell[], columns: number, scale = 1, seed = 7): void {
  const cw = 260 * scale;
  const ch = 220 * scale;
  const rows = Math.ceil(cells.length / columns);
  canvas.width = cw * columns;
  canvas.height = ch * rows;
  const ctx = canvas.getContext("2d")!;
  cells.forEach((cell, i) => paintCell(ctx, cell, (i % columns) * cw, Math.floor(i / columns) * ch, cw, ch, scale, seed + i));
}

export const POSES: Cell[] = [
  { label: "stand", frame: { clip: "stand" } },
  { label: "sit", frame: { clip: "sit" } },
  { label: "loaf", frame: { clip: "loaf" } },
  { label: "curl (asleep)", frame: { clip: "curl", drowsy: 1 } },
  { label: "crouch", frame: { clip: "crouch" } },
  { label: "stretch", frame: { clip: "stretch", progress: 0.5 } },
  { label: "jump: air", frame: { clip: "jump", progress: 0.5, grounded: false, vy: -300, vx: 300, y: -60 } },
  { label: "jump: coming down", frame: { clip: "jump", progress: 0.7, grounded: false, vy: 600, vx: 300, y: -30 } },
  { label: "sit, groom", frame: { clip: "groom", clipTime: 0.2 } },
  { label: "sit, petted", frame: { clip: "sit", petted: true } },
  { label: "sit, yawn", frame: { clip: "yawn", progress: 0.5 } },
  { label: "sit, look viewer", frame: { clip: "sit", viewer: true } },
  { label: "stand, look up-right", frame: { clip: "stand", look: { x: 300, y: -200 } } },
  { label: "sit, scratch", frame: { clip: "scratch", progress: 0.5 } },
  { label: "loaf, knead", frame: { clip: "knead", progress: 0.5 } },
  { label: "stand, sniff", frame: { clip: "sniff", progress: 0.5 } },
  { label: "stalk", frame: { clip: "stalk", odometer: 20 } },
  { label: "crouch, wiggle", frame: { clip: "wiggle", progress: 0.5 } },
  { label: "stalk, facing left", frame: { clip: "stalk", odometer: 20, facing: -1 } },
  { label: "sit, facing left", frame: { clip: "sit", facing: -1 } },
];

/** A strip of one walk cycle, evenly spaced. */
export function walkStrip(canvas: HTMLCanvasElement, frames = 8, run = false, scale = 1): void {
  const cells: Cell[] = [];
  const px = 150 * scale;
  const stride = (run ? GALLOP_STRIDE : WALK_STRIDE) * px;
  for (let i = 0; i < frames; i++) {
    cells.push({ label: `${run ? "run" : "walk"} ${i + 1}/${frames}`, frame: { clip: run ? "run" : "walk", odometer: (stride * i) / frames + stride * 3, vx: run ? 300 : 100 }, settle: 0.8, run: 1 });
  }
  sheetWalking(canvas, cells, frames, run, scale);
}

/** Cells for a walk: the rig is run for a while so the gait has settled, then painted at each phase. */
function sheetWalking(canvas: HTMLCanvasElement, cells: Cell[], columns: number, run: boolean, scale: number): void {
  const cw = 260 * scale;
  const ch = 220 * scale;
  canvas.width = cw * columns;
  canvas.height = ch;
  const ctx = canvas.getContext("2d")!;
  const px = 150 * scale;
  const rig = new CatRig(3);
  const speed = (run ? 2.6 : 1.0) * px;
  let odo = 0;
  // run up to the first phase, then paint evenly through one cycle
  const stride = (run ? GALLOP_STRIDE : WALK_STRIDE) * px;
  const dt = 1 / 60;
  const warm = Math.round(1.4 / dt);
  for (let i = 0; i < warm; i++) {
    odo += speed * dt;
    rig.update(frameOf({ clip: run ? "run" : "walk", odometer: odo, vx: speed }), dt, px);
  }
  const perCell = (stride / columns) / (speed * dt);
  for (let c = 0; c < columns; c++) {
    const steps = Math.max(1, Math.round(perCell));
    for (let i = 0; i < steps; i++) {
      odo += speed * dt;
      rig.update(frameOf({ clip: run ? "run" : "walk", odometer: odo, vx: speed }), dt, px);
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(c * cw, 0, cw, ch);
    ctx.clip();
    ctx.fillStyle = BG;
    ctx.fillRect(c * cw, 0, cw, ch);
    const box = cellBox(cw, ch, scale);
    ctx.fillStyle = GROUND;
    ctx.fillRect(c * cw, box.oy, cw, 3 * scale);
    ctx.translate(c * cw, 0);
    drawCat(ctx, MARMALADE, rig.solved, box);
    ctx.restore();
    ctx.fillStyle = "#9aa";
    ctx.font = `${13 * scale}px sans-serif`;
    ctx.fillText(`${run ? "run" : "walk"} ${c + 1}/${columns}`, c * cw + 8 * scale, 18 * scale);
  }
  void cells;
}

/** One jump, as a strip: the crouch, the push, the flight, the landing. */
export function jumpStrip(canvas: HTMLCanvasElement, frames = 10, scale = 1): void {
  const cw = 300 * scale;
  const ch = 280 * scale;
  canvas.width = cw * frames;
  canvas.height = ch;
  const ctx = canvas.getContext("2d")!;
  const px = 150 * scale;
  const rig = new CatRig(5);
  const dt = 1 / 60;
  const total = 1.0;
  const dist = 1.6 * px;
  const rise = 0.9 * px;
  const flightFrom = JUMP_TAKEOFF;
  const flightTo = JUMP_LANDING;
  let k = 0;
  const steps = Math.round(total / dt);
  const shotAt = new Set<number>();
  for (let c = 0; c < frames; c++) shotAt.add(Math.round((c / (frames - 1)) * (steps - 1)));
  for (let i = 0; i < steps; i++) {
    const progress = i / (steps - 1);
    const fl = Math.min(1, Math.max(0, (progress - flightFrom) / (flightTo - flightFrom)));
    const x = -dist / 2 + dist * fl;
    const y = -(4 * rise * fl * (1 - fl));
    const vy = progress > flightFrom && progress < flightTo ? (-4 * rise * (1 - 2 * fl)) / ((flightTo - flightFrom) * total) : 0;
    const vx = progress > flightFrom && progress < flightTo ? dist / ((flightTo - flightFrom) * total) : 0;
    const frame = frameOf({ clip: "jump", progress, x, y, vx, vy, grounded: !(progress > flightFrom && progress < flightTo), clipTime: i * dt });
    rig.update(frame, dt, px);
    if (shotAt.has(i)) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(k * cw, 0, cw, ch);
      ctx.clip();
      ctx.fillStyle = BG;
      ctx.fillRect(k * cw, 0, cw, ch);
      const oy = ch - 30 * scale;
      ctx.fillStyle = GROUND;
      ctx.fillRect(k * cw, oy, cw, 3 * scale);
      ctx.translate(k * cw, 0);
      drawCat(ctx, MARMALADE, rig.solved, { ox: cw / 2 + x * 0.55, oy: oy + y, px });
      ctx.restore();
      ctx.fillStyle = "#9aa";
      ctx.font = `${13 * scale}px sans-serif`;
      ctx.fillText(`jump ${progress.toFixed(2)}`, k * cw + 8 * scale, 18 * scale);
      k++;
    }
  }
}
