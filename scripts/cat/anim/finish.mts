// A retargeted clip, finished for the cat it is going to be played on: a gait is put on the floor and its stride measured, a leap has its flight left to the engine and its moments
// marked, and every clip is kept on the floor by the policy that suits it. What comes out is what is packed (pack.mts) or looked at in the lab.
import { decodeClips, encodeClips, type ClipSource } from "../../../src/client/cat/render/gl/clipfile";
import type { CatMesh } from "../../../src/client/cat/render/gl/format";
import type { Skeleton } from "../../../src/client/cat/render/gl/pose";
import { airborne, levelInAir, stayLow, withLeapMarks } from "./flight.mts";
import { heights, keepOnFloor, type FloorPolicy } from "./floor.mts";
import { analyseGait, soleVertices, type SpeedRange } from "./gait.mts";
import { groundGait } from "./ground.mts";

/** What a clip is finished with: the speeds a gait may have (its paws are put on the floor and the stride is measured), a leap, the floor policy. */
export interface Finish {
  gait?: SpeedRange;
  leap?: boolean;
  floor?: FloorPolicy;
}

/** The clips finished as `how` says by name (a name not in it is left as it is), with the stride of each gait written in; `say` is told what was done. */
export function finishClips(mesh: CatMesh, skeleton: Skeleton, raw: readonly ClipSource[], how: Readonly<Record<string, Finish>>, say: (line: string) => void = () => {}): ClipSource[] {
  const soles = soleVertices(mesh, skeleton);
  const finished = raw.map((s) => {
    const want = how[s.name];
    let source = s;
    if (!want) return source;
    if (want.gait) {
      const g = groundGait(mesh, skeleton, source, soles, want.gait);
      source = g.source;
      const fit = g.fit;
      say(`${s.name}: grounded: hips ${fit.lift >= 0 ? "raised" : "lowered"} ${Math.abs(fit.lift).toFixed(3)}, pitch ${((fit.pitch * 180) / Math.PI).toFixed(2)} deg; paws off the floor ${fit.before.toFixed(3)} -> ${fit.after.toFixed(3)}; lowest ${fit.lowestBefore.toFixed(3)} -> ${fit.lowestAfter.toFixed(3)}`);
    }
    if (want.leap) {
      // (the leap is the engine's: the moments are found while the donor's body is still in the air, then its height is taken out)
      const moment = airborne(mesh, skeleton, source);
      if (moment) source = levelInAir(skeleton, source, moment);
      source = stayLow(skeleton, source);
      if (moment) {
        source = withLeapMarks(source, moment);
        say(`${s.name}: take-off at frame ${moment.takeoff} (${(moment.takeoff / source.fps).toFixed(2)} s), landing at frame ${moment.land} (${(moment.land / source.fps).toFixed(2)} s) of ${source.frames}`);
      } else say(`${s.name}: no flight found`);
    }
    if (want.floor) {
      const before = heights(mesh, skeleton, source);
      const kept = keepOnFloor(mesh, skeleton, source, want.floor);
      say(`${s.name}: floor (${want.floor}): the cat was ${(-Math.min(...before)).toFixed(3)} too high to ${Math.max(...before).toFixed(3)} too low; lifted by ${Math.min(...kept.lift).toFixed(3)} .. ${Math.max(...kept.lift).toFixed(3)}`);
      source = kept.source;
    }
    return source;
  });
  // the stride of a gait is measured on the clip as it will be played (its numbers as the file keeps them)
  const bytes = encodeClips(mesh.skeleton, finished);
  const played = decodeClips(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, skeleton);
  return finished.map((s, i) => {
    const range = how[s.name]?.gait;
    if (!range) {
      say(`${s.name}: ${s.frames} frames at ${s.fps.toFixed(2)}${s.loop ? " (loop)" : ""}`);
      return s;
    }
    const gait = analyseGait(mesh, skeleton, played[i]!, soles, range);
    say(`${s.name}: ${s.frames} frames at ${s.fps.toFixed(2)}; ${gait.speed.toFixed(2)} body lengths/s, stride ${gait.stride.toFixed(3)} (paws slide at most ${gait.slide.toFixed(3)}); down ${gait.paws.map((p) => p.down.filter(Boolean).length).join("/")} of ${s.frames}`);
    return { ...s, stride: gait.stride };
  });
}
