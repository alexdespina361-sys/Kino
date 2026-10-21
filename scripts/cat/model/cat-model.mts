// The cat's body as shapes: an orange tabby, made of smooth ellipsoids and round cones around the joints the rig has for a standing cat.
// Everything here is drawn for Kino from the idea of a cat (no part of it comes from any other model or product).
//
// Coordinates: x forward, y up, z toward the viewer (the cat's near side). Units are body lengths, like the rig's.
import { BONE, TAIL_BONES, restSolved } from "../../../src/client/cat/render/gl/skeleton";
import type { PointKey } from "../../../src/client/cat/render/shapes";
import { ellipsoid, frameOf, roundCone, squeezed, type Prim, type Scene, type Dist, type Box } from "./sdf.mts";

/** How full each part is made, against the first model (1 is that): a real cat is plumper in the neck, the head, the legs and the tail than a clay one. */
const FAT = { torso: 1.07, neck: 1.22, head: 1.1, leg: 1.15, paw: 1.16, tail: 1.18 } as const;

export const REGION = { body: 0, head: 1, ear: 2, foreleg: 3, hindleg: 4, paw: 5, tail: 6, muzzle: 7 } as const;

type Vec3 = [number, number, number];

export interface EarFrame {
  base: Vec3;
  /** Along the ear (from its base to its tip), across it, and out of its face. */
  a: Vec3;
  b: Vec3;
  c: Vec3;
}

/** The size of an ear: how far it reaches from its base to its tip, and how wide it is at the base (the shader paints the inside of it from these). */
export const EAR = { length: 0.135, radius: 0.057, tip: 0.011 } as const;

export interface Model {
  scene: Scene;
  /** The numbers the shader and the bones are told about the model. */
  head: Vec3;
  /** The ear at z < 0, then the one at z > 0. */
  ears: [EarFrame, EarFrame];
  jawHinge: Vec3;
}

export function buildModel(): Model {
  const rest = restSolved();
  const flip = (j: { x: number; y: number }) => ({ x: j.x, y: -j.y });
  const legs = {
    fn: { root: flip(rest.legs.fn.root), mid: flip(rest.legs.fn.mid), wrist: flip(rest.legs.fn.hock), toe: flip(rest.legs.fn.toe), z: 0.07 },
    ff: { root: flip(rest.legs.ff.root), mid: flip(rest.legs.ff.mid), wrist: flip(rest.legs.ff.hock), toe: flip(rest.legs.ff.toe), z: -0.07 },
    hn: { root: flip(rest.legs.hn.root), mid: flip(rest.legs.hn.mid), hock: flip(rest.legs.hn.hock), toe: flip(rest.legs.hn.toe), z: 0.082 },
    hf: { root: flip(rest.legs.hf.root), mid: flip(rest.legs.hf.mid), hock: flip(rest.legs.hf.hock), toe: flip(rest.legs.hf.toe), z: -0.082 },
  };
  const tail = rest.tail.map(flip);
  const H: Vec3 = [rest.head.x, -rest.head.y, 0];
  const prims: Prim[] = [];
  const cuts: Scene["cuts"] = [];

  const add = (name: string, shape: { d: Dist; box: Box; t?: (x: number, y: number, z: number) => number }, o: { bone: number; k: number; tau: number; region: number; fur?: number; u0?: number; u1?: number }) => {
    const { t } = shape;
    const u0 = o.u0 ?? 0;
    const u1 = o.u1 ?? 0;
    prims.push({
      name,
      bone: o.bone,
      k: o.k,
      tau: o.tau,
      region: o.region,
      fur: o.fur ?? 1,
      d: shape.d,
      box: shape.box,
      u: t ? (x, y, z) => u0 + (u1 - u0) * t(x, y, z) : () => u0,
    });
  };
  const at = (dx: number, dy: number, dz: number): Vec3 => [H[0] + dx, H[1] + dy, H[2] + dz];

  /* ------------------------------ the body ------------------------------ */
  // The barrel is made around the lines of the back and of the belly that the rig has for a standing cat (so that a standing cat that is made taller or
  // lower in the rig is that in the mesh too): each station is an ellipsoid between the two lines, a little over or short of them as `top` and `bottom` say.
  const pt = (k: PointKey) => ({ x: rest.pose.p[k].x, y: -rest.pose.p[k].y });
  const lineOf = (keys: PointKey[]) => {
    const pts = keys.map(pt).sort((a, b) => a.x - b.x);
    return (x: number): number => {
      if (x <= pts[0]!.x) return pts[0]!.y;
      for (let i = 1; i < pts.length; i++) {
        if (x <= pts[i]!.x) {
          const a = pts[i - 1]!;
          const b = pts[i]!;
          return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
        }
      }
      return pts[pts.length - 1]!.y;
    };
  };
  const backAt = lineOf(["rumpTop", "backMid", "shoulderTop", "neckTop"]);
  const bellyAt = lineOf(["rumpBottom", "groin", "bellyMid", "chestBottom", "chestFront"]);
  // (stations of the barrel: where, how far over the back's line and the belly's, how wide, and which bone carries it)
  const station = (name: string, x: number, top: number, bottom: number, hw: number, rx: number, bone: number, fur = 1, tau = 0.07) => {
    const hi = backAt(x) + top;
    const lo = bellyAt(x) + bottom;
    add(name, ellipsoid([x, (hi + lo) / 2, 0], [rx, ((hi - lo) / 2) * FAT.torso, hw * FAT.torso]), { bone, k: 0.08, tau, region: REGION.body, fur });
  };
  station("rump", -0.395, 0, 0.003, 0.112, 0.105, BONE.f0);
  station("hips", -0.27, -0.001, 0.004, 0.118, 0.11, BONE.f1);
  station("flank", -0.1, -0.009, 0.007, 0.104, 0.12, BONE.f2);
  station("ribs", 0.07, 0.003, -0.012, 0.116, 0.135, BONE.f2);
  station("chest", 0.2, 0.007, -0.019, 0.116, 0.12, BONE.f3, 1, 0.1);
  station("prow", 0.325, -0.007, 0.001, 0.102, 0.11, BONE.f4, 1.3, 0.1);
  // the ruff at the chest, and the belly (a cat's hangs a little between the legs)
  add("ruff", ellipsoid([0.385, pt("chestBottom").y + 0.1, 0], [0.07, 0.11, 0.082]), { bone: BONE.f4, k: 0.06, tau: 0.09, region: REGION.body, fur: 1.8 });
  add("belly", ellipsoid([-0.07, pt("bellyMid").y + 0.03, 0], [0.19, 0.04, 0.085]), { bone: BONE.f2, k: 0.07, tau: 0.07, region: REGION.body, fur: 1.5 });

  /* ------------------------------ the neck and the head ------------------------------ */
  add("neck", roundCone([0.33, pt("neckTop").y - 0.09, 0], [H[0] - 0.04, H[1] - 0.07, 0], 0.098 * FAT.neck, 0.074 * FAT.neck), { bone: BONE.neck, k: 0.06, tau: 0.09, region: REGION.body, fur: 1.25 });
  const head = (name: string, c: Vec3, r: Vec3, o: { bone?: number; fur?: number; k?: number; region?: number } = {}) =>
    add(name, ellipsoid(c, r), { bone: o.bone ?? BONE.head, k: o.k ?? 0.035, tau: 0.03, region: o.region ?? REGION.head, fur: o.fur ?? 0.55 });
  head("skull", at(-0.01, 0.012, 0), [0.114 * FAT.head, 0.098 * FAT.head, 0.112 * FAT.head]);
  head("muzzle", at(0.1, -0.036, 0), [0.062, 0.046, 0.05], { region: REGION.muzzle, fur: 0.3 });
  head("chin", at(0.084, -0.076, 0), [0.042, 0.028, 0.036], { bone: BONE.jaw, region: REGION.muzzle, fur: 0.45 });
  for (const s of [1, -1]) {
    // the cheeks, which make a cat's face wider below the eyes than above them, and the puffs of the whisker pads on the muzzle
    head(`cheek${s}`, at(0.028, -0.046, s * 0.072), [0.062 * FAT.head, 0.05 * FAT.head, 0.046 * FAT.head], { fur: 1.5 });
    head(`pad${s}`, at(0.108, -0.049, s * 0.031), [0.042, 0.027, 0.03], { region: REGION.muzzle, fur: 0.3, k: 0.03 });
    // the brow over each eye
    head(`brow${s}`, at(0.066, 0.049, s * 0.052), [0.04, 0.014, 0.032], { k: 0.025, fur: 0.5 });
  }
  add("bridge", roundCone(at(0.04, 0.064, 0), at(0.14, -0.006, 0), 0.036, 0.027), { bone: BONE.head, k: 0.03, tau: 0.03, region: REGION.muzzle, fur: 0.45 });
  head("nose", at(0.15, -0.012, 0), [0.02, 0.016, 0.024], { region: REGION.muzzle, fur: 0.3 });

  // ears: a cone squeezed thin, leaned back and out, with a hollow on the front
  const ear = (side: 1 | -1, bone: number) => {
    const base = at(-0.026, 0.08, side * 0.082);
    const axis: Vec3 = [-0.12, 1, side * 0.5];
    const [a, b, c] = frameOf(axis, [1, 0, 0]);
    const cone = roundCone([0, 0, 0], [EAR.length, 0, 0], EAR.radius, EAR.tip);
    const shape = squeezed(cone, base, [a, b, c], [1, 1, 1.7]);
    add(`ear${side}`, shape, { bone, k: 0.03, tau: 0.025, region: REGION.ear, fur: 0.6 });
    const hollowCone = ellipsoid([EAR.length * 0.48, 0, 0.01], [EAR.length * 0.44, EAR.radius * 0.62, 0.02]);
    const hollow = squeezed(hollowCone, [base[0] + c[0] * 0.016, base[1] + c[1] * 0.016, base[2] + c[2] * 0.016], [a, b, c], [1, 1, 1]);
    cuts.push({ d: hollow.d, box: [base[0] - 0.12, base[1] - 0.04, base[2] - 0.12, base[0] + 0.12, base[1] + 0.2, base[2] + 0.12], k: 0.012 });
    return { base, a, b, c };
  };
  const earL = ear(-1, BONE.earL);
  const earR = ear(1, BONE.earR);

  /* ------------------------------ the legs ------------------------------ */
  const front = (key: "fn" | "ff", bones: [number, number, number]) => {
    const L = legs[key];
    const z = L.z;
    const p = (j: { x: number; y: number }, dz = 0): Vec3 => [j.x, j.y, z + dz];
    add(`${key}-scapula`, ellipsoid([L.root.x - 0.005, L.root.y + 0.065, z * 1.18], [0.088, 0.118, 0.05], { axis: [0.25, 1, 0] }), { bone: bones[0], k: 0.05, tau: 0.05, region: REGION.foreleg, fur: 1 });
    add(`${key}-upper`, roundCone(p(L.root), p(L.mid), 0.07 * FAT.leg, 0.05 * FAT.leg), { bone: bones[0], k: 0.05, tau: 0.04, region: REGION.foreleg, fur: 0.9, u0: 0, u1: 0.4 });
    add(`${key}-lower`, roundCone(p(L.mid), p(L.wrist), 0.048 * FAT.leg, 0.032 * FAT.leg), { bone: bones[1], k: 0.04, tau: 0.035, region: REGION.foreleg, fur: 0.7, u0: 0.4, u1: 0.85 });
    add(`${key}-paw`, ellipsoid([L.toe.x + 0.027, 0.023, z], [0.058 * FAT.paw, 0.024 * FAT.paw, 0.034 * FAT.paw]), { bone: bones[2], k: 0.03, tau: 0.03, region: REGION.paw, fur: 0.4, u0: 1 });
  };
  front("fn", [BONE.fnU, BONE.fnL, BONE.fnP]);
  front("ff", [BONE.ffU, BONE.ffL, BONE.ffP]);

  const hind = (key: "hn" | "hf", bones: [number, number, number]) => {
    const L = legs[key];
    const z = L.z;
    const p = (j: { x: number; y: number }, dz = 0): Vec3 => [j.x, j.y, z + dz];
    add(`${key}-haunch`, ellipsoid([L.root.x + 0.015, L.root.y - 0.015, z * 1.06], [0.13, 0.15, 0.066], { axis: [0.35, 1, 0] }), { bone: BONE.f1, k: 0.06, tau: 0.085, region: REGION.hindleg, fur: 1.25 });
    add(`${key}-thigh`, roundCone(p(L.root), p(L.mid), 0.105 * FAT.leg, 0.054 * FAT.leg), { bone: bones[0], k: 0.05, tau: 0.06, region: REGION.hindleg, fur: 1.2, u0: 0, u1: 0.3 });
    add(`${key}-shin`, roundCone(p(L.mid), p(L.hock), 0.056 * FAT.leg, 0.039 * FAT.leg), { bone: bones[1], k: 0.04, tau: 0.035, region: REGION.hindleg, fur: 0.8, u0: 0.3, u1: 0.6 });
    add(`${key}-foot`, roundCone(p(L.hock), p({ x: L.toe.x - 0.005, y: L.toe.y + 0.032 }), 0.038 * FAT.leg, 0.031 * FAT.leg), { bone: bones[2], k: 0.035, tau: 0.03, region: REGION.hindleg, fur: 0.5, u0: 0.6, u1: 0.9 });
    add(`${key}-paw`, ellipsoid([L.toe.x + 0.029, 0.023, z], [0.06 * FAT.paw, 0.024 * FAT.paw, 0.034 * FAT.paw]), { bone: bones[2], k: 0.03, tau: 0.03, region: REGION.paw, fur: 0.4, u0: 1 });
  };
  hind("hn", [BONE.hnU, BONE.hnL, BONE.hnP]);
  hind("hf", [BONE.hfU, BONE.hfL, BONE.hfP]);

  /* ------------------------------ the tail ------------------------------ */
  for (let i = 0; i < TAIL_BONES; i++) {
    const a = tail[i]!;
    const b = tail[i + 1]!;
    const f0 = i / TAIL_BONES;
    const f1 = (i + 1) / TAIL_BONES;
    const r = (f: number) => (0.046 - 0.007 * f - 0.003 * f * f) * FAT.tail;
    add(`tail${i}`, roundCone([a.x, a.y, 0], [b.x, b.y, 0], r(f0), r(f1)), { bone: BONE.tail0 + i, k: i === 0 ? 0.06 : 0, tau: 0.035, region: REGION.tail, fur: 1.4, u0: f0, u1: f1 });
  }

  return { scene: { prims, cuts }, head: H, ears: [earL, earR], jawHinge: at(-0.01, -0.06, 0) };
}
