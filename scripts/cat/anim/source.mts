// A clip source (clipfile.ts) as the working numbers the scripts of this folder share: the pose of the cat at one of its frames.
import { Pose, type Skeleton } from "../../../src/client/cat/render/gl/pose";
import type { ClipSource } from "../../../src/client/cat/render/gl/clipfile";

/** `pose` made the pose `source` has at frame `f` (a bone the source has no numbers for is at its rest). */
export function poseAt(skeleton: Skeleton, source: ClipSource, f: number, pose: Pose): void {
  for (let j = 0; j < skeleton.count; j++) {
    const rs = source.r[j];
    for (let k = 0; k < 4; k++) pose.r[j * 4 + k] = rs ? rs[f * 4 + k]! : skeleton.restR[j * 4 + k]!;
    const ts = source.t[j];
    for (let k = 0; k < 3; k++) pose.t[j * 3 + k] = ts ? ts[f * 3 + k]! : skeleton.restT[j * 3 + k]!;
  }
}
