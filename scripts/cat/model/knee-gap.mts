// How far apart the thigh's and the shin's images of the rest's knee are, per clip and leg (a knee that the floor rule lifted leaves the two rigid pieces apart: the skin tears there).
import { CatRig } from "../../../src/client/cat/render/rig";
import { PoseFit } from "../../../src/client/cat/render/gl/fit";
import { BONE, BONE_COUNT, BONE_FLOATS, Skeleton, mat } from "../../../src/client/cat/render/gl/skeleton";
import type { CatFrame } from "../../../src/client/cat/types";

const frame = (over: Partial<CatFrame>): CatFrame => ({ x: 0, y: 0, facing: 1, clip: "stand", clipTime: 0, progress: 0, odometer: 0, vx: 0, vy: 0, grounded: true, viewer: false, drowsy: 0, energy: 0.3, appear: 1, petted: false, carried: false, ...over });
const fit = new PoseFit();
const skeleton = new Skeleton(fit.rest);
const out = new Float32Array(BONE_COUNT * BONE_FLOATS);
const apply = (bone: number, p: { x: number; y: number }): { x: number; y: number } => ({
  x: out[bone * 12]! * p.x + out[bone * 12 + 1]! * p.y + out[bone * 12 + 3]!,
  y: out[bone * 12 + 4]! * p.x + out[bone * 12 + 5]! * p.y + out[bone * 12 + 7]!,
});
const clips = ["stand", "walk", "run", "sit", "loaf", "curl", "crouch", "stretch", "groom", "yawn", "scratch", "knead", "sniff", "stalk", "wiggle", "jump"] as const;
console.log("clip         progress  fn      ff      hn      hf   (gap between the thigh's and the shin's knee, body lengths)");
for (const clip of clips) {
  for (const progress of [0.1, 0.5, 0.9]) {
    const rig = new CatRig(3);
    const base = frame({ clip, progress, drowsy: clip === "curl" ? 1 : 0 });
    rig.snapTo(base, 100);
    for (let k = 0; k < 90; k++) rig.update({ ...base, clipTime: k / 60 }, 1 / 60, 100);
    const s = fit.apply(rig.solved);
    skeleton.solve(s, 0, mat(), out);
    const gaps = (["fn", "ff", "hn", "hf"] as const).map((key, i) => {
      const first = [BONE.fnU, BONE.ffU, BONE.hnU, BONE.hfU][i]!;
      const rest = skeleton.restUp.legs[key];
      const a = apply(first, rest.mid);
      const b = apply(first + 1, rest.mid);
      return Math.hypot(a.x - b.x, a.y - b.y);
    });
    // (how much longer or shorter the thigh and the shin are than the model's own, per leg: the stretch that would close the gap)
    const ratios = (["fn", "ff", "hn", "hf"] as const).map((key) => {
      const r = skeleton.restUp.legs[key];
      const n = s.legs[key];
      const thigh = Math.hypot(n.mid.x - n.root.x, n.mid.y - n.root.y) / Math.hypot(r.mid.x - r.root.x, r.mid.y - r.root.y);
      const shin = Math.hypot(n.hock.x - n.mid.x, n.hock.y - n.mid.y) / Math.hypot(r.hock.x - r.mid.x, r.hock.y - r.mid.y);
      return `${thigh.toFixed(2)}/${shin.toFixed(2)}`;
    });
    console.log(`${clip.padEnd(12)} ${progress.toFixed(1).padStart(6)}   ${gaps.map((g) => g.toFixed(3).padStart(6)).join("  ")}    thigh/shin length vs the model's: ${ratios.join("  ")}`);
  }
}
