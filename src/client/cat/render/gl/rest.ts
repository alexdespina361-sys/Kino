import { stamp } from "./format";

/**
 * The posture the cat's mesh was made in, as numbers: where the body's five stations, the head, the legs, the tail's ten pieces and the ears are. The mesh is
 * worn on bones that are made round these (skeleton.ts), and the rig's poses are fitted to them (fit.ts). Positions are in body lengths, x forward and y up
 * (the feet on the floor), as the mesh is; z is toward the viewer. model.ts is written by scripts/cat/model/build-meshy.mts from the numbers it measured.
 */

export type Pt = readonly [number, number];
export type Pt3 = readonly [number, number, number];

export interface ModelLeg {
  root: Pt;
  mid: Pt;
  hock: Pt;
  toe: Pt;
  /** How far out of the middle of the body the leg stands (toward the viewer for the near legs). */
  z: number;
}

export interface ModelRest {
  /** The back and the belly at five places along the body, from the rump to the chest. */
  stations: readonly { top: Pt; bottom: Pt }[];
  /** The centre of the head: the point it turns about. */
  head: Pt;
  legs: Record<"fn" | "ff" | "hn" | "hf", ModelLeg>;
  /** Eleven joints of the tail, from its root to its tip. */
  tail: readonly Pt[];
  /** The ears' bases and tips: the ear at z < 0 first. */
  ears: readonly [{ base: Pt3; tip: Pt3 }, { base: Pt3; tip: Pt3 }];
  jawHinge: Pt3;
}

/** A number made of the rest's numbers: a mesh carries the one it was made round, and is not worn on bones that were made round another. */
export function modelStamp(rest: ModelRest): number {
  const legs = (["fn", "ff", "hn", "hf"] as const).flatMap((k) => [...rest.legs[k].root, ...rest.legs[k].mid, ...rest.legs[k].hock, ...rest.legs[k].toe, rest.legs[k].z]);
  return stamp([
    ...rest.stations.flatMap((s) => [...s.top, ...s.bottom]),
    ...rest.head,
    ...legs,
    ...rest.tail.flatMap((p) => [...p]),
    ...rest.ears.flatMap((e) => [...e.base, ...e.tip]),
    ...rest.jawHinge,
  ]);
}
