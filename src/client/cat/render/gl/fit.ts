import { clamp, twoBone } from "../../math";
import type { CatFrame } from "../../types";
import { CatRig, type Joint, type Leg, type Solved } from "../rig";
import { MODEL } from "./model";
import type { ModelRest, Pt } from "./rest";
import { STATION_MIX } from "./skeleton";

/**
 * Fits the rig's poses to the cat of the mesh. The rig works out a pose for a cat of its own proportions (a longer leg, a thinner belly, a smaller head, a
 * tail that goes straight up); the mesh is another cat, and this is what carries one to the other: the rig's pose, as a change from the rig's own rest, is
 * put on the mesh's rest.
 *
 *  - Points of the body and the head keep the way they moved along the cat, and (so that a cat that lies down lies on the floor whatever its belly is) move
 *    in height by the same share of the way to the floor that they did.
 *  - A leg is solved again for the mesh's own bones: the root and the toe go where the rig has them (a foot that is on the ground stays where it is), and the
 *    elbow or knee falls where the mesh's own lengths put it, on the side the rig has it.
 *  - The tail keeps the mesh's own curve, bent by as much as the rig bends its own at each joint, and as long as the rig makes each piece.
 *
 * The rig's numbers are in a view where up is negative (y is down, the floor is 0); so are these.
 */

type LegKey = "fn" | "ff" | "hn" | "hf";
const LEGS: readonly LegKey[] = ["fn", "ff", "hn", "hf"];
/** How high above the floor a knee or an elbow is kept (the legs are thick, and a knee on the floor is a knee in it). */
const KNEE_FLOOR = 0.045;
/** The points of the rig's pose that the body's stations are made of (skeleton.ts). */
const BODY = ["rumpTop", "rumpBottom", "backMid", "groin", "bellyMid", "shoulderTop", "chestBottom", "neckTop", "chestFront"] as const;

const joint = (x = 0, y = 0): Joint => ({ x, y });
const copyJoint = (j: Joint): Joint => ({ x: j.x, y: j.y });
const copyLeg = (l: Leg): Leg => ({ root: copyJoint(l.root), mid: copyJoint(l.mid), hock: copyJoint(l.hock), toe: copyJoint(l.toe), front: l.front, lift: l.lift });

/** The cat of the rig at rest, standing: the posture that the rig's numbers are measured against. */
export function rigRest(): Solved {
  const rig = new CatRig(1);
  const frame: CatFrame = { x: 0, y: 0, facing: 1, clip: "stand", clipTime: 0, progress: 0, odometer: 0, vx: 0, vy: 0, grounded: true, viewer: false, drowsy: 0, energy: 0.3, appear: 1, petted: false, carried: false };
  rig.snapTo(frame, 100);
  const s = rig.solved;
  return {
    ...s,
    legs: { fn: copyLeg(s.legs.fn), ff: copyLeg(s.legs.ff), hn: copyLeg(s.legs.hn), hf: copyLeg(s.legs.hf) },
    tail: s.tail.map(copyJoint),
    head: { ...s.head },
    pose: { p: Object.fromEntries(Object.entries(s.pose.p).map(([k, v]) => [k, copyJoint(v)])) as Solved["pose"]["p"], s: { ...s.pose.s } },
  };
}

/** A point of the model, as the rig's numbers have it (y down). */
const down = (p: Pt): Joint => ({ x: p[0], y: -p[1] });

/** The model's rest as a Solved (the body's points, the legs and the tail are the model's; what the rig has beyond those, the face and the rest, is the rig's own). */
export function modelRest(model: ModelRest = MODEL, rig: Solved = rigRest()): Solved {
  const s = { ...rig, legs: { fn: copyLeg(rig.legs.fn), ff: copyLeg(rig.legs.ff), hn: copyLeg(rig.legs.hn), hf: copyLeg(rig.legs.hf) }, head: { ...rig.head }, pose: { p: Object.fromEntries(Object.entries(rig.pose.p).map(([k, v]) => [k, copyJoint(v)])) as Solved["pose"]["p"], s: { ...rig.pose.s } } } as Solved;
  const [st0, st1, st2, st3, st4] = model.stations as [ModelRest["stations"][number], ...ModelRest["stations"]];
  const p = s.pose.p;
  p.rumpTop = down(st0.top);
  p.rumpBottom = down(st0.bottom);
  p.groin = down(st1.bottom);
  p.backMid = down(st2.top);
  p.bellyMid = down(st2.bottom);
  p.shoulderTop = down(st3.top);
  // (the rig's fourth station's belly is a mix of two of its points: the one that is not there is chosen so that the mix lands where the model's is)
  const mix = STATION_MIX.belly;
  p.chestBottom = { x: p.bellyMid.x + (st3.bottom[0] - p.bellyMid.x) / mix, y: p.bellyMid.y + (-st3.bottom[1] - p.bellyMid.y) / mix };
  p.neckTop = down(st4.top);
  p.chestFront = down(st4.bottom);
  s.head.x = model.head[0];
  s.head.y = -model.head[1];
  for (const key of LEGS) {
    const m = model.legs[key];
    const leg = s.legs[key];
    leg.root = down(m.root);
    leg.mid = down(m.mid);
    leg.hock = down(m.hock);
    leg.toe = down(m.toe);
  }
  s.tail = model.tail.map(down);
  return s;
}

interface LegFit {
  /** The side the knee or the elbow bends to at rest (1 or -1, as twoBone takes it), for the rig and for the model. */
  rigBend: 1 | -1;
  bend: 1 | -1;
  rigUpper: number;
  rigLower: number;
  upper: number;
  lower: number;
  /** The foot (the way from the hock to the toe) at rest, for the rig and for the model. */
  rigFoot: Joint;
  foot: Joint;
  /** How much of the height of the rig's root the model's is. */
  height: number;
}

const length = (a: Joint, b: Joint): number => Math.hypot(b.x - a.x, b.y - a.y);

/** The side a chain root-mid-end bends to (the side of the line from the root to the end where the middle joint is), as twoBone takes it. */
function bendOf(root: Joint, mid: Joint, end: Joint): 1 | -1 {
  // twoBone's joint is at (root + a u) + h * (-uy, ux) * bend, so bend is the sign of the middle joint's side of the line
  const ux = end.x - root.x;
  const uy = end.y - root.y;
  const side = -uy * (mid.x - root.x) + ux * (mid.y - root.y);
  return side >= 0 ? 1 : -1;
}

export class PoseFit {
  readonly rig: Solved;
  readonly rest: Solved;
  private readonly out: Solved;
  private readonly body: Record<(typeof BODY)[number], number> = {} as Record<(typeof BODY)[number], number>;
  private readonly headHeight: number;
  private readonly tailHeight: number;
  private readonly legs = {} as Record<LegKey, LegFit>;
  /** How thick the tail is at each joint (so that a tail that lies on the floor lies on it and not in it). */
  private readonly tailRadius: number[];

  constructor(model: ModelRest = MODEL, rig: Solved = rigRest()) {
    this.rig = rig;
    this.rest = modelRest(model, rig);
    for (const k of BODY) this.body[k] = this.rest.pose.p[k].y / rig.pose.p[k].y;
    this.headHeight = this.rest.head.y / rig.head.y;
    this.tailHeight = this.rest.tail[0]!.y / rig.tail[0]!.y;
    for (const key of LEGS) {
      const r = rig.legs[key];
      const m = this.rest.legs[key];
      this.legs[key] = {
        rigBend: bendOf(r.root, r.mid, r.hock),
        bend: bendOf(m.root, m.mid, m.hock),
        rigUpper: length(r.root, r.mid),
        rigLower: length(r.mid, r.hock),
        upper: length(m.root, m.mid),
        lower: length(m.mid, m.hock),
        rigFoot: { x: r.toe.x - r.hock.x, y: r.toe.y - r.hock.y },
        foot: { x: m.toe.x - m.hock.x, y: m.toe.y - m.hock.y },
        height: m.root.y / r.root.y,
      };
    }
    // (the tail is thickest in its middle; its radius is a share of the model's: the plume is about a tenth of the body's length thick)
    this.tailRadius = this.rest.tail.map((_, i, all) => 0.05 + 0.07 * Math.sin((Math.PI * (i + 0.5)) / all.length) ** 0.7);
    this.out = {
      ...rig,
      pose: { p: Object.fromEntries(Object.entries(rig.pose.p).map(([k, v]) => [k, copyJoint(v)])) as Solved["pose"]["p"], s: rig.pose.s },
      legs: { fn: copyLeg(rig.legs.fn), ff: copyLeg(rig.legs.ff), hn: copyLeg(rig.legs.hn), hf: copyLeg(rig.legs.hf) },
      head: { ...rig.head },
      tail: rig.tail.map(copyJoint),
    };
  }

  /**
   * The pose of the mesh's cat for a pose of the rig's. What comes back is the same object every time (it is written over), made of the rig's numbers except
   * where the mesh's cat is not the rig's: the body's points, the head's place, the legs and the tail.
   */
  apply(s: Solved): Solved {
    const out = this.out;
    out.flip = s.flip;
    out.sx = s.sx;
    out.sy = s.sy;
    out.air = s.air;
    out.appear = s.appear;
    out.pitch = s.pitch;
    out.breath = s.breath;
    out.shadow = s.shadow;
    out.pose.s = s.pose.s;

    // --- the body
    for (const k of BODY) {
      const now = s.pose.p[k];
      const rest = this.rig.pose.p[k];
      const at = this.rest.pose.p[k];
      const to = out.pose.p[k];
      to.x = at.x + (now.x - rest.x);
      to.y = now.y * this.body[k];
    }

    // --- the head
    Object.assign(out.head, s.head);
    out.head.x = this.rest.head.x + (s.head.x - this.rig.head.x);
    out.head.y = s.head.y * this.headHeight;

    // --- the legs
    for (const key of LEGS) this.fitLeg(key, s.legs[key], out.legs[key]);

    // --- the tail
    this.fitTail(s.tail, out.tail);
    return out;
  }

  private fitLeg(key: LegKey, now: Leg, to: Leg): void {
    const f = this.legs[key];
    const r = this.rig.legs[key];
    const m = this.rest.legs[key];
    to.front = now.front;
    to.lift = now.lift;
    to.root.x = m.root.x + (now.root.x - r.root.x);
    to.root.y = now.root.y * f.height;
    to.toe.x = m.toe.x + (now.toe.x - r.toe.x);
    to.toe.y = now.toe.y * f.height;

    // the foot: the model's own, turned as far as the rig's has turned from its rest, and as long as the rig's is of its own (a paw that is lifted with no foot to speak of has none)
    const rigLen = Math.hypot(f.rigFoot.x, f.rigFoot.y) || 1;
    const nowX = now.toe.x - now.hock.x;
    const nowY = now.toe.y - now.hock.y;
    const share = clamp(Math.hypot(nowX, nowY) / rigLen, 0, 2);
    const turn = share < 0.3 ? 0 : Math.atan2(nowY, nowX) - Math.atan2(f.rigFoot.y, f.rigFoot.x);
    const c = Math.cos(turn);
    const sn = Math.sin(turn);
    const fx = (f.foot.x * c - f.foot.y * sn) * share;
    const fy = (f.foot.x * sn + f.foot.y * c) * share;
    const hockX = to.toe.x - fx;
    const hockY = to.toe.y - fy;

    // the knee or the elbow: where the model's own lengths put it, on the side the rig has it (a rig that is between its two sides is, too)
    const a = twoBone(to.root.x, to.root.y, hockX, hockY, f.upper, f.lower, f.bend);
    const b = twoBone(to.root.x, to.root.y, hockX, hockY, f.upper, f.lower, -f.bend as 1 | -1);
    const rigA = twoBone(now.root.x, now.root.y, now.hock.x, now.hock.y, f.rigUpper, f.rigLower, f.rigBend);
    const rigB = twoBone(now.root.x, now.root.y, now.hock.x, now.hock.y, f.rigUpper, f.rigLower, -f.rigBend as 1 | -1);
    const dx = rigB.jx - rigA.jx;
    const dy = rigB.jy - rigA.jy;
    const span = dx * dx + dy * dy;
    const t = span > 1e-8 ? clamp(((now.mid.x - rigA.jx) * dx + (now.mid.y - rigA.jy) * dy) / span, 0, 1) : 0;
    to.mid.x = a.jx + (b.jx - a.jx) * t;
    // (a knee that the lengths of a folded leg would put through the floor stays above it)
    to.mid.y = Math.min(a.jy + (b.jy - a.jy) * t, -KNEE_FLOOR);
    to.hock.x = a.ex + (b.ex - a.ex) * t;
    to.hock.y = a.ey + (b.ey - a.ey) * t;
  }

  private fitTail(now: readonly Joint[], to: Joint[]): void {
    const r = this.rig.tail;
    const m = this.rest.tail;
    to[0]!.x = m[0]!.x + (now[0]!.x - r[0]!.x);
    to[0]!.y = now[0]!.y * this.tailHeight;
    for (let i = 0; i + 1 < m.length; i++) {
      const rx = r[i + 1]!.x - r[i]!.x;
      const ry = r[i + 1]!.y - r[i]!.y;
      const cx = now[i + 1]!.x - now[i]!.x;
      const cy = now[i + 1]!.y - now[i]!.y;
      const mx = m[i + 1]!.x - m[i]!.x;
      const my = m[i + 1]!.y - m[i]!.y;
      const stretch = clamp(Math.hypot(cx, cy) / (Math.hypot(rx, ry) || 1), 0.3, 2.5);
      const turn = Math.atan2(cy, cx) - Math.atan2(ry, rx);
      const c = Math.cos(turn);
      const s = Math.sin(turn);
      to[i + 1]!.x = to[i]!.x + (mx * c - my * s) * stretch;
      to[i + 1]!.y = to[i]!.y + (mx * s + my * c) * stretch;
    }
    // (a thick tail lies on the floor, not in it)
    for (let i = 0; i < to.length; i++) to[i]!.y = Math.min(to[i]!.y, -this.tailRadius[i]!);
  }
}
