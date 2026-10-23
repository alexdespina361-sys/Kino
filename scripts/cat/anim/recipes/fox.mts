// The Fox of the Khronos sample models (https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Fox): three animations (Survey, Walk, Run) of a fox with four-jointed
// hind legs and three-jointed front ones, made by an animator. Its model is public domain (CC0, PixelMannen); its rigging and animation are CC BY 4.0 (tomkranis), and its
// conversion to glTF too (@AsoboStudio and @scurest). The cat's bones are made to do what the fox's do (retarget.mts); nothing of the fox's model is used.
import type { Skeleton } from "../../../../src/client/cat/render/gl/pose";
import type { ClipSource } from "../../../../src/client/cat/render/gl/clipfile";
import type { CatMesh } from "../../../../src/client/cat/render/gl/format";
import { chainLinks, type Anchor } from "../chain.mts";
import { readDonor, type Donor } from "../donor.mts";
import { placeFeet, type FeetReport, type Leg } from "../feet.mts";
import { retarget, type Link } from "../retarget.mts";

const side = (cat: string, fox: "Left" | "Right"): Link[] => {
  const left = fox === "Left";
  return [
    { bone: `${cat}backleg`, follows: `b_${fox}Leg01_${left ? "015" : "019"}` },
    { bone: `${cat}backleg0`, follows: `b_${fox}Leg02_${left ? "016" : "020"}` },
    { bone: `${cat}backleg1`, follows: `b_${fox}Foot01_${left ? "017" : "021"}` },
    { bone: `${cat}backleg2`, follows: `b_${fox}Foot02_${left ? "018" : "022"}` },
    { bone: `${cat}frontleg`, follows: `b_${fox === "Left" ? "LeftUpperArm_09" : "RightUpperArm_06"}` },
    { bone: `${cat}frontleg0`, follows: `b_${fox === "Left" ? "LeftForeArm_010" : "RightForeArm_07"}` },
    { bone: `${cat}frontleg1`, follows: `b_${fox === "Left" ? "LeftHand_011" : "RightHand_08"}` },
    { bone: `${cat}frontleg2`, follows: `b_${fox === "Left" ? "LeftHand_011" : "RightHand_08"}` },
  ];
};

/** The fox's back from the hips to the head, and the cat's: the bones that are the same place of both are the anchors (the chest is where the fox's front legs hang from). */
const FOX_BACK = ["b_Hip_01", "b_Spine01_02", "b_Spine02_03", "b_Neck_04", "b_Head_05"];
const CAT_BACK = ["Hips", "spine1", "spine2", "chest", "neck1", "neck2", "head"];
const FOX_ANCHORS: Anchor[] = [
  { cat: "Hips", donor: "b_Hip_01" },
  { cat: "chest", donor: "b_Spine02_03" },
  { cat: "head", donor: "b_Head_05" },
];

/** Which of the fox's bones each of the cat's follows (the cat has no jaw or ear bones in the fox's sense: those go with the head, as they were made). */
export const foxLinks = (donor: Donor, cat: Skeleton): Link[] => [
  // (a skeleton without the bones between, as the first meshes had, has the three anchors)
  ...chainLinks(donor, cat, FOX_BACK, CAT_BACK.filter((n) => cat.has(n)), FOX_ANCHORS),
  { bone: "tail", follows: "b_Tail01_012" },
  { bone: "tailstart", follows: { from: "b_Tail01_012", to: "b_Tail02_013", at: 0.5 } },
  { bone: "tail1", follows: "b_Tail02_013" },
  { bone: "tail2", follows: { from: "b_Tail02_013", to: "b_Tail03_014", at: 0.5 } },
  { bone: "tail3", follows: "b_Tail03_014" },
  // (the cat's own left is the side the viewer does not see, the bones without a prefix; the fox's left is the same side)
  ...side("", "Left"),
  ...side("R_", "Right"),
];

/** The paws: the fox has no bone past its paw's joint, so the middle of its sole is told by the same joint. Which pad is whose is the order of gait.mts (`PAWS`). */
export const FOX_LEGS: Leg[] = [
  { chain: ["backleg", "backleg0", "backleg1", "backleg2"], carrier: { cat: "Hips", donor: "b_Hip_01" }, foot: "b_LeftFoot02_018", toes: ["b_LeftFoot02_018"], pad: 0 },
  { chain: ["R_backleg", "R_backleg0", "R_backleg1", "R_backleg2"], carrier: { cat: "Hips", donor: "b_Hip_01" }, foot: "b_RightFoot02_022", toes: ["b_RightFoot02_022"], pad: 1 },
  { chain: ["frontleg", "frontleg0", "frontleg1", "frontleg2"], carrier: { cat: "chest", donor: "b_Spine02_03" }, foot: "b_LeftHand_011", toes: ["b_LeftHand_011"], pad: 2 },
  { chain: ["R_frontleg", "R_frontleg0", "R_frontleg1", "R_frontleg2"], carrier: { cat: "chest", donor: "b_Spine02_03" }, foot: "b_RightHand_08", toes: ["b_RightHand_08"], pad: 3 },
];

/** The fox's hips are this high above its feet (the model's units), and the cat's are this high (body lengths): the hips' travel is scaled by their ratio. */
const FOX_HIPS_HEIGHT = 42.938;
const CAT_HIPS_HEIGHT = 0.475;

export interface Wanted {
  from: string;
  as: string;
  loop: boolean;
  /** A gait: the paws that are down are made to stay where they land (lock.mts). */
  lock?: boolean;
}

export function foxClips(path: string, cat: Skeleton, mesh: CatMesh, wanted: readonly Wanted[], report?: (clip: string, legs: FeetReport[]) => void): ClipSource[] {
  const donor = readDonor(path);
  return wanted.map((w) => {
    const animation = donor.animations.findIndex((a) => a.name === w.from);
    if (animation < 0) throw new Error(`the fox has no animation ${w.from} (it has ${donor.animations.map((a) => a.name).join(", ")})`);
    const duration = donor.animations[animation]!.duration;
    // (frames at about thirty a second that make the animation's length exactly: the clip's own frame rate is the one that does)
    const frames = Math.max(2, Math.round(duration * 30));
    const fps = w.loop ? frames / duration : (frames - 1) / duration;
    const facing = { back: "b_Hip_01", front: "b_Head_05" };
    const plain = retarget(donor, cat, foxLinks(donor, cat), {
      name: w.as,
      fps,
      frames,
      loop: w.loop,
      step: 1 / fps,
      hips: { bone: "Hips", follows: "b_Hip_01" },
      hipsScale: CAT_HIPS_HEIGHT / FOX_HIPS_HEIGHT,
      facing,
      animation,
    });
    const placed = placeFeet(donor, cat, mesh, plain, FOX_LEGS, { animation, step: 1 / fps, facing, scale: CAT_HIPS_HEIGHT / FOX_HIPS_HEIGHT, ...(w.lock ? { lock: true } : {}) });
    report?.(w.as, placed.report);
    return placed.source;
  });
}
