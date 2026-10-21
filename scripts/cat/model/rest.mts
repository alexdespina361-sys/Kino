import { CatRig } from "../../../src/client/cat/render/rig";
import type { CatFrame } from "../../../src/client/cat/types";

const frame: CatFrame = { x: 0, y: 0, facing: 1, clip: "stand", clipTime: 0, progress: 0, odometer: 0, vx: 0, vy: 0, grounded: true, viewer: false, drowsy: 0, energy: 0.3, appear: 1, petted: false };
const rig = new CatRig(1);
rig.snapTo(frame, 100);
const s = rig.solved;
const f = (v: number) => (Math.round(v * 1000) / 1000).toFixed(3);
const up = (j: { x: number; y: number }) => `(${f(j.x)}, ${f(-j.y)})`;
for (const k of ["fn", "ff", "hn", "hf"] as const) {
  const l = s.legs[k];
  console.log(k, "root", up(l.root), "mid", up(l.mid), "hock", up(l.hock), "toe", up(l.toe));
}
console.log("head", up(s.head), "rot", f(s.head.rot), "yaw", f(s.head.yaw));
console.log("tail", s.tail.map(up).join(" "));
for (const [k, v] of Object.entries(s.pose.p)) console.log(k.padEnd(12), up(v));
