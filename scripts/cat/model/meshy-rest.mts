// The skeleton of the free cat model, in the rig's frame: where the body's five stations, the head, the legs, the ears and the tail's ten pieces are in the posture the model
// was made in. Measured on the model (scripts/cat/glb/meshy-*.mts) and drawn over it to check (meshy-check.mts). Positions are x forward, y up (the feet on the floor), z toward the viewer.
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
export type MeshyRest = ModelRest;

/** The tail: a plume that leaves the top of the rump, goes up and then bends back, drawn by eye over the model and cut into ten equal pieces. */
const TAIL_BY_EYE: readonly Pt[] = [
  [-0.5, 0.49],
  [-0.568, 0.505],
  [-0.688, 0.573],
  [-0.768, 0.69],
  [-0.844, 0.806],
  [-0.93, 0.862],
  [-1.03, 0.88],
  [-1.12, 0.885],
];

/** A polyline cut into `n` equal pieces: n + 1 points. */
export function resample(line: readonly Pt[], n: number): Pt[] {
  const len = [0];
  for (let i = 1; i < line.length; i++) len.push(len[i - 1]! + Math.hypot(line[i]![0] - line[i - 1]![0], line[i]![1] - line[i - 1]![1]));
  const total = len[len.length - 1]!;
  const out: Pt[] = [];
  for (let k = 0; k <= n; k++) {
    const at = (total * k) / n;
    let i = 1;
    while (i < line.length - 1 && len[i]! < at) i++;
    const t = (at - len[i - 1]!) / (len[i]! - len[i - 1]! || 1);
    out.push([line[i - 1]![0] + (line[i]![0] - line[i - 1]![0]) * t, line[i - 1]![1] + (line[i]![1] - line[i - 1]![1]) * t]);
  }
  return out;
}

const r4 = (v: number): number => Math.round(v * 1e4) / 1e4;
const p2 = (p: Pt): Pt => [r4(p[0]), r4(p[1])];

/** The numbers as they are written to the app (four places), so that what the build stamps is what the app computes. */
export function rounded(rest: ModelRest): ModelRest {
  const leg = (l: ModelRest["legs"]["fn"]): ModelRest["legs"]["fn"] => ({ root: p2(l.root), mid: p2(l.mid), hock: p2(l.hock), toe: p2(l.toe), z: r4(l.z) });
  const p3 = (p: readonly [number, number, number]): readonly [number, number, number] => [r4(p[0]), r4(p[1]), r4(p[2])];
  return {
    stations: rest.stations.map((s) => ({ top: p2(s.top), bottom: p2(s.bottom) })),
    head: p2(rest.head),
    legs: { fn: leg(rest.legs.fn), ff: leg(rest.legs.ff), hn: leg(rest.legs.hn), hf: leg(rest.legs.hf) },
    tail: rest.tail.map(p2),
    ears: [
      { base: p3(rest.ears[0].base), tip: p3(rest.ears[0].tip) },
      { base: p3(rest.ears[1].base), tip: p3(rest.ears[1].tip) },
    ],
    jawHinge: p3(rest.jawHinge),
  };
}

export const MESHY_REST: ModelRest = rounded({
  stations: [
    { top: [-0.5, 0.565], bottom: [-0.54, 0.1] },
    { top: [-0.3, 0.58], bottom: [-0.3, 0.13] },
    { top: [-0.05, 0.575], bottom: [-0.03, 0.125] },
    { top: [0.15, 0.6], bottom: [0.16, 0.2] },
    { top: [0.26, 0.63], bottom: [0.33, 0.38] },
  ],
  head: [0.331, 0.633],
  legs: {
    fn: { root: [0.268, 0.316], mid: [0.107, 0.161], hock: [0.088, 0.075], toe: [0.122, 0.007], z: 0.105 },
    ff: { root: [0.268, 0.316], mid: [0.107, 0.161], hock: [0.088, 0.075], toe: [0.122, 0.007], z: -0.105 },
    hn: { root: [-0.5, 0.4], mid: [-0.36, 0.24], hock: [-0.62, 0.174], toe: [-0.56, 0.007], z: 0.115 },
    hf: { root: [-0.5, 0.4], mid: [-0.36, 0.24], hock: [-0.62, 0.174], toe: [-0.56, 0.007], z: -0.115 },
  },
  tail: resample(TAIL_BY_EYE, 10),
  ears: [
    { base: [0.325, 0.705, -0.118], tip: [0.326, 0.777, -0.142] },
    { base: [0.325, 0.705, 0.118], tip: [0.326, 0.775, 0.143] },
  ],
  jawHinge: [0.326, 0.558, 0],
});
