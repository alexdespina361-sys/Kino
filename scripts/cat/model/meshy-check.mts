// Looks at the free cat model with the skeleton it is fitted to drawn over it, and with each point coloured by the bones that carry it (the blend of the bones' colours, by weight).
//   node meshy-check.mts MODEL.glb OUT.png [view:cx:cy:scale[:rest|weights|both],...]
import { loadSkinned } from "../glb/skinned.mts";
import { fit, vertexColours } from "../glb/fit.mts";
import { renderSoup, writePng, type Shot } from "../glb/raster.mts";
import { BONE_COUNT } from "../../../src/client/cat/render/gl/skeleton";
import { MESHY_REST } from "./meshy-rest.mts";
import { skinPoints } from "./meshy-skin.mts";

type Rgb = [number, number, number];

/** A colour for each bone: the tail runs through the hues so that neighbouring pieces can be told apart. */
function palette(): Rgb[] {
  const out: Rgb[] = [];
  const hsv = (h: number, s: number, v: number): Rgb => {
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    return ([[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6]!) as Rgb;
  };
  for (let b = 0; b < BONE_COUNT; b++) {
    if (b < 5) out.push(hsv(0.58, 0.25 + 0.12 * b, 0.55 + 0.1 * b)); // body stations: blues, darker to lighter
    else if (b === 5) out.push([0.2, 0.8, 0.8]); // neck
    else if (b === 6) out.push([1, 0.85, 0.2]); // head
    else if (b === 7) out.push([1, 0.4, 0.8]); // ears
    else if (b === 8) out.push([0.9, 0.2, 0.6]);
    else if (b === 9) out.push([1, 0.5, 0.1]); // jaw
    else if (b < 22) {
      const leg = Math.floor((b - 10) / 3);
      const base = [0.33, 0.4, 0.08, 0.15][leg]!;
      out.push(hsv(base, 0.9, 0.55 + 0.2 * ((b - 10) % 3)));
    } else out.push(hsv(((b - 22) * 0.1 + 0.02) % 1, 0.85, b % 2 ? 1 : 0.7));
  }
  return out;
}

if (process.argv[1]?.endsWith("meshy-check.mts")) {
  const m = loadSkinned(process.argv[2]!);
  const f = fit(m);
  const col = vertexColours(m);
  const nV = f.pos.length / 3;
  const { skin, weight, dominant } = skinPoints(f.pos, m.tri, MESHY_REST);
  const pal = palette();
  const wcol = new Float64Array(nV * 3);
  for (let v = 0; v < nV; v++) {
    for (let k = 0; k < 4; k++) {
      const w = weight[v * 4 + k]! / 255;
      const c = pal[skin[v * 4 + k]!]!;
      for (let i = 0; i < 3; i++) wcol[v * 3 + i]! += w * c[i]!;
    }
  }
  const R = MESHY_REST;
  const marks = (): NonNullable<Shot["marks"]> => {
    const out: NonNullable<Shot["marks"]> = [];
    R.stations.forEach((s, i) => {
      out.push({ p: [s.top[0], s.top[1], 0], text: `t${i}`, color: [80, 200, 255] });
      out.push({ p: [s.bottom[0], s.bottom[1], 0], text: `b${i}`, color: [80, 200, 255] });
    });
    out.push({ p: [R.head[0], R.head[1], 0], text: "head", color: [255, 220, 60] });
    for (const key of ["fn", "ff", "hn", "hf"] as const) {
      const L = R.legs[key];
      const c: Rgb = key === "fn" || key === "hn" ? [120, 255, 120] : [60, 160, 60];
      for (const [name, p] of [["r", L.root], ["m", L.mid], ["h", L.hock], ["t", L.toe]] as const) out.push({ p: [p[0], p[1], L.z], text: `${key}${name}`, color: c });
    }
    R.tail.forEach((p, i) => out.push({ p: [p[0], p[1], 0], text: String(i), color: [255, 140, 60] }));
    for (const e of R.ears) {
      out.push({ p: [...e.base], text: "eb", color: [255, 120, 220] });
      out.push({ p: [...e.tip], text: "et", color: [255, 120, 220] });
    }
    out.push({ p: [...R.jawHinge], text: "jaw", color: [255, 255, 255] });
    return out;
  };
  const spec = (process.argv[4] ?? "side:-0.3:0.45:850:both").split(",");
  const W = 1000, H = 760;
  const sheetImg = new Uint8Array(W * spec.length * H * 4);
  spec.forEach((s, i) => {
    const [view, cx, cy, sc, what] = s.split(":");
    const shot: Shot = {
      view: view as Shot["view"],
      scale: Number(sc),
      centre: [Number(cx), Number(cy)],
      width: W,
      height: H,
      grid: 0,
      label: s,
      marks: what === "weights" ? [] : marks(),
    };
    const colour = what === "weights" ? wcol : col;
    const img = renderSoup({ pos: f.pos, tri: m.tri, color: colour, normal: f.nor }, shot);
    for (let y = 0; y < H; y++) sheetImg.set(img.subarray(y * W * 4, (y + 1) * W * 4), (y * W * spec.length + i * W) * 4);
  });
  writePng(process.argv[3]!, sheetImg, W * spec.length, H);
  // how the points divide between the bones
  const count = new Float64Array(BONE_COUNT);
  for (let v = 0; v < nV; v++) count[dominant[v]!]!++;
  console.log("dominant bone, points:", Array.from(count, (c, b) => `${b}:${c}`).join(" "));
}
