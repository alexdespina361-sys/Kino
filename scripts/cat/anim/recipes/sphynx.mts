// The Sphynx cat of Sketchfab (animalanimator.com, "Sphynx Cat by animalanimator.com", CC BY; tagged "Generated with AI" by its page): a hand-keyed cat with 107 joints (a scapula, an upper
// arm, a forearm, a hand and five digits in each foreleg: a real elbow; a thigh, a shin, a foot and four digits in each hind leg; nine bones of tail) and twelve animations at thirty frames a
// second, every joint keyed. The cat's bones are made to do what its bones do (retarget.mts, feet.mts); nothing of its model is used.
//
// What differs from the cat this is put on (the Meshy cat), and what the recipe does about it:
//  - The Sphynx's trunk (hips to chest) is 0.25 of the model's units and the Meshy cat's is 0.54 in the same ones (the legs are about as long in both: 0.37 to 0.40 from the hip to the floor):
//    a posture that depends on the trunk's length (a sit, a body upright against a wall) is not laid on the cat by the turns of its bones, and is told by `sphynx-acts.mts` as constraints
//    from what the Sphynx does (the angles of its neck and head against its back, where its paw is against its mouth), and solved for this cat's body. A gait, whose trunk is level, is carried by
//    the turns and the paws' places, as the foxes' are.
//  - The Meshy cat has no elbow (the first bone of a foreleg, 0.22, is the whole upper limb: the Sphynx's upper arm is 0.11 and its forearm 0.22): the limb is folded on the four bones by where
//    the wrist and the paw are against the chest, and the elbow is a hint (`elbow` of `Leg`), not a joint.
//  - The Sphynx has a scapula, which the cat has not: the shoulder's place against the chest is what the scapula does, and the paw's place against the chest (feet.mts) has it in it.
import type { Skeleton } from "../../../../src/client/cat/render/gl/pose";
import type { ClipSource } from "../../../../src/client/cat/render/gl/clipfile";
import type { CatMesh } from "../../../../src/client/cat/render/gl/format";
import { chainLinks, type Anchor } from "../chain.mts";
import { readDonor, type Donor } from "../donor.mts";
import { placeFeet, type FeetReport, type Leg } from "../feet.mts";
import { retarget, type Link } from "../retarget.mts";
import { styled, type Style } from "../style.mts";

export const SPHYNX = "C:\\Users\\Me\\tools\\cat-workbench\\donors\\sphynx-cat.glb";

/** The Sphynx's back from the hips to the head, the tail from its root to its tip, and the cat's: the bones that are the same place of both are the anchors. */
const SPH_BACK = ["hips", "spine_01", "spine_02", "spine_03", "chest", "neck_01", "neck_02", "head"];
const CAT_BACK = ["Hips", "spine1", "spine2", "chest", "neck1", "neck2", "head"];
const SPH_TAIL = ["tail_01", "tail_02", "tail_03", "tail_04", "tail_05", "tail_06", "tail_07", "tail_08", "tail_09"];
const CAT_TAIL = ["tail", "tailstart", "tail1", "tail2", "tail3"];
const BACK_ANCHORS: Anchor[] = [
  { cat: "Hips", donor: "hips" },
  { cat: "chest", donor: "chest" },
  { cat: "head", donor: "head" },
];
const TAIL_ANCHORS: Anchor[] = [
  { cat: "tail", donor: "tail_01" },
  { cat: "tail3", donor: "tail_09" },
];

/** A leg's links (the cat's own left is the side the viewer does not see, the bones without a prefix; the Sphynx's `.L` is at +x, which the alignment turns to the same side). */
const side = (cat: string, d: "L" | "R"): Link[] => [
  { bone: `${cat}backleg`, follows: `thigh.${d}` },
  { bone: `${cat}backleg0`, follows: `shin.${d}` },
  { bone: `${cat}backleg1`, follows: `foot.${d}` },
  { bone: `${cat}backleg2`, follows: `h_digit3_01.${d}` },
  { bone: `${cat}frontleg`, follows: `upperarm.${d}` },
  { bone: `${cat}frontleg0`, follows: `forearm.${d}` },
  { bone: `${cat}frontleg1`, follows: `hand.${d}` },
  { bone: `${cat}frontleg2`, follows: `f_digit3_01.${d}` },
];

/** Which of the Sphynx's bones each of the cat's follows (the cat's jaw, ears and eyes are the face layer's: they go with the head, as they were made). */
export const sphynxLinks = (donor: Donor, cat: Skeleton): Link[] => [
  ...chainLinks(donor, cat, SPH_BACK, CAT_BACK.filter((n) => cat.has(n)), BACK_ANCHORS),
  ...chainLinks(donor, cat, SPH_TAIL, CAT_TAIL, TAIL_ANCHORS),
  ...side("", "L"),
  ...side("R_", "R"),
];

/**
 * The paws, as the cat's legs are judged by them: where the Sphynx's paw is against its carrier. The joint of the cat's paw bone is the ball of the Sphynx's foot (the first joint of its
 * digits, where the foot's long bone ends: at the floor in a stance) and the middle of the sole is the middle of its toes (the second joints). The hind legs hang from the hips, the
 * front ones from the chest (the scapula is between: the paw's place against the chest has it in it).
 */
const digits = (prefix: "f" | "h", d: "L" | "R", n: "01" | "02"): string[] => [2, 3, 4, 5].map((k) => `${prefix}_digit${k}_${n}.${d}`);
const hind = (cat: string, d: "L" | "R", pad: number): Leg => ({ chain: [`${cat}backleg`, `${cat}backleg0`, `${cat}backleg1`, `${cat}backleg2`], carrier: { cat: "Hips", donor: "hips" }, foot: `h_digit3_01.${d}`, toes: digits("h", d, "02"), pad });
const front = (cat: string, d: "L" | "R", pad: number): Leg => ({ chain: [`${cat}frontleg`, `${cat}frontleg0`, `${cat}frontleg1`, `${cat}frontleg2`], carrier: { cat: "chest", donor: "chest" }, foot: `f_digit3_01.${d}`, toes: digits("f", d, "01"), pad });
/** (the order of gait.mts's `PAWS`: hind left, hind right, front left, front right) */
export const SPHYNX_LEGS: Leg[] = [hind("", "L", 0), hind("R_", "R", 1), front("", "L", 2), front("R_", "R", 3)];

/** The Sphynx's hips are this high above its feet at rest (the model's units), and the cat's are this high (body lengths): the hips' travel is scaled by their ratio. */
export const SPHYNX_HIPS_HEIGHT = 0.455;
export const CAT_HIPS_HEIGHT = 0.475;

export interface Wanted {
  from: string;
  as: string;
  loop: boolean;
  /** A gait: the paws that are down are made to stay where they land (lock.mts). */
  lock?: boolean;
  /** What is laid on the donor's back, neck, tail and hips before the legs are placed (style.mts). */
  style?: Style;
  /** The part of the animation to take, in seconds from its start (the whole of it if left out). */
  range?: readonly [number, number];
}

/** How the Sphynx's animation `from` is sampled for a clip of `seconds` (a clip's own frame rate is the one that makes its length exact, as in the other recipes). */
export function timing(donor: Donor, w: Wanted): { animation: number; from: number; frames: number; fps: number } {
  const animation = donor.animations.findIndex((a) => a.name === w.from);
  if (animation < 0) throw new Error(`the Sphynx has no animation ${w.from} (it has ${donor.animations.map((a) => a.name).join(", ")})`);
  const [a, b] = w.range ?? [0, donor.animations[animation]!.duration];
  const duration = b - a;
  // (frames at about thirty a second that make the length exactly)
  const frames = Math.max(2, Math.round(duration * 30) + (w.loop ? 0 : 1));
  const fps = w.loop ? frames / duration : (frames - 1) / duration;
  return { animation, from: a, frames, fps };
}

/** The facing of the Sphynx (the way it is made: the nose along +z): the hips and the head tell which way is forward. */
export const SPHYNX_FACING = { back: "hips", front: "head" };

/** The clips asked for, on the cat's bones by the turns of the bones and the places of the paws (the way the foxes' are: see `fox.mts`). `report` is told how well the paws were placed. */
export function sphynxClips(path: string, cat: Skeleton, mesh: CatMesh, wanted: readonly Wanted[], report?: (clip: string, legs: FeetReport[]) => void): ClipSource[] {
  const donor = readDonor(path);
  return wanted.map((w) => {
    const { animation, from, frames, fps } = timing(donor, w);
    const plain = retarget(donor, cat, sphynxLinks(donor, cat), {
      name: w.as,
      fps,
      frames,
      loop: w.loop,
      from,
      step: 1 / fps,
      hips: { bone: "Hips", follows: "hips" },
      hipsScale: CAT_HIPS_HEIGHT / SPHYNX_HIPS_HEIGHT,
      facing: SPHYNX_FACING,
      animation,
    });
    const placed = placeFeet(donor, cat, mesh, w.style ? styled(cat, plain, w.style) : plain, SPHYNX_LEGS, { animation, from, step: 1 / fps, facing: SPHYNX_FACING, scale: CAT_HIPS_HEIGHT / SPHYNX_HIPS_HEIGHT, ...(w.lock ? { lock: true } : {}) });
    report?.(w.as, placed.report);
    return placed.source;
  });
}
