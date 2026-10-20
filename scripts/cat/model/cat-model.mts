// The cat's body as shapes: an orange tabby, made of smooth ellipsoids and round cones around the joints the rig has for a standing cat.
// Everything here is drawn for Kino from the idea of a cat (no part of it comes from any other model or product).
//
// Coordinates: x forward, y up, z toward the viewer (the cat's near side). Units are body lengths, like the rig's.
import { BONE, TAIL_BONES, restSolved } from "../../../src/client/cat/render/gl/skeleton";
import { ellipsoid, frameOf, roundCone, squeezed, type Prim, type Scene, type Dist, type Box } from "./sdf.mts";

export const REGION = { body: 0, head: 1, ear: 2, foreleg: 3, hindleg: 4, paw: 5, tail: 6, muzzle: 7 } as const;

type Vec3 = [number, number, number];

export interface EarFrame {
  base: Vec3;
  /** Along the ear (from its base to its tip), across it, and out of its face. */
  a: Vec3;
  b: Vec3;
  c: Vec3;
}

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
  // (stations of the barrel: where, how high and wide, and which bone carries it)
  const station = (name: string, x: number, y: number, hh: number, hw: number, rx: number, bone: number, fur = 1) =>
    add(name, ellipsoid([x, y, 0], [rx, hh, hw]), { bone, k: 0.075, tau: 0.07, region: REGION.body, fur });
  station("rump", -0.4, 0.472, 0.106, 0.102, 0.1, BONE.f0);
  station("hips", -0.28, 0.462, 0.124, 0.113, 0.11, BONE.f1);
  station("flank", -0.1, 0.46, 0.136, 0.104, 0.13, BONE.f2);
  station("ribs", 0.06, 0.463, 0.142, 0.113, 0.13, BONE.f2);
  station("chest", 0.2, 0.468, 0.14, 0.118, 0.12, BONE.f3);
  station("prow", 0.325, 0.485, 0.142, 0.106, 0.112, BONE.f4, 1.3);
  // the ruff at the chest
  add("ruff", ellipsoid([0.395, 0.45, 0], [0.065, 0.105, 0.085]), { bone: BONE.f4, k: 0.06, tau: 0.06, region: REGION.body, fur: 1.7 });
  // the belly hangs a little
  add("belly", ellipsoid([-0.06, 0.345, 0], [0.2, 0.05, 0.085]), { bone: BONE.f2, k: 0.07, tau: 0.07, region: REGION.body, fur: 1.3 });

  /* ------------------------------ the neck and the head ------------------------------ */
  add("neck", roundCone([0.335, 0.55, 0], [H[0] - 0.045, H[1] - 0.075, 0], 0.1, 0.085), { bone: BONE.neck, k: 0.06, tau: 0.05, region: REGION.body, fur: 1.2 });
  const head = (name: string, c: Vec3, r: Vec3, o: { bone?: number; fur?: number; k?: number; region?: number } = {}) =>
    add(name, ellipsoid(c, r), { bone: o.bone ?? BONE.head, k: o.k ?? 0.035, tau: 0.03, region: o.region ?? REGION.head, fur: o.fur ?? 0.55 });
  head("skull", at(-0.012, 0.012, 0), [0.122, 0.106, 0.108]);
  head("muzzle", at(0.1, -0.034, 0), [0.072, 0.049, 0.057], { region: REGION.muzzle, fur: 0.3 });
  head("pads", at(0.105, -0.047, 0), [0.04, 0.026, 0.062], { region: REGION.muzzle, fur: 0.3, k: 0.03 });
  head("chin", at(0.086, -0.074, 0), [0.044, 0.03, 0.038], { bone: BONE.jaw, region: REGION.muzzle, fur: 0.45 });
  for (const s of [1, -1]) {
    head(`cheek${s}`, at(0.028, -0.05, s * 0.07), [0.06, 0.044, 0.032], { fur: 1.4 });
  }
  add("bridge", roundCone(at(0.05, 0.066, 0), at(0.152, -0.006, 0), 0.034, 0.027), { bone: BONE.head, k: 0.03, tau: 0.03, region: REGION.muzzle, fur: 0.45 });
  head("nose", at(0.152, -0.011, 0), [0.022, 0.018, 0.026], { region: REGION.muzzle, fur: 0.3 });

  // ears: a cone squeezed thin, leaned back and out, with a hollow on the front
  const ear = (side: 1 | -1, bone: number) => {
    const base = at(-0.022, 0.082, side * 0.07);
    const axis: Vec3 = [-0.1, 1, side * 0.42];
    const [a, b, c] = frameOf(axis, [1, 0, 0]);
    const cone = roundCone([0, 0, 0], [0.155, 0, 0], 0.054, 0.011);
    const shape = squeezed(cone, base, [a, b, c], [1, 1, 1.7]);
    add(`ear${side}`, shape, { bone, k: 0.03, tau: 0.025, region: REGION.ear, fur: 0.6 });
    const hollowCone = ellipsoid([0.075, 0, 0.01], [0.068, 0.034, 0.02]);
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
    add(`${key}-scapula`, ellipsoid([L.root.x - 0.005, L.root.y + 0.065, z * 1.18], [0.085, 0.115, 0.05], { axis: [0.25, 1, 0] }), { bone: bones[0], k: 0.05, tau: 0.05, region: REGION.foreleg, fur: 1 });
    add(`${key}-upper`, roundCone(p(L.root), p(L.mid), 0.066, 0.046), { bone: bones[0], k: 0.05, tau: 0.04, region: REGION.foreleg, fur: 0.9, u0: 0, u1: 0.4 });
    add(`${key}-lower`, roundCone(p(L.mid), p(L.wrist), 0.046, 0.031), { bone: bones[1], k: 0.04, tau: 0.035, region: REGION.foreleg, fur: 0.7, u0: 0.4, u1: 0.85 });
    add(`${key}-paw`, ellipsoid([L.toe.x + 0.028, 0.024, z], [0.062, 0.025, 0.036]), { bone: bones[2], k: 0.03, tau: 0.03, region: REGION.paw, fur: 0.4, u0: 1 });
  };
  front("fn", [BONE.fnU, BONE.fnL, BONE.fnP]);
  front("ff", [BONE.ffU, BONE.ffL, BONE.ffP]);

  const hind = (key: "hn" | "hf", bones: [number, number, number]) => {
    const L = legs[key];
    const z = L.z;
    const p = (j: { x: number; y: number }, dz = 0): Vec3 => [j.x, j.y, z + dz];
    add(`${key}-haunch`, ellipsoid([L.root.x - 0.01, L.root.y + 0.02, z * 1.04], [0.115, 0.135, 0.058], { axis: [0.35, 1, 0] }), { bone: bones[0], k: 0.06, tau: 0.05, region: REGION.hindleg, fur: 1.25 });
    add(`${key}-thigh`, roundCone(p(L.root), p(L.mid), 0.094, 0.054), { bone: bones[0], k: 0.05, tau: 0.04, region: REGION.hindleg, fur: 1.2, u0: 0, u1: 0.3 });
    add(`${key}-shin`, roundCone(p(L.mid), p(L.hock), 0.054, 0.037), { bone: bones[1], k: 0.04, tau: 0.035, region: REGION.hindleg, fur: 0.8, u0: 0.3, u1: 0.6 });
    add(`${key}-foot`, roundCone(p(L.hock), p({ x: L.toe.x - 0.005, y: L.toe.y + 0.032 }), 0.037, 0.03), { bone: bones[2], k: 0.035, tau: 0.03, region: REGION.hindleg, fur: 0.5, u0: 0.6, u1: 0.9 });
    add(`${key}-paw`, ellipsoid([L.toe.x + 0.03, 0.024, z], [0.064, 0.025, 0.036]), { bone: bones[2], k: 0.03, tau: 0.03, region: REGION.paw, fur: 0.4, u0: 1 });
  };
  hind("hn", [BONE.hnU, BONE.hnL, BONE.hnP]);
  hind("hf", [BONE.hfU, BONE.hfL, BONE.hfP]);

  /* ------------------------------ the tail ------------------------------ */
  for (let i = 0; i < TAIL_BONES; i++) {
    const a = tail[i]!;
    const b = tail[i + 1]!;
    const f0 = i / TAIL_BONES;
    const f1 = (i + 1) / TAIL_BONES;
    const r = (f: number) => 0.047 - 0.006 * f - 0.004 * f * f;
    add(`tail${i}`, roundCone([a.x, a.y, 0], [b.x, b.y, 0], r(f0), r(f1)), { bone: BONE.tail0 + i, k: i === 0 ? 0.06 : 0.02, tau: 0.035, region: REGION.tail, fur: 1.35, u0: f0, u1: f1 });
  }

  return { scene: { prims, cuts }, head: H, ears: [earL, earR], jawHinge: at(-0.01, -0.06, 0) };
}




