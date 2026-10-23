// The fox of Mesh2Motion (https://github.com/Mesh2Motion/mesh2motion-app, static/animations/fox-animations.glb): fourteen animations (idle, idle alert, walk, sneak, run, jump,
// fall, sit, bite, bark, howl, fetch, death and a rest pose) made by hand by the project's author on one quadruped skeleton, and given away as CC0 1.0 (the assets, models, rigs and
// animations; the program is MIT). The cat's bones are made to do what the fox's do (retarget.mts); nothing of the fox's model is used.
import type { Skeleton } from "../../../../src/client/cat/render/gl/pose";
import type { ClipSource } from "../../../../src/client/cat/render/gl/clipfile";
import type { CatMesh } from "../../../../src/client/cat/render/gl/format";
import { chainLinks, type Anchor } from "../chain.mts";
import { readDonor, type Donor } from "../donor.mts";
import { placeFeet, type FeetReport, type Leg } from "../feet.mts";
import { retarget, type Link } from "../retarget.mts";
import { styled, type Style } from "../style.mts";

const side = (cat: string, d: "L" | "R"): Link[] => [
  { bone: `${cat}backleg`, follows: `Back_Leg_Upper_${d}` },
  { bone: `${cat}backleg0`, follows: `Back_Leg_Lower_${d}` },
  { bone: `${cat}backleg1`, follows: `Back_Leg_Ankle_${d}` },
  { bone: `${cat}backleg2`, follows: `Back_Leg_Foot_${d}` },
  { bone: `${cat}frontleg`, follows: `Front_Leg_Upper_${d}` },
  { bone: `${cat}frontleg0`, follows: `Front_Leg_Lower_${d}` },
  { bone: `${cat}frontleg1`, follows: `Front_Leg_Ankle_${d}` },
  { bone: `${cat}frontleg2`, follows: `Front_Leg_Foot_${d}` },
];

/** The fox's back from the hips to the head, and the cat's: the bones that are the same place of both are the anchors (the chest is where the fox's front legs hang from). */
const FOX_BACK = ["Hips", "Spine_1", "Spine_2", "Spine_2.001", "Spine_3", "Spine_4", "Head"];
const CAT_BACK = ["Hips", "spine1", "spine2", "chest", "neck1", "neck2", "head"];
const FOX_ANCHORS: Anchor[] = [
  { cat: "Hips", donor: "Hips" },
  { cat: "chest", donor: "Spine_3" },
  { cat: "head", donor: "Head" },
];

/** Which of the fox's bones each of the cat's follows. The fox has five bones in its back and the cat four between the hips and the head: the chest goes the way the back does at the
 * shoulders and the ones between the way the back does at their place of it (chain.mts). The cat's jaw and ears are the face layer's. */
export const mesh2motionLinks = (donor: Donor, cat: Skeleton): Link[] => [
  // (a skeleton without the bones between, as the first meshes had, has the three anchors)
  ...chainLinks(donor, cat, FOX_BACK, CAT_BACK.filter((n) => cat.has(n)), FOX_ANCHORS),
  { bone: "tail", follows: "Tail_Base" },
  { bone: "tailstart", follows: { from: "Tail_Base", to: "Tail_Mid", at: 0.5 } },
  { bone: "tail1", follows: "Tail_Mid" },
  { bone: "tail2", follows: "Tail_Mid.001" },
  { bone: "tail3", follows: "Tail_End" },
  // (the cat's own left is the side the viewer does not see, the bones without a prefix; the fox faces +z, so its left, at +x, is the same side)
  ...side("", "L"),
  ...side("R_", "R"),
];

/** The paws: the legs of the cat (hip down to the paw) and where the fox's paws are. Which pad is whose is the order of gait.mts (`PAWS`). The hind legs hang from the hips, the front ones from the chest. */
export const MESH2MOTION_LEGS: Leg[] = [
  { chain: ["backleg", "backleg0", "backleg1", "backleg2"], carrier: { cat: "Hips", donor: "Hips" }, foot: "Back_Leg_Foot_L", toes: ["Back_Leg_Foot_1_L", "Back_Leg_Tip_L"], pad: 0 },
  { chain: ["R_backleg", "R_backleg0", "R_backleg1", "R_backleg2"], carrier: { cat: "Hips", donor: "Hips" }, foot: "Back_Leg_Foot_R", toes: ["Back_Leg_Foot_1_R", "Back_Leg_Tip_R"], pad: 1 },
  { chain: ["frontleg", "frontleg0", "frontleg1", "frontleg2"], carrier: { cat: "chest", donor: "Spine_3" }, foot: "Front_Leg_Foot_L", toes: ["Front_Leg_Foot_L", "Front_Leg_Tip_L"], pad: 2 },
  { chain: ["R_frontleg", "R_frontleg0", "R_frontleg1", "R_frontleg2"], carrier: { cat: "chest", donor: "Spine_3" }, foot: "Front_Leg_Foot_R", toes: ["Front_Leg_Foot_R", "Front_Leg_Tip_R"], pad: 3 },
];

/** The fox's hips are this high above its feet (the model's units), and the cat's are this high (body lengths): the hips' travel is scaled by their ratio. */
const FOX_HIPS_HEIGHT = 1.069;
const CAT_HIPS_HEIGHT = 0.475;

export interface Wanted {
  from: string;
  as: string;
  loop: boolean;
  /** A gait: the paws that are down are made to stay where they land (lock.mts). */
  lock?: boolean;
  /** What is laid on the donor's back, neck, tail and hips before the legs are placed (style.mts). */
  style?: Style;
}

/**
 * The clips asked for, on the cat's bones: the turns of the back, head and tail from the fox's (retarget.mts), and the legs by where the fox's paws are (feet.mts), in the frame
 * rate that makes each animation's length exact. `report` is told how well the paws were placed.
 */
export function mesh2motionClips(path: string, cat: Skeleton, mesh: CatMesh, wanted: readonly Wanted[], report?: (clip: string, legs: FeetReport[]) => void): ClipSource[] {
  const donor = readDonor(path);
  return wanted.map((w) => {
    const animation = donor.animations.findIndex((a) => a.name === w.from);
    if (animation < 0) throw new Error(`the fox has no animation ${w.from} (it has ${donor.animations.map((a) => a.name).join(", ")})`);
    const duration = donor.animations[animation]!.duration;
    // (frames at about thirty a second that make the animation's length exactly: the clip's own frame rate is the one that does)
    const frames = Math.max(2, Math.round(duration * 30));
    const fps = w.loop ? frames / duration : (frames - 1) / duration;
    const facing = { back: "Hips", front: "Head" };
    const plain = retarget(donor, cat, mesh2motionLinks(donor, cat), {
      name: w.as,
      fps,
      frames,
      loop: w.loop,
      step: 1 / fps,
      hips: { bone: "Hips", follows: "Hips" },
      hipsScale: CAT_HIPS_HEIGHT / FOX_HIPS_HEIGHT,
      facing,
      animation,
    });
    const placed = placeFeet(donor, cat, mesh, w.style ? styled(cat, plain, w.style) : plain, MESH2MOTION_LEGS, { animation, step: 1 / fps, facing, scale: CAT_HIPS_HEIGHT / FOX_HIPS_HEIGHT, ...(w.lock ? { lock: true } : {}) });
    report?.(w.as, placed.report);
    return placed.source;
  });
}
