import type { CatCoat } from "../../settings";

/**
 * What the shader needs to paint a coat on the cat (the shapes of the markings are in the shader; a coat is the colours of it and how much of each
 * marking it has). Colours are as they look on a screen (sRGB, 0 to 1).
 */
export interface Coat {
  /** The body, the lighter underside, and the colour of the stripes. */
  base: readonly [number, number, number];
  light: readonly [number, number, number];
  stripe: readonly [number, number, number];
  /** The colour of the white (a coat has its own warm or cool white), and the two colours of a patched coat. */
  white: readonly [number, number, number];
  patchA: readonly [number, number, number];
  patchB: readonly [number, number, number];
  /** The colour of a ragdoll's points (the mask, the ears, the tail), and how much of the coat has them (0 none). */
  point: readonly [number, number, number];
  points: number;
  /** The eye's iris: the dark of the rim and of the shade under the lid, the body of it, and the light of its lower part. */
  iris: readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]];
  /** How much of the coat is striped (0 is plain), how much white it has (1 is a ginger's chest and socks), how much of it is a tuxedo's (white belly, boots and blaze), how much is patched. */
  stripes: number;
  whites: number;
  tuxedo: number;
  patches: number;
}

export const COATS: Record<CatCoat, Coat> = {
  // a blue bicolour ragdoll: a white coat, cool grey points (the mask, the ears, the tail), a white blaze, muzzle, chest and feet, and big blue eyes
  ragdoll: {
    base: [0.9, 0.89, 0.9],
    light: [0.97, 0.96, 0.96],
    stripe: [0.5, 0.5, 0.53],
    white: [0.985, 0.975, 0.97],
    patchA: [0.9, 0.56, 0.25],
    patchB: [0.7, 0.34, 0.12],
    point: [0.62, 0.61, 0.63],
    points: 1,
    iris: [[0.14, 0.25, 0.37], [0.4, 0.6, 0.76], [0.58, 0.76, 0.87]],
    stripes: 0,
    whites: 1.3,
    tuxedo: 0,
    patches: 0,
  },  ginger: {
    base: [0.93, 0.66, 0.37],
    light: [0.99, 0.85, 0.66],
    stripe: [0.78, 0.44, 0.19],
    white: [1, 0.95, 0.88],
    patchA: [0.9, 0.56, 0.25],
    patchB: [0.7, 0.34, 0.12],
    point: [0.5, 0.5, 0.52],
    points: 0,
    iris: [[0.4, 0.31, 0.06], [0.86, 0.7, 0.18], [0.99, 0.9, 0.46]],
    stripes: 0.9,
    whites: 1,
    tuxedo: 0,
    patches: 0,
  },
  tuxedo: {
    base: [0.085, 0.08, 0.09],
    light: [0.97, 0.94, 0.9],
    stripe: [0.13, 0.12, 0.14],
    white: [0.98, 0.96, 0.93],
    patchA: [0.9, 0.56, 0.25],
    patchB: [0.7, 0.34, 0.12],
    point: [0.5, 0.5, 0.52],
    points: 0,
    iris: [[0.3, 0.33, 0.07], [0.74, 0.74, 0.2], [0.96, 0.95, 0.5]],
    stripes: 0,
    whites: 1.35,
    tuxedo: 1,
    patches: 0,
  },
  grey: {
    base: [0.5, 0.52, 0.56],
    light: [0.74, 0.75, 0.78],
    stripe: [0.17, 0.18, 0.21],
    white: [0.97, 0.96, 0.95],
    patchA: [0.9, 0.56, 0.25],
    patchB: [0.7, 0.34, 0.12],
    point: [0.5, 0.5, 0.52],
    points: 0,
    iris: [[0.22, 0.33, 0.1], [0.55, 0.72, 0.28], [0.9, 0.96, 0.55]],
    stripes: 1,
    whites: 1,
    tuxedo: 0,
    patches: 0,
  },
  calico: {
    base: [0.98, 0.95, 0.9],
    light: [0.98, 0.95, 0.9],
    stripe: [0.7, 0.34, 0.12],
    white: [0.98, 0.95, 0.9],
    patchA: [0.88, 0.5, 0.19],
    patchB: [0.14, 0.13, 0.15],
    point: [0.5, 0.5, 0.52],
    points: 0,
    iris: [[0.4, 0.31, 0.06], [0.86, 0.7, 0.18], [0.99, 0.9, 0.46]],
    stripes: 0,
    whites: 1.1,
    tuxedo: 1,
    patches: 1,
  },
};
