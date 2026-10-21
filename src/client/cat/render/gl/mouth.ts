/**
 * Where the cat's mouth is, in the head's own coordinates (x forward, y up, z across; body lengths; the origin is the centre of the head in the rest).
 *
 * The lip line is one line shared by the mesh builder and the shader: the builder gives every point below it to the lower jaw and every point above it to
 * the head (so that the skin between the lips is a thin band that stretches when the jaw drops), and the shader paints that band as the inside of a mouth
 * when the jaw is open and as a thin dark line when it is shut. Written once here so that the two cannot drift apart.
 */

export const MOUTH = {
  /** The lip line at the middle of the muzzle (under the nose). */
  front: -0.052,
  /** How much deeper it goes to each side (the two curves of the mouth under the nose), and the pace of that curve across. */
  wave: 0.012,
  freq: 60.4,
  /** How much lower it is at the corner of the mouth than at the front. */
  corner: 0.006,
  /** Half the thickness of the band of skin that is shared by the lips. */
  band: 0.0075,
  /** Where the jaw's share grows from nothing (near the hinge) to all of it. */
  hingeA: 0.02,
  hingeB: 0.07,
} as const;

/** smoothstep that also takes its edges the wrong way round (the one in GLSL is not defined for that). */
export const sstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The height of the line where the lips meet, at a place on the face (hx forward, hz across). */
export function lipY(hx: number, hz: number): number {
  return MOUTH.front - MOUTH.wave * Math.sin(Math.min(Math.abs(hz), 0.052) * MOUTH.freq) - MOUTH.corner * sstep(0.12, 0.05, hx);
}

/** How much of the lower jaw a point of the face is (0..1): by where it stands against the lip line. */
export function jawShare(hx: number, hy: number, hz: number): number {
  const line = lipY(hx, hz);
  const below = sstep(line + MOUTH.band, line - MOUTH.band, hy);
  const ahead = sstep(MOUTH.hingeA, MOUTH.hingeB, hx);
  const side = sstep(0.078, 0.056, Math.abs(hz));
  const throat = sstep(-0.15, -0.1, hy);
  return below * ahead * side * throat;
}

/** The same line, in GLSL (for the shader), made from the same numbers. */
export const LIP_GLSL = /* glsl */ `
float lipY(float hx, float hz) {
  return ${MOUTH.front.toFixed(5)} - ${MOUTH.wave.toFixed(5)} * sin(min(abs(hz), 0.052) * ${MOUTH.freq.toFixed(3)}) - ${MOUTH.corner.toFixed(5)} * sstep(0.12, 0.05, hx);
}
`;
