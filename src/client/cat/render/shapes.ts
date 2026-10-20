/**
 * The cat's postures, as shapes. Each is a handful of key points of a cat seen from the side, facing right, in units of its body length,
 * with the ground at y = 0 (up is negative) and x = 0 under the middle of the body. The rig blends them (a cat going from standing to sitting is
 * a spring moving the weight from one shape to the other) and adds what changes every frame: steps, breathing, the head, the tail.
 * All of this is original: drawn for Kino's cat, from nothing but the idea of a cat.
 */

export type P = readonly [number, number];

export interface ShapeDef {
  /** The line of the back, from the rump to the neck. */
  rumpBack: P;
  rumpTop: P;
  backMid: P;
  shoulderTop: P;
  neckTop: P;
  /** The line of the chest and belly, from the chest back to the rump. */
  chestFront: P;
  chestBottom: P;
  bellyMid: P;
  groin: P;
  rumpBottom: P;
  /** Where the front and the hind legs start. */
  shoulder: P;
  hip: P;
  /** The middle of the head. */
  head: P;
  /** Where each paw rests: front near, front far, hind near, hind far (y is 0 on the ground). */
  fn: P;
  ff: P;
  hn: P;
  hf: P;
  /** The hind hocks, as the offset from their paws (a standing cat's hock is up and behind the paw, a sitting cat's is on the ground). */
  hock: P;
  tailRoot: P;
  headRot: number;
  /** The first piece of the tail points this way (radians, 0 is forward, -pi/2 up), and the tail turns by `tailCurl` along its length. */
  tailAngle: number;
  tailCurl: number;
  /** How thick the thigh is at the hip (a sitting cat's haunch is round and big). */
  thighR: number;
  /** 0: the tail is behind the body; 1: it lies in front of it (around the paws, over the nose). */
  tailFront: number;
}

export const POINT_KEYS = [
  "rumpBack",
  "rumpTop",
  "backMid",
  "shoulderTop",
  "neckTop",
  "chestFront",
  "chestBottom",
  "bellyMid",
  "groin",
  "rumpBottom",
  "shoulder",
  "hip",
  "head",
  "fn",
  "ff",
  "hn",
  "hf",
  "hock",
  "tailRoot",
] as const;
export const SCALAR_KEYS = ["headRot", "tailAngle", "tailCurl", "thighR", "tailFront"] as const;
export type PointKey = (typeof POINT_KEYS)[number];
export type ScalarKey = (typeof SCALAR_KEYS)[number];

export const SHAPE_LENGTH = POINT_KEYS.length * 2 + SCALAR_KEYS.length;

export type ShapeName = "stand" | "sit" | "loaf" | "curl" | "crouch" | "stretch" | "air";
export const SHAPE_NAMES: readonly ShapeName[] = ["stand", "sit", "loaf", "curl", "crouch", "stretch", "air"];

/** A shape as one list of numbers, so shapes can be blended by adding them up. */
export function flatten(def: ShapeDef): Float64Array {
  const out = new Float64Array(SHAPE_LENGTH);
  let at = 0;
  for (const key of POINT_KEYS) {
    out[at++] = def[key][0];
    out[at++] = def[key][1];
  }
  for (const key of SCALAR_KEYS) out[at++] = def[key];
  return out;
}

/** The numbers of a blended shape, read by name. */
export interface Pose {
  p: Record<PointKey, { x: number; y: number }>;
  s: Record<ScalarKey, number>;
}

export function makePose(): Pose {
  const p = {} as Pose["p"];
  for (const key of POINT_KEYS) p[key] = { x: 0, y: 0 };
  const s = {} as Pose["s"];
  for (const key of SCALAR_KEYS) s[key] = 0;
  return { p, s };
}

export function unflatten(values: Float64Array, into: Pose): Pose {
  let at = 0;
  for (const key of POINT_KEYS) {
    into.p[key].x = values[at++] ?? 0;
    into.p[key].y = values[at++] ?? 0;
  }
  for (const key of SCALAR_KEYS) into.s[key] = values[at++] ?? 0;
  return into;
}

const STAND: ShapeDef = {
  rumpBack: [-0.47, -0.45],
  rumpTop: [-0.4, -0.58],
  backMid: [-0.08, -0.6],
  shoulderTop: [0.2, -0.61],
  neckTop: [0.34, -0.64],
  chestFront: [0.43, -0.47],
  chestBottom: [0.34, -0.34],
  bellyMid: [0.0, -0.32],
  groin: [-0.28, -0.34],
  rumpBottom: [-0.46, -0.36],
  shoulder: [0.27, -0.42],
  hip: [-0.33, -0.43],
  head: [0.5, -0.76],
  fn: [0.34, 0],
  ff: [0.2, 0],
  hn: [-0.3, 0],
  hf: [-0.17, 0],
  hock: [-0.07, -0.17],
  tailRoot: [-0.46, -0.47],
  headRot: 0,
  tailAngle: -2.25,
  tailCurl: 1.0,
  thighR: 0.1,
  tailFront: 0,
};

const SIT: ShapeDef = {
  rumpBack: [-0.36, -0.14],
  rumpTop: [-0.3, -0.42],
  backMid: [-0.14, -0.6],
  shoulderTop: [0.06, -0.72],
  neckTop: [0.18, -0.77],
  chestFront: [0.28, -0.62],
  chestBottom: [0.25, -0.36],
  bellyMid: [0.08, -0.2],
  groin: [-0.1, -0.1],
  rumpBottom: [-0.3, -0.03],
  shoulder: [0.16, -0.52],
  hip: [-0.2, -0.17],
  head: [0.3, -0.96],
  fn: [0.3, 0],
  ff: [0.19, 0],
  hn: [0.08, 0],
  hf: [0.02, 0],
  hock: [-0.2, -0.015],
  tailRoot: [-0.35, -0.08],
  headRot: 0,
  tailAngle: 2.9,
  tailCurl: -2.6,
  thighR: 0.17,
  tailFront: 1,
};

const LOAF: ShapeDef = {
  rumpBack: [-0.47, -0.1],
  rumpTop: [-0.4, -0.31],
  backMid: [-0.1, -0.36],
  shoulderTop: [0.18, -0.39],
  neckTop: [0.3, -0.42],
  chestFront: [0.4, -0.25],
  chestBottom: [0.34, -0.06],
  bellyMid: [0.0, -0.02],
  groin: [-0.28, -0.02],
  rumpBottom: [-0.45, -0.04],
  shoulder: [0.27, -0.2],
  hip: [-0.3, -0.16],
  head: [0.44, -0.58],
  fn: [0.52, -0.01],
  ff: [0.43, 0],
  hn: [-0.06, 0],
  hf: [-0.14, 0],
  hock: [-0.2, -0.015],
  tailRoot: [-0.47, -0.1],
  headRot: 0.06,
  tailAngle: 3.0,
  tailCurl: -2.3,
  thighR: 0.16,
  tailFront: 1,
};

const CURL: ShapeDef = {
  rumpBack: [-0.46, -0.12],
  rumpTop: [-0.38, -0.4],
  backMid: [-0.08, -0.47],
  shoulderTop: [0.2, -0.43],
  neckTop: [0.33, -0.33],
  chestFront: [0.44, -0.17],
  chestBottom: [0.35, -0.03],
  bellyMid: [0.0, -0.02],
  groin: [-0.3, -0.02],
  rumpBottom: [-0.46, -0.04],
  shoulder: [0.28, -0.17],
  hip: [-0.3, -0.15],
  head: [0.36, -0.2],
  fn: [0.52, -0.01],
  ff: [0.44, 0],
  hn: [0.02, 0],
  hf: [-0.08, 0],
  hock: [-0.2, -0.015],
  tailRoot: [-0.47, -0.12],
  headRot: 0.55,
  tailAngle: 3.0,
  tailCurl: -2.8,
  thighR: 0.17,
  tailFront: 1,
};

const CROUCH: ShapeDef = {
  rumpBack: [-0.47, -0.31],
  rumpTop: [-0.41, -0.42],
  backMid: [-0.08, -0.4],
  shoulderTop: [0.22, -0.36],
  neckTop: [0.36, -0.36],
  chestFront: [0.45, -0.25],
  chestBottom: [0.35, -0.13],
  bellyMid: [0.0, -0.14],
  groin: [-0.28, -0.2],
  rumpBottom: [-0.45, -0.19],
  shoulder: [0.28, -0.22],
  hip: [-0.33, -0.28],
  head: [0.55, -0.46],
  fn: [0.4, 0],
  ff: [0.3, 0],
  hn: [-0.17, 0],
  hf: [-0.09, 0],
  hock: [-0.14, -0.07],
  tailRoot: [-0.47, -0.33],
  headRot: 0.1,
  tailAngle: 3.0,
  tailCurl: -0.4,
  thighR: 0.13,
  tailFront: 0,
};

const STRETCH: ShapeDef = {
  rumpBack: [-0.5, -0.62],
  rumpTop: [-0.42, -0.7],
  backMid: [-0.1, -0.52],
  shoulderTop: [0.2, -0.36],
  neckTop: [0.36, -0.3],
  chestFront: [0.45, -0.2],
  chestBottom: [0.35, -0.13],
  bellyMid: [0.0, -0.3],
  groin: [-0.28, -0.44],
  rumpBottom: [-0.46, -0.48],
  shoulder: [0.28, -0.24],
  hip: [-0.34, -0.54],
  head: [0.6, -0.3],
  fn: [0.64, 0],
  ff: [0.54, 0],
  hn: [-0.4, 0],
  hf: [-0.31, 0],
  hock: [-0.07, -0.16],
  tailRoot: [-0.5, -0.64],
  headRot: 0.35,
  tailAngle: -1.7,
  tailCurl: 0.5,
  thighR: 0.1,
  tailFront: 0,
};

const AIR: ShapeDef = {
  rumpBack: [-0.5, -0.4],
  rumpTop: [-0.43, -0.49],
  backMid: [-0.08, -0.51],
  shoulderTop: [0.22, -0.53],
  neckTop: [0.38, -0.55],
  chestFront: [0.46, -0.41],
  chestBottom: [0.36, -0.3],
  bellyMid: [0.0, -0.3],
  groin: [-0.3, -0.32],
  rumpBottom: [-0.48, -0.31],
  shoulder: [0.3, -0.38],
  hip: [-0.36, -0.38],
  head: [0.6, -0.64],
  fn: [0.74, -0.22],
  ff: [0.64, -0.3],
  hn: [-0.66, -0.12],
  hf: [-0.54, -0.2],
  hock: [-0.1, -0.1],
  tailRoot: [-0.5, -0.42],
  headRot: -0.1,
  tailAngle: 3.0,
  tailCurl: 0.2,
  thighR: 0.1,
  tailFront: 0,
};

export const SHAPES: Record<ShapeName, ShapeDef> = { stand: STAND, sit: SIT, loaf: LOAF, curl: CURL, crouch: CROUCH, stretch: STRETCH, air: AIR };
export const FLAT: Record<ShapeName, Float64Array> = {
  stand: flatten(STAND),
  sit: flatten(SIT),
  loaf: flatten(LOAF),
  curl: flatten(CURL),
  crouch: flatten(CROUCH),
  stretch: flatten(STRETCH),
  air: flatten(AIR),
};
