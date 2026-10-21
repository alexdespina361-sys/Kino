import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CatFrame } from "../../types";
import { CatRig, type Joint, type Solved } from "../rig";
import { decodeMesh, encodeMesh, MESH_MAGIC, MESH_VERSION, packIndex, unpackIndex } from "./format";
import { BONE, BONE_COUNT, BONE_FLOATS, Skeleton, mat, restSolved, restStamp } from "./skeleton";

const meshFile = (): ArrayBuffer => {
  const file = readFileSync(new URL("./cat.mesh", import.meta.url));
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
};

const frame = (over: Partial<CatFrame>): CatFrame => ({ x: 0, y: 0, facing: 1, clip: "stand", clipTime: 0, progress: 0, odometer: 0, vx: 0, vy: 0, grounded: true, viewer: false, drowsy: 0, energy: 0.3, appear: 1, petted: false, ...over });

/** A cat in a clip, settled: what the rig has after a second of it. */
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

  it("gives every vertex bones that exist, and weights that make a whole", () => {
    for (let i = 0; i < mesh.count; i++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        const w = mesh.weight[i * 4 + k]!;
        sum += w;
        if (w > 0) expect(mesh.skin[i * 4 + k]!).toBeLessThan(BONE_COUNT);
      }
      expect(sum).toBe(255);
    }
  });

  it("has normals that point somewhere (unit length, to the precision of a byte)", () => {
    for (let i = 0; i < mesh.count; i++) {
      const len = Math.hypot(mesh.normal[i * 3]!, mesh.normal[i * 3 + 1]!, mesh.normal[i * 3 + 2]!) / 127;
      expect(len).toBeGreaterThan(0.95);
      expect(len).toBeLessThan(1.05);
    }
  });

  it("was made around the rest pose the bones have now (a new rig needs a new mesh: scripts/cat/model/build.mts)", () => {
    expect(mesh.rest).toBe(restStamp());
  });

  it("is refused when it is not a cat mesh of this version, or is cut short", () => {
    const broken = (patch: (view: DataView) => void): ArrayBuffer => {
      const copy = data.slice(0);
      patch(new DataView(copy));
      return copy;
    };
    expect(() => decodeMesh(broken((v) => v.setUint32(0, 0, true)))).toThrow(/not a cat mesh/);
    expect(() => decodeMesh(broken((v) => v.setUint32(4, MESH_VERSION + 1, true)))).toThrow(/another version/);
    expect(() => decodeMesh(data.slice(0, 3000))).toThrow(/cut short/);
    expect(() => decodeMesh(new ArrayBuffer(8))).toThrow(/not a cat mesh/);
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

  it("go through a whole mesh file and come out whole", () => {
    const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const bytes = encodeMesh({
      bounds: [0, 0, 0, 1, 1, 1],
      rest: 77,
      pos,
      normal: new Int8Array(12).fill(64),
      skin: new Uint8Array(16),
      weight: new Uint8Array(16).fill(1),
      paint: new Uint8Array(16).fill(9),
      index: [0, 1, 2, 0, 2, 3],
    });
    const mesh = decodeMesh(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    expect(mesh.count).toBe(4);
    expect(mesh.rest).toBe(77);
    expect(Array.from(mesh.index)).toEqual([0, 1, 2, 0, 2, 3]);
    expect(mesh.pos[3]!).toBeCloseTo(1, 3);
    expect(mesh.pos[7]!).toBeCloseTo(1, 3);
    expect(Array.from(mesh.paint.slice(0, 4))).toEqual([9, 9, 9, 9]);
  });
});

describe("the bones of the solid cat", () => {
  const skeleton = new Skeleton();
  const bones = (s: Solved, headYaw = 0): Float32Array => {
    const out = new Float32Array(BONE_COUNT * BONE_FLOATS);
    skeleton.solve(s, headYaw, mat(), out);
    return out;
  };
  const apply = (out: Float32Array, bone: number, p: Joint): Joint => ({
    x: out[bone * 12]! * p.x + out[bone * 12 + 1]! * p.y + out[bone * 12 + 3]!,
    y: out[bone * 12 + 4]! * p.x + out[bone * 12 + 5]! * p.y + out[bone * 12 + 7]!,
  });
  const flipped = (j: Joint): Joint => ({ x: j.x, y: -j.y });
  const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

  it("leave the mesh as it is when the cat is as it was made: standing", () => {
    const out = bones(restSolved());
    const still = [...Array(5).keys()].map((i) => BONE.f0 + i).concat([BONE.neck, BONE.fnU, BONE.fnL, BONE.fnP, BONE.ffU, BONE.hnU, BONE.hnL, BONE.hnP, BONE.hfU]);
    for (let i = 0; i < TAIL(); i++) still.push(BONE.tail0 + i);
    for (const bone of still) {
      for (let k = 0; k < 12; k++) expect(out[bone * 12 + k]!, `bone ${bone}, number ${k}`).toBeCloseTo(IDENTITY[k]!, 3);
    }
  });

  it("carry each piece of a leg to where the rig has it, in any posture, and put the paw where the toe is (the paw is never off the floor)", () => {
    for (const clip of ["sit", "crouch", "walk", "loaf", "stretch"] as const) {
      const s = solvedIn({ clip, progress: 0.4 });
      const out = bones(s);
      const rest = skeleton.restUp.legs;
      for (const [key, first] of [["fn", BONE.fnU], ["ff", BONE.ffU], ["hn", BONE.hnU], ["hf", BONE.hfU]] as const) {
        const now = { root: flipped(s.legs[key].root), mid: flipped(s.legs[key].mid), hock: flipped(s.legs[key].hock), toe: flipped(s.legs[key].toe) };
        const near = (bone: number, from: Joint, to: Joint, within: number): void => {
          const at = apply(out, bone, from);
          expect(Math.hypot(at.x - to.x, at.y - to.y), `${clip} ${key} bone ${bone}`).toBeLessThan(within);
        };
        // the thigh and the shin keep their length: both ends are where the rig has them
        near(first, rest[key].root, now.root, 1e-3);
        near(first, rest[key].mid, now.mid, 1e-3);
        near(first + 1, rest[key].mid, now.mid, 1e-3);
        near(first + 1, rest[key].hock, now.hock, 1e-3);
        // the foot is as long as the rig makes it (a cat that sits has a long one); the toe is on the toe, and the other end is left to the skin
        near(first + 2, rest[key].toe, now.toe, 1e-3);
        near(first + 2, rest[key].hock, now.hock, 0.12);
      }
    }
  });

  it("carry each piece of the tail to where the rig has it", () => {
    const s = solvedIn({ clip: "sit" });
    const out = bones(s);
    for (let i = 0; i < TAIL(); i++) {
      // (a piece starts where the rig's joint is; it ends there too unless the rig asks for more stretch than a piece is allowed)
      for (const [j, within] of [[i, 2e-3], [i + 1, 0.05]] as const) {
        const at = apply(out, BONE.tail0 + i, skeleton.restUp.tail[j]!);
        const to = flipped(s.tail[j]!);
        expect(Math.hypot(at.x - to.x, at.y - to.y), `piece ${i}, joint ${j}`).toBeLessThan(within);
      }
    }
  });

  it("keep every number finite and the body from being turned inside out, in every posture the cat has", () => {
    for (const clip of ["stand", "walk", "sit", "loaf", "curl", "crouch", "stretch", "groom", "yawn", "scratch", "knead", "sniff", "stalk", "wiggle"] as const) {
      const out = bones(solvedIn({ clip, progress: 0.3, drowsy: clip === "curl" ? 1 : 0 }), 0.8);
      for (let i = 0; i < out.length; i++) expect(Number.isFinite(out[i]!), `${clip} number ${i}`).toBe(true);
      for (let bone = 0; bone < BONE_COUNT; bone++) {
        // the part of a bone that turns and stretches (its 3 x 3) keeps its handedness
        const m = (k: number): number => out[bone * 12 + k]!;
        const det = m(0) * (m(5) * m(10) - m(6) * m(9)) - m(1) * (m(4) * m(10) - m(6) * m(8)) + m(2) * (m(4) * m(9) - m(5) * m(8));
        expect(det, `${clip} bone ${bone}`).toBeGreaterThan(0.05);
      }
    }
  });
});

function TAIL(): number {
  return 10;
}
