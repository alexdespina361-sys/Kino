import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Clip as EngineClip, CatFrame } from "../../types";
import { CatRig, type Solved } from "../rig";
import { decodeClips, encodeClips, type ClipSource } from "./clipfile";
import { Director } from "./director";
import { decodeMesh, encodeMesh, MESH_MAGIC, MESH_VERSION, packIndex, unpackIndex } from "./format";
import { Pose, Skeleton, solve } from "./pose";
import { mat, pitchAbout } from "./world";

const bufferOf = (name: string): ArrayBuffer => {
  const file = readFileSync(new URL(name, import.meta.url));
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
};
const meshFile = (): ArrayBuffer => bufferOf("./cat.mesh");
const clipsFile = (): ArrayBuffer => bufferOf("./cat.clips");

const frame = (over: Partial<CatFrame>): CatFrame => ({ x: 0, y: 0, facing: 1, clip: "stand", clipTime: 0, progress: 0, odometer: 0, vx: 0, vy: 0, grounded: true, viewer: false, drowsy: 0, energy: 0.3, appear: 1, petted: false, carried: false, ...over });

/** A cat in a clip, settled: what the rig has after a second and a half of it. */
const solvedIn = (over: Partial<CatFrame>): Solved => {
  const rig = new CatRig(3);
  const base = frame(over);
  rig.snapTo(base, 100);
  for (let k = 0; k < 90; k++) rig.update({ ...base, clipTime: k / 60 }, 1 / 60, 100);
  return rig.solved;
};

describe("the cat's mesh file", () => {
  const data = meshFile();
  const mesh = decodeMesh(data);

  it("is small enough to be fetched by a screen that is on a poor line, and has the vertices a 16-bit index can name", () => {
    expect(data.byteLength).toBeLessThan(400 * 1024);
    expect(mesh.count).toBeGreaterThan(5000);
    expect(mesh.count).toBeLessThan(65536);
    expect(mesh.index.length % 3).toBe(0);
  });

  it("has only triangles that are made of three different vertices of its own", () => {
    const used = new Uint8Array(mesh.count);
    for (let i = 0; i < mesh.index.length; i += 3) {
      const [a, b, c] = [mesh.index[i]!, mesh.index[i + 1]!, mesh.index[i + 2]!];
      expect(Math.max(a, b, c)).toBeLessThan(mesh.count);
      expect(new Set([a, b, c]).size).toBe(3);
      used[a] = used[b] = used[c] = 1;
    }
    expect(used.reduce((n, v) => n + v, 0)).toBe(mesh.count); // (no vertex hangs loose)
  });

  it("is as big as a cat, in body lengths, and every vertex is inside the box it says", () => {
    const [x0, y0, z0, x1, y1, z1] = mesh.bounds;
    expect(x1 - x0).toBeGreaterThan(1.2);
    expect(x1 - x0).toBeLessThan(1.9);
    expect(y1 - y0).toBeGreaterThan(0.9);
    expect(y1 - y0).toBeLessThan(1.3);
    expect(z1 - z0).toBeGreaterThan(0.2);
    expect(z1 - z0).toBeLessThan(0.6);
    for (let i = 0; i < mesh.count; i++) {
      expect(mesh.pos[i * 3]!).toBeGreaterThanOrEqual(x0 - 1e-4);
      expect(mesh.pos[i * 3]!).toBeLessThanOrEqual(x1 + 1e-4);
      expect(mesh.pos[i * 3 + 1]!).toBeGreaterThanOrEqual(y0 - 1e-4);
      expect(mesh.pos[i * 3 + 1]!).toBeLessThanOrEqual(y1 + 1e-4);
    }
  });

  it("is skinned to bones the file carries, with weights that make a whole, and the shader has room for them", () => {
    const bones = mesh.skeleton.names.length;
    expect(bones).toBeLessThanOrEqual(40);
    for (let i = 0; i < mesh.count; i++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        const w = mesh.weight[i * 4 + k]!;
        sum += w;
        if (w > 0) expect(mesh.skin[i * 4 + k]!).toBeLessThan(bones);
      }
      expect(sum).toBe(255);
    }
  });

  it("has the bones the director moves (the model's own, and the jaw and ears added to it), each hung from one before it", () => {
    const names = mesh.skeleton.names;
    for (const bone of ["Hips", "chest", "head", "jaw", "earL", "earR", "backleg2", "R_backleg2", "frontleg2", "R_frontleg2", "tail"]) expect(names, bone).toContain(bone);
    mesh.skeleton.parent.forEach((p, j) => expect(p).toBeLessThan(j));
    expect(mesh.skeleton.parent[0]).toBe(-1);
  });

  it("gives the jaw and the ears some of the head's weight, and not all of it", () => {
    const names = mesh.skeleton.names;
    for (const bone of ["jaw", "earL", "earR"]) {
      const id = names.indexOf(bone);
      let points = 0;
      for (let i = 0; i < mesh.count; i++) for (let k = 0; k < 4; k++) if (mesh.skin[i * 4 + k] === id && mesh.weight[i * 4 + k]! > 128) points++;
      expect(points, bone).toBeGreaterThan(20);
      expect(points, bone).toBeLessThan(mesh.count / 4);
    }
  });

  it("says what part of the cat each point is (the coats of other cats are painted by it): legs, tail, how far along the tail, the left legs' share of the legs", () => {
    let legs = 0;
    let tail = 0;
    let left = 0;
    let right = 0;
    for (let i = 0; i < mesh.count; i++) {
      const [l, t, , s] = [mesh.part[i * 4]!, mesh.part[i * 4 + 1]!, mesh.part[i * 4 + 2]!, mesh.part[i * 4 + 3]!];
      expect(s, "the left share is a share of the legs").toBeLessThanOrEqual(l + 1);
      if (l > 200) legs++;
      if (t > 200) tail++;
      if (l > 200 && s > 200) left++;
      if (l > 200 && l - s > 200) right++;
    }
    expect(legs).toBeGreaterThan(300);
    expect(tail).toBeGreaterThan(100);
    expect(left).toBeGreaterThan(100);
    expect(right).toBeGreaterThan(100);
  });

  it("has normals that point somewhere (unit length, to the precision of a byte)", () => {
    for (let i = 0; i < mesh.count; i++) {
      const len = Math.hypot(mesh.normal[i * 3]!, mesh.normal[i * 3 + 1]!, mesh.normal[i * 3 + 2]!) / 127;
      expect(len).toBeGreaterThan(0.95);
      expect(len).toBeLessThan(1.05);
    }
  });

  it("carries a colour in every vertex, and how open to the room the skin is there (a coat that is all one colour, or a mesh that was never lit, is a mistake)", () => {
    let lightest = 0;
    let darkest = 255;
    let open = 0;
    let closed = 0;
    for (let i = 0; i < mesh.count; i++) {
      const luma = 0.3 * mesh.color[i * 4]! + 0.55 * mesh.color[i * 4 + 1]! + 0.15 * mesh.color[i * 4 + 2]!;
      lightest = Math.max(lightest, luma);
      darkest = Math.min(darkest, luma);
      const ao = mesh.color[i * 4 + 3]!;
      if (ao > 200) open++;
      if (ao < 120) closed++;
    }
    expect(lightest - darkest).toBeGreaterThan(90); // (the pale body and the grey points)
    expect(open).toBeGreaterThan(mesh.count * 0.3);
    expect(closed).toBeGreaterThan(mesh.count * 0.005);
  });

  it("is refused when it is not a cat mesh of this version, or is cut short, or its skeleton has been changed after it was written", () => {
    const broken = (patch: (view: DataView) => void): ArrayBuffer => {
      const copy = data.slice(0);
      patch(new DataView(copy));
      return copy;
    };
    expect(() => decodeMesh(broken((v) => v.setUint32(0, 0, true)))).toThrow(/not a cat mesh/);
    expect(() => decodeMesh(broken((v) => v.setUint32(4, MESH_VERSION + 1, true)))).toThrow(/another version/);
    expect(() => decodeMesh(data.slice(0, 3000))).toThrow(/cut short/);
    expect(() => decodeMesh(new ArrayBuffer(8))).toThrow(/not a cat mesh/);
    expect(() => decodeMesh(broken((v) => v.setUint32(40, v.getUint32(40, true) ^ 1, true)))).toThrow(/skeleton is not the one/);
    expect(new DataView(data).getUint32(0, true)).toBe(MESH_MAGIC);
  });
});

describe("the triangles of a mesh, packed", () => {
  const triangles = (index: ArrayLike<number>): string[] => {
    const out: string[] = [];
    for (let i = 0; i < index.length; i += 3) out.push(`${index[i]},${index[i + 1]},${index[i + 2]}`);
    return out.sort();
  };

  it("come back the same triangles (in the order of their lowest vertex), whatever numbers they are made of", () => {
    let seed = 12345;
    const random = (n: number): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed % n;
    };
    const index: number[] = [0, 1, 2, 65535, 0, 65534, 40000, 39999, 40001];
    for (let i = 0; i < 3000; i++) {
      const a = random(65536);
      index.push(a, random(65536), Math.max(0, Math.min(65535, a + random(400) - 200)));
    }
    const back = unpackIndex(packIndex(index), index.length);
    expect(back.length).toBe(index.length);
    expect(triangles(back)).toEqual(triangles(index));
  });

  it("are shorter than 16 bits a number when they lie close together, as the vertices of one surface do", () => {
    const index: number[] = [];
    for (let v = 0; v < 2000; v++) index.push(v, v + 1, v + 40, v + 1, v + 41, v + 40);
    expect(packIndex(index).length).toBeLessThan(index.length * 2 * 0.6);
  });

  it("are refused when the stream ends in the middle of one", () => {
    const stream = packIndex([5, 6, 7, 300, 301, 302]);
    expect(() => unpackIndex(stream.slice(0, stream.length - 1), 6)).toThrow(/ends in the middle/);
  });

  it("go through a whole mesh file and come out whole, with the skeleton it was skinned to", () => {
    const skeleton = { names: ["root", "arm"], parent: [-1, 0], restT: [0, 0, 0, 0.5, 0.25, 0], restR: [0, 0, 0, 1, 0, 0, 0.7071068, 0.7071068] };
    const bytes = encodeMesh({
      bounds: [0, 0, 0, 1, 1, 1],
      skeleton,
      pos: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
      normal: new Int8Array(12).fill(64),
      skin: new Uint8Array(16),
      weight: new Uint8Array(16).fill(1),
      color: new Uint8Array(16).fill(9),
      part: new Uint8Array(16).fill(3),
      index: [0, 1, 2, 0, 2, 3],
    });
    const mesh = decodeMesh(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    expect(mesh.count).toBe(4);
    expect(mesh.skeleton.names).toEqual(["root", "arm"]);
    expect(mesh.skeleton.parent).toEqual([-1, 0]);
    expect(mesh.skeleton.restT[3]).toBeCloseTo(0.5, 6);
    expect(Array.from(mesh.index)).toEqual([0, 1, 2, 0, 2, 3]);
    expect(mesh.pos[3]!).toBeCloseTo(1, 3);
    expect(mesh.pos[7]!).toBeCloseTo(1, 3);
    expect(Array.from(mesh.color.slice(0, 4))).toEqual([9, 9, 9, 9]);
    expect(Array.from(mesh.part.slice(0, 4))).toEqual([3, 3, 3, 3]);
  });
});

describe("the bones of the solid cat", () => {
  const mesh = decodeMesh(meshFile());
  const skeleton = new Skeleton(mesh.skeleton);
  const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

  it("leave the mesh as it is when the cat is as it was made (a skin matrix is the identity at rest, for every bone)", () => {
    const out = new Float32Array(skeleton.count * 12);
    solve(skeleton, new Pose(skeleton), IDENTITY, out);
    for (let j = 0; j < skeleton.count; j++) for (let k = 0; k < 12; k++) expect(out[j * 12 + k]!, `${skeleton.names[j]} number ${k}`).toBeCloseTo(IDENTITY[k]!, 4);
  });

  it("are the skeleton the clips were made for (a clip file for another skeleton is refused)", () => {
    expect(() => decodeClips(clipsFile(), skeleton)).not.toThrow();
    const other = new Skeleton({ ...mesh.skeleton, restT: mesh.skeleton.restT.map((v, i) => (i === 7 ? v + 0.01 : v)) });
    expect(() => decodeClips(clipsFile(), other)).toThrow(/another skeleton/);
  });
});

describe("the clips of the solid cat", () => {
  const mesh = decodeMesh(meshFile());
  const skeleton = new Skeleton(mesh.skeleton);
  const clips = decodeClips(clipsFile(), skeleton);

  it("hold the walk, a loop that carries the cat a stride of the ground in each round, as far as a cat's walk goes", () => {
    const walk = clips.find((c) => c.name === "walk");
    expect(walk, "a walk").toBeDefined();
    expect(walk!.loop).toBe(true);
    expect(walk!.frames).toBeGreaterThanOrEqual(12);
    expect(walk!.stride).toBeGreaterThan(0.3);
    expect(walk!.stride).toBeLessThan(1.4);
  });

  it("hold the two climbs: up over a ledge, once through by the progress of the climb, and up the face of a card seen from behind, a bound that is played by the distance climbed", () => {
    const climb = clips.find((c) => c.name === "climb");
    expect(climb, "a climb").toBeDefined();
    expect(climb!.loop).toBe(false);
    for (const mark of ["grab", "pull", "over"]) expect(climb!.marks[mark], mark).toBeGreaterThan(0);
    expect(climb!.marks.grab!).toBeLessThan(climb!.marks.pull!);
    expect(climb!.marks.pull!).toBeLessThan(climb!.marks.over!);
    const scale = clips.find((c) => c.name === "scale");
    expect(scale, "a scale").toBeDefined();
    expect(scale!.loop).toBe(true);
    expect(scale!.stride).toBeGreaterThan(0.3);
    expect(scale!.stride).toBeLessThan(1);
  });

  it("are small enough to be fetched along with the mesh", () => {
    // (some twenty-five clips, a hundred frames or fewer each, at sixteen bits a number: a quarter of a megabyte at the most)
    expect(clipsFile().byteLength).toBeLessThan(256 * 1024);
  });
});

describe("the turns in a clip file", () => {
  const data = { names: ["Hips", "tail"], parent: [-1, 0], restT: [0, 0, 0, 0.1, 0, 0], restR: [0, 0, 0, 1, 0, 0, 0, 1] };
  const skeleton = new Skeleton(data);
  /** A turn of `angle` about z, written as it is or as its negative (the same turn). */
  const turn = (angle: number, sign: 1 | -1): number[] => [0, 0, sign * Math.sin(angle / 2), sign * Math.cos(angle / 2)];
  const clipOf = (turns: number[][]): ClipSource => ({ name: "t", fps: 30, frames: turns.length, loop: false, r: [null, turns.flat()], t: [null, null] });
  const decoded = (turns: number[][]): { r: Float32Array; at: number } => {
    const [clip] = decodeClips(encodeClips(data, [clipOf(turns)]).buffer as ArrayBuffer, skeleton);
    expect(clip!.rKind[1]).toBe(2);
    return { r: clip!.r, at: clip!.rAt[1]! };
  };
  const dot = (r: Float32Array, a: number, b: number): number => r[a]! * r[b]! + r[a + 1]! * r[b + 1]! + r[a + 2]! * r[b + 2]! + r[a + 3]! * r[b + 3]!;

  it("face the same way as the turn before them, whichever way their maker signed them (a line between a turn and its negative would go the long way round)", () => {
    const { r, at } = decoded([turn(0.1, 1), turn(0.2, -1), turn(0.3, 1), turn(0.4, -1)]);
    for (let f = 1; f < 4; f++) expect(dot(r, at + f * 4, at + (f - 1) * 4), `frame ${f}`).toBeGreaterThan(0.99);
  });

  it("start facing the way the bone's rest does, so that a fade from a clip into another ends in the same signs (the first turn is written as the negative of the rest's side here)", () => {
    const { r, at } = decoded([turn(0.1, -1), turn(0.2, -1), turn(0.3, -1)]);
    // (the rest is 0 0 0 1: a turn facing the same way has a positive w)
    for (let f = 0; f < 3; f++) expect(r[at + f * 4 + 3]!, `frame ${f}`).toBeGreaterThan(0);
  });
});

describe("the director", () => {
  const mesh = decodeMesh(meshFile());
  const skeleton = new Skeleton(mesh.skeleton);
  const clips = decodeClips(clipsFile(), skeleton);
  const POSTURES: EngineClip[] = ["stand", "walk", "run", "sit", "loaf", "curl", "crouch", "jump", "stretch", "yawn", "groom", "pet", "point", "scratch", "knead", "sniff", "stalk", "wiggle", "peek", "tap", "swat", "doze", "shift"];

  const bonesOf = (director: Director): Float32Array => {
    const out = new Float32Array(skeleton.count * 12);
    solve(skeleton, director.pose, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], out, director.adjust);
    return out;
  };

  it("keeps every bone's numbers finite, and no bone turned inside out, in every posture the engine has", () => {
    const director = new Director(skeleton, clips);
    for (const clip of POSTURES) {
      const s = solvedIn({ clip, progress: 0.3, drowsy: clip === "curl" ? 1 : 0, odometer: 40 });
      for (let k = 0; k < 20; k++) director.update(s, 1 / 60, 100, 0.8);
      const out = bonesOf(director);
      for (let i = 0; i < out.length; i++) expect(Number.isFinite(out[i]!), `${clip} number ${i}`).toBe(true);
      for (let bone = 0; bone < skeleton.count; bone++) {
        const m = (k: number): number => out[bone * 12 + k]!;
        const det = m(0) * (m(5) * m(10) - m(6) * m(9)) - m(1) * (m(4) * m(10) - m(6) * m(8)) + m(2) * (m(4) * m(9) - m(5) * m(8));
        expect(det, `${clip} bone ${skeleton.names[bone]}`).toBeGreaterThan(0.9);
      }
    }
  });

  it("walks by the ground covered: a stride later the cat is in the same pose, and half of it later the legs have changed places", () => {
    const walk = clips.find((c) => c.name === "walk")!;
    const px = 100;
    const at = (odometer: number): Float32Array => {
      const director = new Director(skeleton, clips);
      const s = solvedIn({ clip: "walk", odometer, vx: 150 });
      // (settled in the walk first, so that no fade is left in the pose)
      for (let k = 0; k < 120; k++) director.update({ ...s, frame: { ...s.frame, odometer }, dt: 1 / 60 }, 1 / 60, px, 0);
      return bonesOf(director);
    };
    const a = at(300);
    const b = at(300 + walk.stride * px);
    const c = at(300 + 0.5 * walk.stride * px);
    let same = 0;
    let half = 0;
    for (let i = 0; i < a.length; i++) {
      same = Math.max(same, Math.abs(a[i]! - b[i]!));
      half = Math.max(half, Math.abs(a[i]! - c[i]!));
    }
    expect(same).toBeLessThan(0.02);
    expect(half).toBeGreaterThan(0.1);
  });

  it("passes from one clip to the next without a jump: a pose never moves a bone further in one picture than a cat can", () => {
    const director = new Director(skeleton, clips);
    const walking = solvedIn({ clip: "walk", odometer: 100, vx: 150 });
    const standing = solvedIn({ clip: "stand" });
    for (let k = 0; k < 30; k++) director.update(walking, 1 / 60, 100, 0);
    let before = Float32Array.from(director.pose.r);
    let worst = 0;
    for (let k = 0; k < 60; k++) {
      director.update(standing, 1 / 60, 100, 0);
      for (let i = 0; i < before.length; i++) worst = Math.max(worst, Math.abs(director.pose.r[i]! - before[i]!));
      before = Float32Array.from(director.pose.r);
    }
    expect(worst).toBeLessThan(0.12);
  });

  it("opens the jaw and leans the ears when the face says so, and turns the head with the yaw it is given", () => {
    const s = solvedIn({ clip: "stand" });
    const face = (jaw: number, ear: number): Solved => ({ ...s, head: { ...s.head, jaw, earL: ear, earR: ear, rot: 0 } });
    /** The bones after a picture with the face shut and one with `second` (the stand is not still: a sixtieth of a second later the body has moved a little of its own accord). */
    const after = (second: Solved, yaw: number): Float32Array => {
      const director = new Director(skeleton, clips);
      director.update(face(0, 0), 1 / 60, 100, 0);
      director.update(second, 1 / 60, 100, yaw);
      return bonesOf(director);
    };
    const control = after(face(0, 0), 0);
    const open = after(face(1, 0.8), 0.9);
    const differs = (bone: string): number => {
      const j = skeleton.bone(bone);
      let d = 0;
      for (let k = 0; k < 12; k++) d = Math.max(d, Math.abs(control[j * 12 + k]! - open[j * 12 + k]!));
      return d;
    };
    expect(differs("jaw")).toBeGreaterThan(0.3);
    expect(differs("earL")).toBeGreaterThan(0.1);
    expect(differs("earR")).toBeGreaterThan(0.1);
    expect(differs("head")).toBeGreaterThan(0.3);
    expect(differs("Hips")).toBeLessThan(1e-4);
  });

  it("says which postures the clips do not cover (they show the skeleton's rest, and a test can tell the file is not whole)", () => {
    const director = new Director(skeleton, clips);
    for (const clip of POSTURES) director.update(solvedIn({ clip }), 1 / 60, 100, 0);
    expect(director.missing.has("walk")).toBe(false);
    expect(director.missing.has("stand")).toBe(clips.every((c) => c.name !== "stand"));
  });
});

describe("the pitch of the body", () => {
  const at = (m: Float64Array, x: number, y: number): { x: number; y: number } => ({ x: m[0]! * x + m[1]! * y + m[3]!, y: m[4]! * x + m[5]! * y + m[7]! });

  it("is a turn about the middle of the body, which stays where it is: a cat that tips over in a hand does not swing off to the side (the carried cat once hung 0.4 of its length from the hand)", () => {
    for (const angle of [-1.2, -0.4, 0, 0.7, 1.2]) {
      const m = pitchAbout(mat(), angle, 0.4);
      const middle = at(m, 0, 0.4);
      expect(middle.x, `angle ${angle}`).toBeCloseTo(0, 9);
      expect(middle.y, `angle ${angle}`).toBeCloseTo(0.4, 9);
      // (a turn: a point a body length in front of the middle goes round it on a circle of that radius)
      const nose = at(m, 1, 0.4);
      expect(nose.x, `angle ${angle}`).toBeCloseTo(Math.cos(angle), 9);
      expect(nose.y - 0.4, `angle ${angle}`).toBeCloseTo(Math.sin(angle), 9);
    }
  });
});
