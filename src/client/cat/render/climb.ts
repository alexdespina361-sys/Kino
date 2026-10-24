import { clamp01, smoothstep } from "../math";
import { CLIMB_BACK, CLIMB_GRAB, CLIMB_LIP, CLIMB_OVER, CLIMB_PULL } from "../types";

/**
 * The simple cat's climb (the `climb` clip), as it goes through its `progress` (pure, so that it is tested and looked at without a cat): where the drawn cat is, and how it is tipped. The engine holds the
 * frame at the point the cat ends up standing at, and the picture starts below and behind it, hanging by the forepaws from the lip, and ends on it; all of it is here. Everything is in body lengths, as seen with the
 * cat facing right, from that point: `x` is forward, `y` down, and the lip the forepaws grip is at (-`CLIMB_LIP`, 0).
 *
 * The beats are the clip's marks (see the types): it hangs and takes hold (to `CLIMB_GRAB`), pulls itself up (to `CLIMB_PULL`: the chest is over the lip, the paws on top of the ledge), scrambles
 * with the hind legs until they are over (`CLIMB_OVER`), and stands.
 */
export interface ClimbPose {
  /** Where the drawn cat's ground point is, from the point it ends up standing at (the numbers of a key: see `KEYS`). */
  x: number;
  y: number;
  /** How the body is tipped, radians (negative lifts the nose): nearly upright while it hangs. */
  pitch: number;
  /** 0..1: how much of the cat hangs, with the hind legs and the tail down in the world as they hang in a hand (it is over the lip at the end of the scramble). */
  hang: number;
  /** 0..1: how much the forelegs reach for the lip, or lie on the ledge, instead of standing. */
  paws: number;
  /** 0..1: where the forepaws are on their way from the lip (0) to on top of the ledge (1). */
  top: number;
  /** 0..1: how hard the hind legs scramble against the face of the ledge. */
  scramble: number;
  /** 0..1: how much its weight stretches the body (the stretched shape of the air is mixed into the standing one). */
  stretch: number;
}

/** The place and the tip of the drawn cat at the marks: [progress, x, y, pitch]. They were worked out for the simple cat's own proportions (the shoulder is a leg's length below the lip, hanging). */
const KEYS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, -CLIMB_BACK, 0.99, -1.2],
  [CLIMB_GRAB, -CLIMB_BACK, 0.95, -1.2],
  [CLIMB_PULL, -0.76, 0.45, -0.7],
  [CLIMB_OVER, -0.07, 0.127, -0.12],
  [1, 0, 0, 0],
];

/** The tangents of a curve through the keys that has no more ups and downs than they have (monotone cubic Hermite), flat at its two ends. */
function tangents(column: 1 | 2 | 3): number[] {
  const n = KEYS.length;
  const slope: number[] = [];
  for (let i = 0; i + 1 < n; i++) slope.push((KEYS[i + 1]![column] - KEYS[i]![column]) / (KEYS[i + 1]![0] - KEYS[i]![0]));
  const m: number[] = new Array<number>(n).fill(0);
  for (let i = 1; i + 1 < n; i++) {
    const a = slope[i - 1]!;
    const b = slope[i]!;
    if (a * b <= 0) continue;
    const h0 = KEYS[i]![0] - KEYS[i - 1]![0];
    const h1 = KEYS[i + 1]![0] - KEYS[i]![0];
    // (the weighted harmonic mean of the two slopes)
    m[i] = (3 * (h0 + h1)) / ((2 * h1 + h0) / a + (h1 + 2 * h0) / b);
  }
  return m;
}

const TANGENTS = { x: tangents(1), y: tangents(2), pitch: tangents(3) } as const;

function curve(column: 1 | 2 | 3, m: readonly number[], q: number): number {
  let i = 0;
  while (i + 2 < KEYS.length && q > KEYS[i + 1]![0]) i++;
  const a = KEYS[i]!;
  const b = KEYS[i + 1]!;
  const h = b[0] - a[0];
  const t = (q - a[0]) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * a[column] + (t3 - 2 * t2 + t) * h * m[i]! + (-2 * t3 + 3 * t2) * b[column] + (t3 - t2) * h * m[i + 1]!;
}

/** The cat at `progress` (0..1) of a climb. */
export function climbPose(progress: number): ClimbPose {
  const q = clamp01(progress);
  return {
    x: curve(1, TANGENTS.x, q),
    y: curve(2, TANGENTS.y, q),
    pitch: curve(3, TANGENTS.pitch, q),
    hang: 1 - smoothstep(CLIMB_PULL, CLIMB_OVER + 0.03, q),
    paws: 1 - smoothstep(CLIMB_OVER, 0.97, q),
    top: smoothstep(CLIMB_GRAB + 0.05, CLIMB_PULL, q),
    scramble: smoothstep(0.3, 0.45, q) * (1 - smoothstep(CLIMB_OVER - 0.05, CLIMB_OVER + 0.05, q)),
    stretch: 0.45 * (1 - smoothstep(CLIMB_GRAB, CLIMB_OVER, q)),
  };
}

/** Where the forepaws are, from the point the cat ends up standing at, facing right: the near one and the far one (the far one a little behind), on the lip and then on top of the ledge. */
export function climbPaws(top: number): { near: { x: number; y: number }; far: { x: number; y: number } } {
  const t = clamp01(top);
  return {
    near: { x: -CLIMB_LIP + 0.02 + 0.3 * t, y: -0.015 - 0.005 * t },
    far: { x: -CLIMB_LIP - 0.03 + 0.37 * t, y: -0.015 - 0.005 * t },
  };
}
