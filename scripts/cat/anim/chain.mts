// Which of a donor's bones the bones of the cat's back and neck follow, found from where each lies along the animal rather than written bone by bone.
//
// The cat has a bone every third of the way from its hips to its chest and from its chest to its head (the hips, two of the spine, the chest, two of the neck, the head); a donor has as
// many bones in its back as its maker gave it (a fox of the Khronos samples has three between the hips and the head, one of Mesh2Motion five). A bone's turn is what its stretch of the
// back does, so the turns of a donor's bones are the turns of its stretches, each at the middle of its own; the turn of a stretch of the cat's is that of the donor at the same place of
// the back, between two of the donor's (a share of each, by a slerp, as retarget.mts has it).
//
// "The same place" is told between the anchors, bones the two animals have in common whose places along the back are known to match (the hips, the one the front legs hang from, the
// head): a place between two anchors of the cat is the place as far along between the donor's.
import { Pose, globals, type Skeleton } from "../../../src/client/cat/render/gl/pose";
import type { Donor } from "./donor.mts";
import { donorBoneOf, type Link } from "./retarget.mts";

export interface Anchor {
  cat: string;
  donor: string;
}

/** How far along a line through the points each is, from 0 at the first to 1 at the last (by the length of the line). */
const along = (at: ReadonlyArray<readonly [number, number, number]>): number[] => {
  const d = [0];
  for (let i = 1; i < at.length; i++) d.push(d[i - 1]! + Math.hypot(at[i]![0] - at[i - 1]![0], at[i]![1] - at[i - 1]![1], at[i]![2] - at[i - 1]![2]));
  const total = d[d.length - 1]! || 1;
  return d.map((x) => x / total);
};

/**
 * The links of the bones of `catChain` (the hips first and the head last, each hung from the one before) to the bones of `donorChain` (the same). Every anchor follows its own;
 * a bone between two follows the donor's turn at the middle of its stretch.
 */
export function chainLinks(donor: Donor, cat: Skeleton, donorChain: readonly string[], catChain: readonly string[], anchors: readonly Anchor[]): Link[] {
  const rest = donor.at(null, 0);
  const R = new Float64Array(cat.count * 9);
  const T = new Float64Array(cat.count * 3);
  globals(cat, new Pose(cat), undefined, R, T);
  const donorAt = donorChain.map((n): [number, number, number] => {
    const i = donorBoneOf(donor, n);
    return [rest.P[i * 3]!, rest.P[i * 3 + 1]!, rest.P[i * 3 + 2]!];
  });
  const catAt = catChain.map((n): [number, number, number] => {
    const i = cat.bone(n);
    return [T[i * 3]!, T[i * 3 + 1]!, T[i * 3 + 2]!];
  });
  const g = along(donorAt);
  const f = along(catAt);
  const pairs = anchors.map((a) => {
    const c = catChain.indexOf(a.cat);
    const d = donorChain.indexOf(a.donor);
    if (c < 0 || d < 0) throw new Error(`the anchor ${a.cat} / ${a.donor} is not in the chains`);
    return { cat: f[c]!, donor: g[d]! };
  });
  if (catChain.indexOf(anchors[0]!.cat) !== 0 || catChain.indexOf(anchors[anchors.length - 1]!.cat) !== catChain.length - 1) throw new Error("the first and the last anchor are the ends of the chain");
  /** The place of the donor that a place of the cat's matches. */
  const matching = (place: number): number => {
    for (let k = 0; k + 1 < pairs.length; k++) {
      const a = pairs[k]!;
      const b = pairs[k + 1]!;
      if (place <= b.cat) return a.donor + ((place - a.cat) / (b.cat - a.cat || 1)) * (b.donor - a.donor);
    }
    return pairs[pairs.length - 1]!.donor;
  };
  // the middle of each stretch of the donor's (the last bone, the head's, has none: its turn is the head's alone)
  const middles = donorChain.slice(0, -1).map((_, j) => (g[j]! + g[j + 1]!) / 2);
  const anchored = new Map(anchors.map((a) => [a.cat, a.donor]));
  return catChain.map((bone, i): Link => {
    const own = anchored.get(bone);
    if (own !== undefined) return { bone, follows: own };
    const where = matching((f[i]! + f[i + 1]!) / 2);
    if (where <= middles[0]!) return { bone, follows: donorChain[0]! };
    const last = middles.length - 1;
    if (where >= middles[last]!) return { bone, follows: donorChain[last]! };
    let j = 0;
    while (middles[j + 1]! < where) j++;
    const at = (where - middles[j]!) / (middles[j + 1]! - middles[j]!);
    if (at < 0.02) return { bone, follows: donorChain[j]! };
    if (at > 0.98) return { bone, follows: donorChain[j + 1]! };
    return { bone, follows: { from: donorChain[j]!, to: donorChain[j + 1]!, at } };
  });
}
