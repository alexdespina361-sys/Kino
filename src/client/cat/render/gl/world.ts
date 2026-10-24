/**
 * The matrices the solid cat's camera is made of: 3 x 4, row after row, in the cat's own space (x forward, y up, z toward the viewer, body lengths). The bones
 * (pose.ts) are put through one of these, the whole cat's turn, squash and tilt, so that the shader has only one thing to do with a bone.
 */

export type Mat = Float64Array;

export const mat = (): Mat => {
  const m = new Float64Array(12);
  m[0] = m[5] = m[10] = 1;
  return m;
};

const scratch = new Float64Array(12);

/** out = a after b (b is applied first). */
export function mul(out: Mat, a: Mat, b: Mat): Mat {
  for (let r = 0; r < 3; r++) {
    const a0 = a[r * 4]!;
    const a1 = a[r * 4 + 1]!;
    const a2 = a[r * 4 + 2]!;
    for (let c = 0; c < 3; c++) scratch[r * 4 + c] = a0 * b[c]! + a1 * b[4 + c]! + a2 * b[8 + c]!;
    scratch[r * 4 + 3] = a0 * b[3]! + a1 * b[7]! + a2 * b[11]! + a[r * 4 + 3]!;
  }
  out.set(scratch);
  return out;
}

/** The pitch of the body by `angle` about the point (0, pivotY) of its own side view: that point stays where it is (a cat that tips over in a hand does not swing off sideways). */
export function pitchAbout(out: Mat, angle: number, pivotY: number): Mat {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  out.fill(0);
  out[0] = c;
  out[1] = -s;
  out[4] = s;
  out[5] = c;
  out[10] = 1;
  out[3] = s * pivotY;
  out[7] = pivotY - c * pivotY;
  return out;
}
