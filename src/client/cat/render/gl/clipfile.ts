import type { Clip, Skeleton, SkeletonData } from "./pose";

/**
 * The cat's clips as a file: what scripts/cat/anim writes and the renderer loads. Little-endian.
 *
 *   header   magic, version, a stamp of the skeleton the clips were made for, the length of the description in bytes (and the description, in JSON, padded to four)
 *   turns    int16, four to a bone and frame (x y z w, as thirty-two thousandths of a unit), the neighbouring ones facing the same way
 *   places   float32, three to a bone and frame, for the few bones that move away from their parent (the hips)
 *
 * The description says, for each clip, its name, frame rate, frame count, whether it loops, its stride, its named moments, and for each bone how it is kept: a digit for
 * the turn (0 never leaves its rest, 1 holds one turn, 2 has a turn for every frame) and one for the place, and where in the arrays its numbers start.
 */

export const CLIPS_MAGIC = 0x504c434b; // "KCLP"
export const CLIPS_VERSION = 1;
const SCALE = 32767;

/**
 * A small number made of a skeleton's names and rest, for telling whether clips and a mesh were made around the same one. (The numbers are taken as the card's own
 * single-precision ones: a skeleton that is kept in a file as decimals and read back into a `Skeleton` must have the stamp it was written with.)
 */
export function skeletonStamp(data: SkeletonData): number {
  let h = 2166136261;
  const eat = (v: number): void => {
    h ^= v | 0;
    h = Math.imul(h, 16777619);
  };
  for (const name of data.names) {
    for (let i = 0; i < name.length; i++) eat(name.charCodeAt(i));
    eat(0);
  }
  for (const p of data.parent) eat(p + 1);
  for (const v of data.restT) eat(Math.round(Math.fround(v) * 1e4));
  for (const v of data.restR) eat(Math.round(Math.fround(v) * 1e4));
  return h >>> 0;
}

/** A clip as its maker has it, before it is packed: for each bone the turns (four a frame) and places (three a frame) it has, or null where it keeps its rest. */
export interface ClipSource {
  name: string;
  fps: number;
  frames: number;
  loop: boolean;
  stride?: number;
  marks?: Record<string, number>;
  r: Array<Float32Array | Float64Array | number[] | null>;
  t: Array<Float32Array | Float64Array | number[] | null>;
}

const SAME = 1e-4;
/** Places closer than this are one place (the file has noise below it, from the program that made the clip). */
const PLACE_SAME = 1e-5;

/**
 * The turns of a bone with neighbouring ones made to face the same way (a turn and its negative are the same turn; a line between them must not go the long way round), and the first
 * of them facing the way the bone's rest does: the makers of clips sign one turn either way, and a pose that has faded from one clip into another would change the sign of its numbers
 * (the same turn) where the fade ends.
 */
function aligned(src: ArrayLike<number>, frames: number, rest: readonly number[]): Float64Array {
  const out = new Float64Array(frames * 4);
  for (let f = 0; f < frames; f++) {
    const l = Math.hypot(src[f * 4]!, src[f * 4 + 1]!, src[f * 4 + 2]!, src[f * 4 + 3]!) || 1;
    for (let k = 0; k < 4; k++) out[f * 4 + k] = src[f * 4 + k]! / l;
    if (f > 0) {
      const d = out[f * 4]! * out[(f - 1) * 4]! + out[f * 4 + 1]! * out[(f - 1) * 4 + 1]! + out[f * 4 + 2]! * out[(f - 1) * 4 + 2]! + out[f * 4 + 3]! * out[(f - 1) * 4 + 3]!;
      if (d < 0) for (let k = 0; k < 4; k++) out[f * 4 + k] = -out[f * 4 + k]!;
    }
  }
  if (frames > 0 && out[0]! * rest[0]! + out[1]! * rest[1]! + out[2]! * rest[2]! + out[3]! * rest[3]! < 0) for (let i = 0; i < out.length; i++) out[i] = -out[i]!;
  return out;
}

export function encodeClips(data: SkeletonData, sources: readonly ClipSource[]): Uint8Array {
  const bones = data.names.length;
  const turns: number[] = [];
  const places: number[] = [];
  const description: unknown[] = [];
  for (const clip of sources) {
    if (clip.r.length !== bones || clip.t.length !== bones) throw new Error(`clip ${clip.name}: ${clip.r.length} turns for ${bones} bones`);
    const rKind: string[] = [];
    const tKind: string[] = [];
    const rAt: number[] = [];
    const tAt: number[] = [];
    for (let j = 0; j < bones; j++) {
      const rest = [data.restR[j * 4]!, data.restR[j * 4 + 1]!, data.restR[j * 4 + 2]!, data.restR[j * 4 + 3]!];
      const src = clip.r[j];
      if (!src) {
        rKind.push("0");
        rAt.push(0);
      } else {
        const a = aligned(src, clip.frames, rest);
        let moves = false;
        for (let f = 1; f < clip.frames && !moves; f++) for (let k = 0; k < 4; k++) if (Math.abs(a[f * 4 + k]! - a[k]!) > SAME) moves = true;
        if (moves) {
          rKind.push("2");
          rAt.push(turns.length);
          for (let i = 0; i < a.length; i++) turns.push(Math.round(a[i]! * SCALE));
        } else {
          const dot = a[0]! * rest[0]! + a[1]! * rest[1]! + a[2]! * rest[2]! + a[3]! * rest[3]!;
          if (Math.abs(Math.abs(dot) - 1) < SAME * SAME) {
            rKind.push("0");
            rAt.push(0);
          } else {
            rKind.push("1");
            rAt.push(turns.length);
            for (let k = 0; k < 4; k++) turns.push(Math.round(a[k]! * SCALE));
          }
        }
      }
      const tsrc = clip.t[j];
      if (!tsrc) {
        tKind.push("0");
        tAt.push(0);
      } else {
        let moves = false;
        for (let f = 1; f < clip.frames && !moves; f++) for (let k = 0; k < 3; k++) if (Math.abs(tsrc[f * 3 + k]! - tsrc[k]!) > PLACE_SAME) moves = true;
        if (moves) {
          tKind.push("2");
          tAt.push(places.length);
          for (let i = 0; i < clip.frames * 3; i++) places.push(tsrc[i]!);
        } else {
          const same = [0, 1, 2].every((k) => Math.abs(tsrc[k]! - data.restT[j * 3 + k]!) < PLACE_SAME);
          if (same) {
            tKind.push("0");
            tAt.push(0);
          } else {
            tKind.push("1");
            tAt.push(places.length);
            for (let k = 0; k < 3; k++) places.push(tsrc[k]!);
          }
        }
      }
    }
    description.push({ name: clip.name, fps: clip.fps, frames: clip.frames, loop: clip.loop, stride: clip.stride ?? 0, marks: clip.marks ?? {}, rKind: rKind.join(""), tKind: tKind.join(""), rAt, tAt });
  }
  const json = new TextEncoder().encode(JSON.stringify({ bones, clips: description }));
  const jsonPad = (4 - (json.length % 4)) % 4;
  const turnBytes = turns.length * 2;
  const turnPad = (4 - (turnBytes % 4)) % 4;
  const total = 16 + json.length + jsonPad + turnBytes + turnPad + places.length * 4;
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  view.setUint32(0, CLIPS_MAGIC, true);
  view.setUint32(4, CLIPS_VERSION, true);
  view.setUint32(8, skeletonStamp(data), true);
  view.setUint32(12, json.length, true);
  new Uint8Array(buffer, 16, json.length).set(json);
  let at = 16 + json.length + jsonPad;
  new Int16Array(buffer, at, turns.length).set(turns);
  at += turnBytes + turnPad;
  new Float32Array(buffer, at, places.length).set(places);
  return new Uint8Array(buffer);
}

export function decodeClips(data: ArrayBuffer, skeleton: Skeleton): Clip[] {
  const view = new DataView(data);
  if (data.byteLength < 16 || view.getUint32(0, true) !== CLIPS_MAGIC) throw new Error("not a file of cat clips");
  if (view.getUint32(4, true) !== CLIPS_VERSION) throw new Error("cat clips of another version");
  const stamp = view.getUint32(8, true);
  const own = skeletonStamp({ names: skeleton.names, parent: Array.from(skeleton.parent), restT: Array.from(skeleton.restT), restR: Array.from(skeleton.restR) });
  if (stamp !== own) throw new Error("cat clips made for another skeleton");
  const jsonLength = view.getUint32(12, true);
  if (16 + jsonLength > data.byteLength) throw new Error("cat clips that are cut short");
  const description = JSON.parse(new TextDecoder().decode(new Uint8Array(data, 16, jsonLength))) as {
    bones: number;
    clips: Array<{ name: string; fps: number; frames: number; loop: boolean; stride: number; marks: Record<string, number>; rKind: string; tKind: string; rAt: number[]; tAt: number[] }>;
  };
  if (description.bones !== skeleton.count) throw new Error("cat clips for a different number of bones");
  const jsonPad = (4 - (jsonLength % 4)) % 4;
  const turnsAt = 16 + jsonLength + jsonPad;
  // (the number of turns is whatever the description reaches; the places follow them)
  let turnCount = 0;
  let placeCount = 0;
  for (const c of description.clips) {
    for (let j = 0; j < skeleton.count; j++) {
      if (c.rKind[j] === "1") turnCount = Math.max(turnCount, c.rAt[j]! + 4);
      if (c.rKind[j] === "2") turnCount = Math.max(turnCount, c.rAt[j]! + c.frames * 4);
      if (c.tKind[j] === "1") placeCount = Math.max(placeCount, c.tAt[j]! + 3);
      if (c.tKind[j] === "2") placeCount = Math.max(placeCount, c.tAt[j]! + c.frames * 3);
    }
  }
  const turnBytes = turnCount * 2;
  const placesAt = turnsAt + turnBytes + ((4 - (turnBytes % 4)) % 4);
  if (placesAt + placeCount * 4 > data.byteLength) throw new Error("cat clips that are cut short");
  const raw = new Int16Array(data, turnsAt, turnCount);
  // (every turn is four numbers and starts on a multiple of four, so the whole block is made unit length in one go, and every clip reads from it)
  const turns = new Float32Array(turnCount);
  for (let o = 0; o + 3 < turnCount; o += 4) {
    const x = raw[o]! / SCALE;
    const y = raw[o + 1]! / SCALE;
    const z = raw[o + 2]! / SCALE;
    const w = raw[o + 3]! / SCALE;
    const l = Math.hypot(x, y, z, w) || 1;
    turns[o] = x / l;
    turns[o + 1] = y / l;
    turns[o + 2] = z / l;
    turns[o + 3] = w / l;
  }
  const places = new Float32Array(data, placesAt, placeCount);
  return description.clips.map((c) => ({
    name: c.name,
    fps: c.fps,
    frames: c.frames,
    loop: c.loop,
    stride: c.stride,
    marks: c.marks,
    rKind: Uint8Array.from(c.rKind, (ch) => Number(ch)),
    rAt: Int32Array.from(c.rAt),
    r: turns,
    tKind: Uint8Array.from(c.tKind, (ch) => Number(ch)),
    tAt: Int32Array.from(c.tAt),
    t: places,
  }));
}
