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
  /** How much of the coat is striped (0 is plain), how much white it has (1 is a ginger's chest and socks), how much of it is a tuxedo's (white belly, boots and blaze), how much is patched. */
  stripes: number;
  whites: number;
  tuxedo: number;
  patches: number;
}

export const COATS: Record<CatCoat, Coat> = {
  ginger: {
    base: [0.93, 0.66, 0.37],
    light: [0.99, 0.85, 0.66],
    stripe: [0.78, 0.44, 0.19],
    white: [1, 0.95, 0.88],
    patchA: [0.9, 0.56, 0.25],
    patchB: [0.7, 0.34, 0.12],
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
    stripes: 0,
    whites: 1.1,
    tuxedo: 1,
    patches: 1,
  },
};
