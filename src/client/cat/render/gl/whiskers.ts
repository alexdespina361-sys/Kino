import { HEAD_REST } from "./model";
import { BONE } from "./skeleton";

/**
 * The whiskers: a few hairlines on each side of the muzzle, in the rest posture, carried by the head's bone (so they turn with the head, and the head's
 * lean and yaw are theirs). They are lines, a pixel wide, as a whisker is to the eye at the size the cat is on a screen; they fade towards the tip.
 * Drawn after the cat, with the same vertex program (the skin of the mesh is the head bone alone).
 */

export interface Whiskers {
  /** The number of points (two to a segment: they are drawn as lines). */
  count: number;
  pos: Float32Array;
  normal: Int8Array;
  skin: Uint8Array;
  weight: Uint8Array;
  paint: Uint8Array;
}

/** Where each row starts on the muzzle, how far up (or down) it points, and how long it is, in body lengths: rows from the top of the muzzle down. */
const ROWS = [
  { x: 0.094, y: -0.033, up: 0.3, len: 0.098 },
  { x: 0.099, y: -0.042, up: 0.08, len: 0.122 },
  { x: 0.1, y: -0.051, up: -0.12, len: 0.118 },
  { x: 0.096, y: -0.059, up: -0.3, len: 0.094 },
] as const;
const PIECES = 5;

export function makeWhiskers(): Whiskers {
  const segments = ROWS.length * 2 * PIECES;
  const count = segments * 2;
  const pos = new Float32Array(count * 3);
  const normal = new Int8Array(count * 3);
  const skin = new Uint8Array(count * 4);
  const weight = new Uint8Array(count * 4);
  const paint = new Uint8Array(count * 4);
  let at = 0;
  const put = (x: number, y: number, z: number, fade: number): void => {
    pos[at * 3] = HEAD_REST[0] + x;
    pos[at * 3 + 1] = HEAD_REST[1] + y;
    pos[at * 3 + 2] = HEAD_REST[2] + z;
    normal[at * 3 + 2] = 127;
    skin[at * 4] = BONE.head;
    weight[at * 4] = 255;
    paint[at * 4] = Math.round(255 * fade);
    at++;
  };
  for (const side of [1, -1]) {
    for (const row of ROWS) {
      // the way it points: forward and out, up or down by the row; it bends down towards the tip, and a little forward
      const norm = Math.hypot(0.62, row.up, 0.78);
      const dx = 0.62 / norm;
      const dy = row.up / norm;
      const dz = (0.78 / norm) * side;
      const at3 = (t: number): [number, number, number] => [row.x + dx * row.len * t + 0.1 * row.len * t * t, row.y + dy * row.len * t - 0.3 * row.len * t * t, side * 0.044 + dz * row.len * t];
      for (let i = 0; i < PIECES; i++) {
        const t0 = i / PIECES;
        const t1 = (i + 1) / PIECES;
        const a = at3(t0);
        const b = at3(t1);
        put(a[0], a[1], a[2], 0.9 - 0.55 * t0);
        put(b[0], b[1], b[2], 0.9 - 0.55 * t1);
      }
    }
  }
  return { count, pos, normal, skin, weight, paint };
}
