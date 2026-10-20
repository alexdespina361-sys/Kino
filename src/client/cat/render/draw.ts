import { clamp, clamp01, lerp, TAU } from "../math";
import type { Joint, Leg, Solved } from "./rig";

/**
 * Paints a solved cat on a canvas: flat colour with an outline, a little shading, stripes, a white bib and socks. The painter knows nothing
 * about what the cat is doing; swap this file (with the palette) and the same behaviour wears another art pack.
 */

export interface Palette {
  id: string;
  fur: string;
  furLight: string;
  furDark: string;
  /** Far legs and the far ear: a step darker than the fur, so they sit behind. */
  furFar: string;
  white: string;
  outline: string;
  earInner: string;
  nose: string;
  eye: string;
  eyeRim: string;
  pupil: string;
  mouth: string;
  tongue: string;
  whisker: string;
}

/** The first cat: a ginger tabby with a white bib and socks. Drawn for Kino from nothing but the idea of a cat. */
export const MARMALADE: Palette = {
  id: "marmalade",
  fur: "#e8933c",
  furLight: "#f7c98a",
  furDark: "#bd6422",
  furFar: "#c9722c",
  white: "#fff6e8",
  outline: "#3a2113",
  earInner: "#f3a39a",
  nose: "#e8808a",
  eye: "#b9dd6a",
  eyeRim: "#6a8a2c",
  pupil: "#1c120b",
  mouth: "#4a2a1a",
  tongue: "#ee7f86",
  whisker: "rgba(255,247,235,0.9)",
};

type Ctx = CanvasRenderingContext2D;

const OUT = 0.014;

function capsule(ctx: Ctx, ax: number, ay: number, ar: number, bx: number, by: number, br: number): void {
  const dx = bx - ax;
  const dy = by - ay;
  const d = Math.hypot(dx, dy);
  if (d < 1e-5) {
    ctx.moveTo(ax + Math.max(ar, br), ay);
    ctx.arc(ax, ay, Math.max(ar, br), 0, TAU);
    return;
  }
  const angle = Math.atan2(dy, dx);
  const alpha = Math.acos(clamp((ar - br) / d, -1, 1));
  ctx.moveTo(ax + ar * Math.cos(angle + alpha), ay + ar * Math.sin(angle + alpha));
  ctx.arc(ax, ay, ar, angle + alpha, angle - alpha + TAU);
  ctx.arc(bx, by, br, angle - alpha, angle + alpha);
  ctx.closePath();
}

/** A smooth closed curve through the points (Catmull-Rom as Beziers). */
function blob(ctx: Ctx, pts: readonly Joint[]): void {
  const n = pts.length;
  const at = (i: number) => pts[((i % n) + n) % n]!;
  ctx.moveTo(at(0).x, at(0).y);
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    ctx.bezierCurveTo(p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6, p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6, p2.x, p2.y);
  }
  ctx.closePath();
}

function limb(ctx: Ctx, pal: Palette, leg: Leg, fill: string, sock: boolean, thigh: number): void {
  const segs: Array<[Joint, number, Joint, number]> = leg.front
    ? [
        [leg.root, 0.062, leg.mid, 0.05],
        [leg.mid, 0.05, leg.hock, 0.04],
      ]
    : [
        [leg.root, thigh, leg.mid, 0.052],
        [leg.mid, 0.052, leg.hock, 0.036],
        [leg.hock, 0.036, leg.toe, 0.042],
      ];
  // the paw: an oval lying along the way the foot points
  const pawX = leg.toe.x + 0.02;
  const pawY = leg.toe.y - 0.018;
  ctx.fillStyle = pal.outline;
  ctx.beginPath();
  for (const [a, ar, b, br] of segs) capsule(ctx, a.x, a.y, ar + OUT, b.x, b.y, br + OUT);
  ctx.ellipse(pawX, pawY, 0.07 + OUT, 0.043 + OUT, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = fill;
  ctx.beginPath();
  for (const [a, ar, b, br] of segs) capsule(ctx, a.x, a.y, ar, b.x, b.y, br);
  ctx.fill();
  ctx.fillStyle = sock ? pal.white : fill;
  ctx.beginPath();
  ctx.ellipse(pawX, pawY, 0.07, 0.043, 0, 0, TAU);
  ctx.fill();
  if (sock) {
    // the sock runs a little way up the leg
    const last = segs[segs.length - 1]!;
    const [a, , b] = last;
    ctx.beginPath();
    capsule(ctx, lerp(a.x, b.x, 0.45), lerp(a.y, b.y, 0.45), 0.044, b.x, b.y, 0.043);
    ctx.fill();
  }
}

function drawTail(ctx: Ctx, pal: Palette, tail: readonly Joint[]): void {
  const n = tail.length - 1;
  const width = (i: number) => lerp(0.052, 0.034, i / n);
  ctx.fillStyle = pal.outline;
  ctx.beginPath();
  for (let i = 0; i < n; i++) capsule(ctx, tail[i]!.x, tail[i]!.y, width(i) + OUT, tail[i + 1]!.x, tail[i + 1]!.y, width(i + 1) + OUT);
  ctx.fill();
  ctx.fillStyle = pal.fur;
  ctx.beginPath();
  for (let i = 0; i < n; i++) capsule(ctx, tail[i]!.x, tail[i]!.y, width(i), tail[i + 1]!.x, tail[i + 1]!.y, width(i + 1));
  ctx.fill();
  // rings, and a darker tip
  ctx.strokeStyle = pal.furDark;
  ctx.lineCap = "round";
  for (let i = 2; i < n; i += 2) {
    const a = tail[i]!;
    const b = tail[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 1;
    const nx = -dy / d;
    const ny = dx / d;
    const w = width(i) * 0.9;
    ctx.lineWidth = 0.022;
    ctx.beginPath();
    ctx.moveTo(a.x + nx * w, a.y + ny * w);
    ctx.lineTo(a.x - nx * w, a.y - ny * w);
    ctx.stroke();
  }
  const tip = tail[n]!;
  const before = tail[n - 1]!;
  ctx.fillStyle = pal.furDark;
  ctx.beginPath();
  capsule(ctx, before.x, before.y, width(n - 1) * 0.95, tip.x, tip.y, width(n) * 0.95);
  ctx.fill();
}

function drawEar(ctx: Ctx, pal: Palette, side: -1 | 1, angle: number, far: boolean, fx: (x: number, side: -1 | 1) => number): void {
  const bx = fx(side * 0.1, side);
  const by = -0.09;
  const rot = side * angle;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const pt = (x: number, y: number): [number, number] => {
    const dx = fx(side * x, side) - bx;
    const dy = y - by;
    return [bx + dx * cos - dy * sin, by + dx * sin + dy * cos];
  };
  const inner = pt(0.035, -0.115);
  const outer = pt(0.17, -0.06);
  const tip = pt(0.135 + side * 0.012 * 0, -0.285);
  const path = (scale: number, ox: number, oy: number) => {
    const cx = (inner[0] + outer[0] + tip[0]) / 3;
    const cy = (inner[1] + outer[1] + tip[1]) / 3;
    const q = (p: readonly number[]): [number, number] => [cx + (p[0]! - cx) * scale + ox, cy + (p[1]! - cy) * scale + oy];
    const a = q(inner);
    const b = q(tip);
    const c = q(outer);
    ctx.moveTo(a[0], a[1]);
    ctx.quadraticCurveTo(lerp(a[0], b[0], 0.5) - side * 0.012, lerp(a[1], b[1], 0.5), b[0], b[1]);
    ctx.quadraticCurveTo(lerp(b[0], c[0], 0.5) + side * 0.02, lerp(b[1], c[1], 0.5) + 0.01, c[0], c[1]);
    ctx.quadraticCurveTo(lerp(c[0], a[0], 0.5), lerp(c[1], a[1], 0.5) + 0.03, a[0], a[1]);
    ctx.closePath();
  };
  ctx.lineJoin = "round";
  ctx.fillStyle = pal.outline;
  ctx.strokeStyle = pal.outline;
  ctx.lineWidth = OUT * 2;
  ctx.beginPath();
  path(1, 0, 0);
  ctx.stroke();
  ctx.fill();
  ctx.fillStyle = far ? pal.furFar : pal.fur;
  ctx.beginPath();
  path(1, 0, 0);
  ctx.fill();
  ctx.fillStyle = pal.earInner;
  ctx.beginPath();
  path(0.52, 0, 0.012);
  ctx.fill();
}

function drawHead(ctx: Ctx, pal: Palette, s: Solved): void {
  const h = s.head;
  ctx.save();
  ctx.translate(h.x, h.y);
  ctx.rotate(h.rot);
  const yaw = h.yaw;
  const sideScale = (side: -1 | 1) => 1 - 0.34 * Math.max(0, side * yaw) + 0.1 * Math.max(0, -side * yaw);
  const fx = (x: number, side: -1 | 1) => x * sideScale(side) + yaw * 0.075;
  // the far ear (the one toward the way the head is not turned) is behind the head; the near one is drawn after it
  const farSide: -1 | 1 = yaw >= 0 ? -1 : 1;
  drawEar(ctx, pal, farSide, h.earL, true, fx);
  drawEar(ctx, pal, (farSide === -1 ? 1 : -1) as -1 | 1, h.earR, false, fx);

  // head: a wide rounded shape with cheek tufts
  const rx = 0.19 * (1 - 0.06 * Math.abs(yaw));
  const ry = 0.158;
  const cx = yaw * 0.03;
  ctx.fillStyle = pal.outline;
  ctx.beginPath();
  ctx.ellipse(cx, 0, rx + OUT, ry + OUT, 0, 0, TAU);
  ctx.ellipse(cx - rx * 0.62, 0.062, 0.082 + OUT, 0.062 + OUT, 0.3, 0, TAU);
  ctx.ellipse(cx + rx * 0.62, 0.062, 0.082 + OUT, 0.062 + OUT, -0.3, 0, TAU);
  ctx.fill();
  const grad = ctx.createLinearGradient(0, -ry, 0, ry);
  grad.addColorStop(0, pal.fur);
  grad.addColorStop(1, pal.furLight);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(cx, 0, rx, ry, 0, 0, TAU);
  ctx.ellipse(cx - rx * 0.62, 0.062, 0.082, 0.062, 0.3, 0, TAU);
  ctx.ellipse(cx + rx * 0.62, 0.062, 0.082, 0.062, -0.3, 0, TAU);
  ctx.fill();
  // forehead stripes
  ctx.strokeStyle = pal.furDark;
  ctx.lineCap = "round";
  ctx.lineWidth = 0.016;
  for (const dx of [-0.05, 0, 0.05]) {
    ctx.beginPath();
    ctx.moveTo(cx + dx * 1.1 + yaw * 0.03, -ry * 0.98);
    ctx.lineTo(cx + dx * 1.0 + yaw * 0.03, -ry * 0.55 - (dx === 0 ? 0.03 : 0));
    ctx.stroke();
  }
  // muzzle
  ctx.fillStyle = pal.white;
  ctx.beginPath();
  ctx.ellipse(fx(0, 1) + 0.0, 0.066, 0.075 * (1 - 0.1 * Math.abs(yaw)), 0.05, 0, 0, TAU);
  ctx.fill();

  // eyes
  const eye = (side: -1 | 1, open: number) => {
    const ex = fx(side * 0.083, side);
    const ey = -0.012;
    const erx = 0.043 * sideScale(side);
    const ery = 0.05;
    if (h.happy > 0.5 || h.asleep > 0.5 || open < 0.14) {
      // closed: an arc, turned up in contentment (^), down in sleep
      ctx.strokeStyle = pal.outline;
      ctx.lineWidth = 0.014;
      ctx.lineCap = "round";
      ctx.beginPath();
      const w = erx * 0.95;
      if (h.happy > 0.5) {
        ctx.moveTo(ex - w, ey + 0.012);
        ctx.quadraticCurveTo(ex, ey - 0.03, ex + w, ey + 0.012);
      } else {
        ctx.moveTo(ex - w, ey - 0.004);
        ctx.quadraticCurveTo(ex, ey + 0.026, ex + w, ey - 0.004);
      }
      ctx.stroke();
      return;
    }
    const oy = ery * open;
    ctx.fillStyle = pal.eyeRim;
    ctx.beginPath();
    ctx.ellipse(ex, ey, erx + 0.007, oy + 0.007, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = pal.eye;
    ctx.beginPath();
    ctx.ellipse(ex, ey, erx, oy, 0, 0, TAU);
    ctx.fill();
    // pupil, drawn inside the eye and following the gaze
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(ex, ey, erx, oy, 0, 0, TAU);
    ctx.clip();
    const px = ex + h.eyeX * erx * 0.45;
    const py = ey + h.eyeY * oy * 0.35;
    ctx.fillStyle = pal.pupil;
    ctx.beginPath();
    ctx.ellipse(px, py, (0.011 + 0.021 * h.pupil) * sideScale(side), oy * 0.92, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
    // the catchlight is what makes the eye look wet
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.beginPath();
    ctx.arc(ex - erx * 0.3 + h.eyeX * erx * 0.2, ey - oy * 0.38, 0.0095, 0, TAU);
    ctx.fill();
    // lid: a line along the top of the eye, heavier as it closes
    if (open < 0.95) {
      ctx.strokeStyle = pal.outline;
      ctx.lineWidth = 0.012 + 0.012 * (1 - open);
      ctx.beginPath();
      ctx.ellipse(ex, ey, erx, oy, 0, Math.PI * 1.08, Math.PI * 1.92);
      ctx.stroke();
    }
  };
  eye(-1, h.openL);
  eye(1, h.openR);

  // nose and mouth
  const nx = fx(0, 1);
  ctx.fillStyle = pal.nose;
  ctx.beginPath();
  ctx.moveTo(nx - 0.019, 0.037);
  ctx.quadraticCurveTo(nx, 0.034, nx + 0.019, 0.037);
  ctx.quadraticCurveTo(nx + 0.005, 0.062, nx, 0.063);
  ctx.quadraticCurveTo(nx - 0.005, 0.062, nx - 0.019, 0.037);
  ctx.fill();
  ctx.strokeStyle = pal.mouth;
  ctx.lineWidth = 0.0085;
  ctx.lineCap = "round";
  if (h.jaw > 0.05) {
    // open: a dark mouth with a tongue
    const open = h.jaw;
    ctx.fillStyle = pal.mouth;
    ctx.beginPath();
    ctx.ellipse(nx, 0.09 + open * 0.02, 0.04 + open * 0.012, 0.012 + open * 0.05, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = pal.tongue;
    ctx.beginPath();
    ctx.ellipse(nx, 0.11 + open * 0.035, 0.025, 0.012 + open * 0.016, 0, 0, TAU);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(nx, 0.063);
    ctx.lineTo(nx, 0.078);
    ctx.moveTo(nx - 0.042, 0.082);
    ctx.quadraticCurveTo(nx - 0.02, 0.1, nx, 0.078);
    ctx.quadraticCurveTo(nx + 0.02, 0.1, nx + 0.042, 0.082);
    ctx.stroke();
  }
  // whiskers
  ctx.strokeStyle = pal.whisker;
  ctx.lineWidth = 0.0055;
  for (const side of [-1, 1] as const) {
    for (const [dy, dx2, dy2] of [
      [0.058, 0.18, -0.02],
      [0.074, 0.2, 0.012],
      [0.09, 0.17, 0.045],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(fx(side * 0.05, side), dy);
      ctx.quadraticCurveTo(fx(side * (0.05 + dx2 * 0.5), side), dy + dy2 * 0.3 - 0.01, fx(side * (0.05 + dx2), side), dy + dy2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Where the cat's ground point is inside the canvas, and how many canvas pixels one body length is. */
export interface DrawBox {
  /** Canvas pixels, of the point on the ground under the middle of the body. */
  ox: number;
  oy: number;
  /** Canvas pixels per body length. */
  px: number;
}

export function drawCat(ctx: Ctx, pal: Palette, s: Solved, box: DrawBox): void {
  const { ox, oy, px } = box;
  const appear = clamp01(s.appear);
  if (appear <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = appear;

  // shadow
  const sw = 0.5 * (1 - 0.35 * s.air);
  const shadow = ctx.createRadialGradient(ox, oy, 0, ox, oy, sw * px);
  shadow.addColorStop(0, `rgba(0,0,0,${0.42 * (1 - 0.5 * s.air)})`);
  shadow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.save();
  ctx.translate(ox, oy + 0.01 * px);
  ctx.scale(1, 0.16);
  ctx.translate(-ox, -oy);
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.arc(ox, oy, sw * px, 0, TAU);
  ctx.fill();
  ctx.restore();

  const grow = lerp(0.82, 1, appear);
  const flip = Math.abs(s.flip) < 0.2 ? (s.flip < 0 ? -0.2 : 0.2) : s.flip;
  ctx.translate(ox, oy);
  ctx.scale(px * flip * grow * s.sx, px * grow * s.sy);
  // pitch about the middle of the body
  ctx.translate(0, -0.4);
  ctx.rotate(s.pitch);
  ctx.translate(0, 0.4);

  const p = s.pose.p;
  const { legs } = s;
  ctx.lineJoin = "round";

  if (s.pose.s.tailFront < 0.5) drawTail(ctx, pal, s.tail);

  // far legs, then the body, then the near legs
  limb(ctx, pal, legs.hf, pal.furFar, true, s.pose.s.thighR * 0.9);
  limb(ctx, pal, legs.ff, pal.furFar, true, 0.06);

  const torso: Joint[] = [p.rumpBack, p.rumpTop, p.backMid, p.shoulderTop, p.neckTop, p.chestFront, p.chestBottom, p.bellyMid, p.groin, p.rumpBottom];
  ctx.fillStyle = pal.outline;
  ctx.strokeStyle = pal.outline;
  ctx.lineWidth = OUT * 2;
  ctx.beginPath();
  blob(ctx, torso);
  ctx.stroke();
  ctx.fill();
  const body = ctx.createLinearGradient(0, p.backMid.y, 0, p.bellyMid.y);
  body.addColorStop(0, pal.fur);
  body.addColorStop(0.75, pal.fur);
  body.addColorStop(1, pal.furLight);
  ctx.fillStyle = body;
  ctx.beginPath();
  blob(ctx, torso);
  ctx.fill();

  // stripes and the white bib, kept inside the body
  ctx.save();
  ctx.beginPath();
  blob(ctx, torso);
  ctx.clip();
  ctx.strokeStyle = pal.furDark;
  ctx.globalAlpha = appear * 0.62;
  ctx.lineWidth = 0.034;
  ctx.lineCap = "round";
  const spine: Joint[] = [p.rumpTop, p.backMid, p.shoulderTop];
  for (let i = 0; i < 6; i++) {
    const f = (i + 0.5) / 6;
    const a = f < 0.5 ? spine[0]! : spine[1]!;
    const b = f < 0.5 ? spine[1]! : spine[2]!;
    const t = f < 0.5 ? f * 2 : (f - 0.5) * 2;
    const x = lerp(a.x, b.x, t);
    const y = lerp(a.y, b.y, t);
    ctx.beginPath();
    ctx.moveTo(x, y - 0.03);
    ctx.quadraticCurveTo(x + 0.03, y + 0.07, x - 0.01, y + 0.16);
    ctx.stroke();
  }
  ctx.globalAlpha = appear;
  ctx.fillStyle = pal.white;
  ctx.beginPath();
  ctx.ellipse(lerp(p.chestFront.x, p.chestBottom.x, 0.6) - 0.01, lerp(p.chestFront.y, p.chestBottom.y, 0.5), 0.1, 0.13, 0.25, 0, TAU);
  ctx.fill();
  ctx.restore();

  limb(ctx, pal, legs.hn, pal.fur, true, s.pose.s.thighR);
  limb(ctx, pal, legs.fn, pal.fur, true, 0.065);

  if (s.pose.s.tailFront >= 0.5) drawTail(ctx, pal, s.tail);

  drawHead(ctx, pal, s);
  ctx.restore();
}
