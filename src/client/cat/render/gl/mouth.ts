/**
 * Where the cat's mouth and eyes are, in the head's own coordinates (x forward, y up, z across; body lengths; the origin is the centre of the head in the rest).
 *
 * The lip line is one line shared by the mesh builder and the shader: the builder gives every point below it to the lower jaw and every point above it to
 * the head (so that the skin between the lips is a thin band that stretches when the jaw drops), and the shader paints that band as the inside of a mouth
 * when the jaw is open. Written once here so that the two cannot drift apart.
 */

export const MOUTH = {
  /** The lip line at the middle of the muzzle (under the nose). */
  front: -0.066,
  /** How much deeper it goes to each side (the two curves of the mouth under the nose), and how far out the mouth reaches: the curve of a side runs from the middle to here. */
  wave: 0.008,
  half: 0.04,
  /** How much lower it is at the corner of the mouth than at the front. */
  corner: 0.005,
  /** Half the thickness of the band of skin that is shared by the lips. */
  band: 0.0065,
  /** Where the jaw's share grows from nothing (near the hinge) to all of it. */
  hingeA: -0.01,
  hingeB: 0.04,
} as const;

/** The way round of the curve of the mouth, as a number for sin (the curve is half a turn long). */
const FREQ = Math.PI / MOUTH.half;

/** The eyes: where each one is (the other is at -z), and half of its width and of its height. */
export const EYE = { x: 0.057, y: 0.009, z: 0.05, a: 0.0285, b: 0.0185 } as const;

/** smoothstep that also takes its edges the wrong way round (the one in GLSL is not defined for that). */
export const sstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The height of the line where the lips meet, at a place on the face (hx forward, hz across). */
export function lipY(hx: number, hz: number): number {
  return MOUTH.front - MOUTH.wave * Math.sin(Math.min(Math.abs(hz), MOUTH.half) * FREQ) - MOUTH.corner * sstep(0.095, 0.03, hx);
}

/** How much of the lower jaw a point of the face is (0..1): by where it stands against the lip line. */
export function jawShare(hx: number, hy: number, hz: number): number {
  const line = lipY(hx, hz);
  const below = sstep(line + MOUTH.band, line - MOUTH.band, hy);
  const ahead = sstep(MOUTH.hingeA, MOUTH.hingeB, hx);
  const side = sstep(MOUTH.half + 0.018, MOUTH.half, Math.abs(hz));
  const throat = sstep(-0.19, -0.15, hy);
  return below * ahead * side * throat;
}

/** The same line, in GLSL (for the shader), made from the same numbers. */
export const LIP_GLSL = /* glsl */ `
float lipY(float hx, float hz) {
  return ${MOUTH.front.toFixed(5)} - ${MOUTH.wave.toFixed(5)} * sin(min(abs(hz), ${MOUTH.half.toFixed(5)}) * ${FREQ.toFixed(4)}) - ${MOUTH.corner.toFixed(5)} * sstep(0.095, 0.03, hx);
}
`;
