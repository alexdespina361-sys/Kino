import { clamp01, lerp } from "../math";
import { SWAT_HIT } from "../types";

/**
 * The cat's swat at a poster, as the paw moves through it (pure, so that it is tested and looked at without a cat). Everything is measured from the shoulder
 * and from the line to the poster: `turn` is how far the paw is swung off that line (radians, negative: raised, up and back), `reach` how far from the shoulder
 * it is (body lengths), `lean` how much of the cat's weight has gone forward onto the poster (0..1: the shoulders sink and the head goes down and forward; below
 * 0 it has gone back, the chest up, to put the paw up).
 *
 * The beats, as a share of the swat: the weight goes back a little and the paw is raised high behind the shoulder (to 0.3), held there a moment, then swung down
 * through the line to the poster (it lands at `SWAT_HIT`), pressed there, flicked back (the recoil) and put down.
 */
export interface SwatPose {
  turn: number;
  reach: number;
  lean: number;
}

/** Where the paw rests when it only points, and how far it reaches when it is raised and when it lands. */
export const SWAT_REST_REACH = 0.37;
const RAISED_REACH = 0.34;
const LANDED_REACH = 0.4;
const RAISED_TURN = -2.3;
const LANDED_TURN = 0.14;

type Key = readonly [at: number, turn: number, reach: number, lean: number, ease: "in" | "out" | "inout" | "line"];

/** The keys of a swat: from the key before to this one, eased the way it says. */
const KEYS: readonly Key[] = [
  [0, 0, SWAT_REST_REACH, 0, "line"],
  [0.12, -0.3, 0.35, -0.1, "inout"],
  [0.3, RAISED_TURN, RAISED_REACH, -0.35, "out"],
  [0.35, RAISED_TURN - 0.1, RAISED_REACH, -0.4, "inout"],
  [SWAT_HIT, LANDED_TURN, LANDED_REACH, 1, "in"],
  [0.52, LANDED_TURN, LANDED_REACH - 0.01, 1, "line"],
  [0.66, -0.9, 0.3, 0.4, "out"],
  [0.84, -0.2, 0.35, 0.15, "inout"],
  [1, 0, SWAT_REST_REACH, 0, "inout"],
];

const shape = (t: number, ease: Key[4]): number => {
  const u = clamp01(t);
  switch (ease) {
    case "in":
      return u * u * u;
    case "out":
      return 1 - (1 - u) ** 3;
    case "inout":
      return u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
    default:
      return u;
  }
};

/** The paw at `progress` (0..1) of a swat. */
export function swatPose(progress: number): SwatPose {
  const q = clamp01(progress);
  for (let i = 1; i < KEYS.length; i++) {
    const to = KEYS[i]!;
    if (q > to[0] && i < KEYS.length - 1) continue;
    const from = KEYS[i - 1]!;
    const u = shape((q - from[0]) / (to[0] - from[0]), to[4]);
    return { turn: lerp(from[1], to[1], u), reach: lerp(from[2], to[2], u), lean: lerp(from[3], to[3], u) };
  }
  return { turn: 0, reach: SWAT_REST_REACH, lean: 0 };
}
