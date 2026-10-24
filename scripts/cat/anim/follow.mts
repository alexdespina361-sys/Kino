// Follow-through for a clip told as postures. `between` and the acts say where each part of the body is to be at each moment, and every part arrives together and stops together: a body
// that moves like a lift. A living one has its parts follow one another (the hips first, the back after, the neck after the back, the tail last), and each goes a little past where it is
// going and comes back (overlapping action, follow-through). Here each number of a posture that is the hips', the back's, the neck's or the tail's goes through a spring (a second order
// system that is told where to be and is not there at once), with the stiffness of its part. The paws are not touched: they are where they are put, and the legs are found for the body
// that follows.
//
// Development tooling (the cat lab): nothing in the app imports it.
import type { Spec } from "./posegen.mts";

/** How a part follows: `w` the spring's own frequency (radians a second: the bigger, the sooner it is there), `z` its damping (under 1; the lower, the more it goes past). */
export interface Spring {
  w: number;
  z: number;
}

export type Part = "hips" | "back" | "neck" | "tail";

/**
 * The hips are the stiffest (they carry the rest) and go past by about a twentieth, the back by a twelfth, the neck by an eighth and the tail, the loosest, by a sixth. A step of the
 * target is 90 % of the way there after about 0.2 s for the hips, 0.23 s for the back, 0.27 s for the neck and 0.3 s for the tail (measured: `follow-check` of the log).
 */
export const SPRINGS: Readonly<Record<Part, Spring>> = {
  hips: { w: 15, z: 0.7 },
  back: { w: 12, z: 0.62 },
  neck: { w: 9.5, z: 0.55 },
  tail: { w: 7, z: 0.5 },
};

/** Which part of the body a bone's bend (a `yaw` or `roll` of a spec) belongs to. */
function partOf(bone: string): Part {
  if (/^(spine|chest|back)/.test(bone)) return "back";
  if (/^tail/.test(bone)) return "tail";
  return "neck";
}

/**
 * How long each part is behind what it is told once the telling is a steady move (a ramp comes out of a spring 2z/w late): the hips by a tenth of a second, the tail, the loosest, by a seventh.
 * A clip is told to arrive where its windows say (the tail's lasts to the end of a lying down), and a part that is that late is not there when the clip is: the end of the clip has to pull it
 * there (late and hard, the blind judges of round 11 said of the tail of a crouch and a loaf). So each part is told what the clip will say this long ahead, and what is left of the spring is
 * what it is for: the part goes a little past and comes back.
 */
export const LEAD: Readonly<Record<Part, number>> = Object.fromEntries((Object.keys(SPRINGS) as Part[]).map((part) => [part, (2 * SPRINGS[part].z) / SPRINGS[part].w])) as Record<Part, number>;

/**
 * One spec out of the specs of a few moments: each part of the body as the clip says it will be `lead[part]` seconds ahead, and all else (the paws, the floor, the limits, the hips' turn
 * about the vertical) as it says now. `at(ahead)` is the spec that long from now; the bends `yaw` and `roll` go with the part of the bone they bend.
 */
export function ahead(at: (ahead: number) => Spec, lead: Readonly<Record<Part, number>> = LEAD): Spec {
  const now = structuredClone(at(0)) as { -readonly [K in keyof Spec]: Spec[K] };
  const soon = new Map<number, Spec>();
  const when = (part: Part): Spec => {
    const d = lead[part];
    return d === 0 ? (now as Spec) : (soon.get(d) ?? soon.set(d, structuredClone(at(d)) as Spec).get(d)!);
  };
  if (now.hips) {
    const h = now.hips as Record<string, number | undefined>;
    const to = when("hips").hips as Record<string, number | undefined> | undefined;
    if (to) for (const key of Object.keys(h)) if (key !== "spin" && to[key] !== undefined) h[key] = to[key];
  }
  for (const part of ["back", "neck", "tail"] as const) {
    const to = when(part)[part];
    if (to && now[part]) now[part] = [...to] as never;
  }
  for (const kind of ["yaw", "roll"] as const) {
    const r = now[kind] as Record<string, number> | undefined;
    if (!r) continue;
    for (const bone of Object.keys(r)) {
      const to = when(partOf(bone))[kind]?.[bone];
      if (to !== undefined) r[bone] = to;
    }
  }
  return now as Spec;
}

/** The damped spring that was at `x` going at `v` after `h` seconds of being drawn to `goal` (a standing goal: the exact solution, not a step that could be too long for a stiff spring). */
function step(x: number, v: number, goal: number, h: number, { w, z }: Spring): [number, number] {
  const a = z * w;
  const b = w * Math.sqrt(1 - z * z);
  const e0 = x - goal;
  const ex = Math.exp(-a * h);
  const c = Math.cos(b * h);
  const s = Math.sin(b * h);
  const e1 = ex * (e0 * c + ((v + a * e0) / b) * s);
  const v1 = ex * (v * c - ((a * v + w * w * e0) / b) * s);
  return [goal + e1, v1];
}

/**
 * A follower: given the spec at each frame in turn (and the time between frames), it gives the spec as the body follows it. The first spec it is given is where it begins, at rest.
 * Only the numbers of the hips (but not `spin`, the cat's turn about the vertical, which is a way of looking and not a movement), the back, the neck, the tail and the bends `yaw` and
 * `roll` are followed; the rest of the spec (the paws, the floor, the limits) is the spec's.
 */
export function follower(springs: Readonly<Record<Part, Spring>> = SPRINGS): (spec: Spec, dt: number) => Spec {
  const state = new Map<string, { x: number; v: number; was: number }>();
  const SUB = 4;
  const run = (path: string, part: Part, target: number, dt: number): number => {
    const s = state.get(path);
    if (!s) {
      state.set(path, { x: target, v: 0, was: target });
      return target;
    }
    // (the target moves a little between two frames: it is followed in a few steps, so that a spring is not drawn to where the target will be as a standing goal)
    for (let i = 1; i <= SUB; i++) [s.x, s.v] = step(s.x, s.v, s.was + ((target - s.was) * i) / SUB, dt / SUB, springs[part]);
    s.was = target;
    return s.x;
  };
  return (spec, dt) => {
    const out = structuredClone(spec) as { -readonly [K in keyof Spec]: Spec[K] };
    if (out.hips) {
      const h = out.hips as Record<string, number | undefined>;
      for (const key of Object.keys(h)) {
        const v = h[key];
        if (v === undefined || key === "spin") continue;
        h[key] = run(`hips.${key}`, "hips", v, dt);
      }
    }
    for (const part of ["back", "neck", "tail"] as const) {
      const a = out[part];
      if (a) out[part] = a.map((v, i) => run(`${part}.${i}`, part, v, dt)) as never;
    }
    for (const kind of ["yaw", "roll"] as const) {
      const r = out[kind] as Record<string, number> | undefined;
      if (!r) continue;
      for (const bone of Object.keys(r)) r[bone] = run(`${kind}.${bone}`, partOf(bone), r[bone]!, dt);
    }
    return out as Spec;
  };
}
