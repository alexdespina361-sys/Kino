/** Small numeric helpers shared by the engine and the renderer. Pure, and free of the browser. */

export const TAU = Math.PI * 2;

export const clamp = (value: number, min: number, max: number): number => (value < min ? min : value > max ? max : value);
export const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** 0 at `a`, 1 at `b`, eased at both ends. */
export const smoothstep = (a: number, b: number, value: number): number => {
  const t = clamp01((value - a) / (b - a || 1));
  return t * t * (3 - 2 * t);
};
export const easeInOut = (t: number): number => {
  const c = clamp01(t);
  return c < 0.5 ? 2 * c * c : 1 - Math.pow(-2 * c + 2, 2) / 2;
};
export const easeOut = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3);
/** Fractional part, always in [0, 1). */
export const fract = (value: number): number => value - Math.floor(value);
export const finite = (value: number, fallback = 0): number => (Number.isFinite(value) ? value : fallback);
/** The shortest signed turn from angle `a` to angle `b`, in radians. */
export const angleDelta = (a: number, b: number): number => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
};

/**
 * How long the cat's body is, in pixels, for a screen of this size: 4.8 of the TV's `em` (a hundredth of the width of a 16:9 screen), so it
 * is the same share of the picture on every TV, and never smaller than a thumb on a small window.
 */
export const bodyLengthFor = (width: number, height: number): number => Math.max(40, Math.round(4.8 * Math.max(9, Math.min(width / 100, (height * 1.7778) / 100))));

/** A value that chases a target with a spring: `x` is where it is, `v` how fast it is moving. */
export interface Dyn {
  x: number;
  v: number;
}
export const dyn = (x = 0): Dyn => ({ x, v: 0 });

/**
 * Critically damped spring (no overshoot), exact for any step: `x` reaches `target` in about 1/`freq` seconds. Used for everything that must
 * settle softly (a posture, where the head looks, the sway of a tail).
 */
export function smooth(d: Dyn, target: number, freq: number, dt: number): number {
  const w = TAU * freq;
  const dx = d.x - target;
  const t1 = (d.v + w * dx) * dt;
  const e = Math.exp(-w * dt);
  d.x = target + (dx + t1) * e;
  d.v = (d.v - w * t1) * e;
  return d.x;
}

/**
 * A spring that overshoots and rings (`zeta` below 1): a landing that squashes and recovers, an ear that flicks. Stepped in small pieces,
 * so it stays stable for the longest frame the cat is ever given.
 */
export function bounce(d: Dyn, target: number, freq: number, zeta: number, dt: number): number {
  const w = TAU * freq;
  const steps = Math.max(1, Math.ceil((dt * w) / 0.6));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    const a = w * w * (target - d.x) - 2 * zeta * w * d.v;
    d.v += a * h;
    d.x += d.v * h;
  }
  return d.x;
}

/** Two-bone inverse kinematics: where the middle joint (elbow, knee) goes when the chain from (rx, ry) reaches for (tx, ty). `bend` is +1 or -1: which side it bends to. */
export function twoBone(rx: number, ry: number, tx: number, ty: number, l1: number, l2: number, bend: 1 | -1): { jx: number; jy: number; ex: number; ey: number } {
  let dx = tx - rx;
  let dy = ty - ry;
  let dist = Math.hypot(dx, dy);
  if (dist < 1e-6) {
    dx = 0;
    dy = 1e-6;
    dist = 1e-6;
  }
  // (a target out of reach is pulled in to where the chain just reaches; one too near is pushed out to where it is folded)
  const reach = clamp(dist, Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
  const ux = dx / dist;
  const uy = dy / dist;
  const a = (l1 * l1 - l2 * l2 + reach * reach) / (2 * reach);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  return { jx: rx + ux * a - uy * h * bend, jy: ry + uy * a + ux * h * bend, ex: rx + ux * reach, ey: ry + uy * reach };
}
