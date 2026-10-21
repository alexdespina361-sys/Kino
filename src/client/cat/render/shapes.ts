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

/**
 * Which part of the cat each number of a flat shape belongs to: 0 the front (head, chest, forelegs), 1 the rear (haunches, hind legs, tail), 2 the
 * middle of the body. The rig moves the parts with springs of their own, so that a cat that lowers itself folds its rear first and one that rises
 * lifts its front first, instead of the whole body going from one posture to the other as one piece.
 */
export const PART: Uint8Array = (() => {
  const rear = new Set<string>(["rumpBack", "rumpTop", "groin", "rumpBottom", "hip", "hn", "hf", "hock", "tailRoot", "thighR", "tailAngle", "tailCurl", "tailFront"]);
  const middle = new Set<string>(["backMid", "bellyMid"]);
  const part = new Uint8Array(POINT_KEYS.length * 2 + SCALAR_KEYS.length);
  let at = 0;
  for (const key of POINT_KEYS) {
    part[at++] = rear.has(key) ? 1 : middle.has(key) ? 2 : 0;
    part[at++] = rear.has(key) ? 1 : middle.has(key) ? 2 : 0;
  }
  for (const key of SCALAR_KEYS) part[at++] = rear.has(key) ? 1 : middle.has(key) ? 2 : 0;
  return part;
})();

/** How high each posture holds the body (for knowing whether the cat is lowering itself or rising). */
export const SHAPE_HEIGHT: Record<string, number> = { stand: 1, stretch: 0.9, air: 1, sit: 0.62, crouch: 0.45, loaf: 0.4, curl: 0.3 };

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
  rumpBack: [-0.47, -0.43],
  rumpTop: [-0.4, -0.56],
  backMid: [-0.08, -0.575],
  shoulderTop: [0.2, -0.585],
  neckTop: [0.34, -0.615],
  chestFront: [0.43, -0.45],
  chestBottom: [0.34, -0.3],
  bellyMid: [0.0, -0.285],
  groin: [-0.28, -0.315],
  rumpBottom: [-0.46, -0.345],
  shoulder: [0.27, -0.395],
  hip: [-0.33, -0.405],
  head: [0.49, -0.72],
  fn: [0.34, 0],
  ff: [0.2, 0],
  hn: [-0.3, 0],
  hf: [-0.17, 0],
  hock: [-0.07, -0.17],
  tailRoot: [-0.46, -0.45],
  headRot: 0,
  // (angles of the tail are kept in one turn, 2.9 to 4.6 radians (back, and back and up), so that blending two postures turns the tail the short way)
  tailAngle: 4.0332,
  tailCurl: 1.0,
  thighR: 0.1,
  tailFront: 0,
};

const SIT: ShapeDef = {
  rumpBack: [-0.36, -0.14],
  rumpTop: [-0.3, -0.42],
  backMid: [-0.14, -0.57],
  shoulderTop: [0.07, -0.67],
  neckTop: [0.2, -0.71],
  chestFront: [0.3, -0.58],
  chestBottom: [0.26, -0.34],
  bellyMid: [0.08, -0.2],
  groin: [-0.1, -0.1],
  rumpBottom: [-0.3, -0.03],
  shoulder: [0.17, -0.5],
  hip: [-0.2, -0.17],
  head: [0.35, -0.86],
  fn: [0.3, 0],
  ff: [0.19, 0],
  hn: [0.08, 0],
  hf: [0.02, 0],
  hock: [-0.2, -0.015],
  tailRoot: [-0.35, -0.08],
  headRot: 0,
  tailAngle: 2.95,
  tailCurl: 0.9,
  thighR: 0.17,
  tailFront: 0,
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
  tailAngle: 3.05,
  tailCurl: 0.6,
  thighR: 0.16,
  tailFront: 0,
};

// (asleep: lying as a loaf lies, the head down on the forepaws and the tail left out behind it. It used to be a tall dome with the head tucked low in front
// and the tail wound into a ball at the rump, and that read as a sack with a head and a muff)
const CURL: ShapeDef = {
  rumpBack: [-0.46, -0.1],
  rumpTop: [-0.4, -0.33],
  backMid: [-0.12, -0.37],
  shoulderTop: [0.17, -0.33],
  neckTop: [0.32, -0.3],
  chestFront: [0.42, -0.19],
  chestBottom: [0.35, -0.05],
  bellyMid: [0.0, -0.02],
  groin: [-0.28, -0.02],
  rumpBottom: [-0.45, -0.04],
  shoulder: [0.27, -0.16],
  hip: [-0.3, -0.16],
  head: [0.56, -0.2],
  fn: [0.63, -0.01],
  ff: [0.54, 0],
  hn: [-0.06, 0],
  hf: [-0.14, 0],
  hock: [-0.2, -0.015],
  tailRoot: [-0.46, -0.1],
  headRot: 0.28,
  tailAngle: 3.1,
  tailCurl: 0.4,
  thighR: 0.16,
  tailFront: 0,
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
  tailAngle: 4.5832,
  tailCurl: 0.5,
  thighR: 0.1,
  tailFront: 0,
};

// (a leap: the body as thick as a standing one's, only a little longer, the forelegs reaching out and the hind legs trailing in a line, the foot
// carrying on from the shin: the hock is in front of the toe, and as far from it as it is in a stand, so that no part of a leg is stretched)
const AIR: ShapeDef = {
  rumpBack: [-0.47, -0.42],
  rumpTop: [-0.41, -0.54],
  backMid: [-0.08, -0.57],
  shoulderTop: [0.21, -0.58],
  neckTop: [0.35, -0.6],
  chestFront: [0.44, -0.44],
  chestBottom: [0.35, -0.31],
  bellyMid: [0.0, -0.31],
  groin: [-0.29, -0.31],
  rumpBottom: [-0.46, -0.32],
  shoulder: [0.29, -0.4],
  hip: [-0.34, -0.41],
  head: [0.55, -0.7],
  fn: [0.66, -0.3],
  ff: [0.57, -0.38],
  hn: [-0.93, -0.25],
  hf: [-0.84, -0.33],
  hock: [0.17, -0.07],
  tailRoot: [-0.47, -0.44],
  headRot: -0.1,
  tailAngle: 3.35,
  tailCurl: 0.3,
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
