import { EAR_SHAPE } from "./model";
import { LIP_GLSL, MOUTH } from "./mouth";

/**
 * The shaders of the solid cat. The vertex shader skins the mesh (up to four bones a point) and puffs the points out along their normals for the
 * shells of the fur; the fragment shader paints the cat from where a point stood in the rest (so that the stripes, the white socks and the
 * face stay on the body as it moves), and lights it.
 */

export const VERTEX = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aNor;
attribute vec4 aSkin;
attribute vec4 aWgt;
attribute vec4 aPaint;
uniform vec4 uBones[96];
uniform vec4 uProj;
uniform float uShell;
uniform float uShells;
uniform float uFurLen;
varying vec3 vRest;
varying vec3 vRN;
varying vec3 vN;
varying vec3 vFlow;
varying vec4 vPaint;
varying float vBone;
varying float vFar;
void main() {
  vec3 p = vec3(0.0);
  vec3 n = vec3(0.0);
  vec3 fl = vec3(0.0);
  vec4 q = vec4(aPos, 1.0);
  // which way the hair lies where this point stood in the rest: down a leg, out along the tail, back along the body
  float limb = aPaint.a;
  float onTail = limb * step(aPos.x, -0.43) * step(0.42, aPos.y);
  vec3 flowRest = mix(vec3(-0.92, -0.3, 0.0), vec3(0.0, -1.0, 0.0), limb * (1.0 - onTail));
  flowRest = mix(flowRest, normalize(vec3(aPos.x + 0.46, aPos.y - 0.47, 0.0) + vec3(0.001)), onTail);
  float top = -1.0;
  float lead = 0.0;
  float far = 0.0;
  for (int i = 0; i < 4; i++) {
    float w = aWgt[i];
    if (w > 0.0) {
      float id = aSkin[i];
      int b = int(id + 0.5) * 3;
      vec4 r0 = uBones[b];
      vec4 r1 = uBones[b + 1];
      vec4 r2 = uBones[b + 2];
      p += w * vec3(dot(r0, q), dot(r1, q), dot(r2, q));
      n += w * vec3(dot(r0.xyz, aNor), dot(r1.xyz, aNor), dot(r2.xyz, aNor));
      fl += w * vec3(dot(r0.xyz, flowRest), dot(r1.xyz, flowRest), dot(r2.xyz, flowRest));
      if (w > top) { top = w; lead = id; }
      // the legs on the far side of the body (bones 13..15 and 19..21): they are seen darker, as what is further from the light and the eye is
      if ((id > 12.5 && id < 15.5) || (id > 18.5 && id < 21.5)) far += w;
    }
  }
  vFar = far;
  n = normalize(n);
  // the fur: each shell is a layer further out (h is how far up the hair it is, 0 to 1), the hair is as long as this part of the cat's is, and it sags
  // a little towards the floor and lies along the way it grows
  float h = uShell / max(uShells, 1.0);
  float fur = aPaint.g * 2.55;
  vec3 tang = normalize(fl - n * dot(fl, n) + vec3(0.0001));
  p += n * (h * uFurLen * fur * 0.8) + tang * (h * h * uFurLen * fur * 1.1);
  p.y -= h * h * uFurLen * fur * 0.25;
  vRest = aPos;
  vRN = aNor;
  vN = n;
  vFlow = tang;
  vPaint = aPaint;
  vBone = lead;
  gl_Position = vec4(p.x * uProj.x + uProj.z, p.y * uProj.y + uProj.w, -p.z * 0.4, 1.0);
}
`;

export const FRAGMENT = /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec3 vRest;
varying vec3 vRN;
varying vec3 vN;
varying vec3 vFlow;
varying vec4 vPaint;
varying float vBone;
varying float vFar;
uniform float uShell;
uniform float uShells;
uniform float uFreq;
uniform float uAppear;
uniform float uDebug;
uniform float uWhisker;
uniform vec3 uHead;
uniform vec4 uEyes;
uniform vec4 uEyes2;
uniform vec3 uKey;
uniform vec3 uFill;
uniform vec3 uEarA[8];

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
/** smoothstep that also takes its edges the wrong way round (the built-in one is not defined for that). */
float sstep(float a, float b, float x) {
  float t = clamp((x - a) / (b - a), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

${LIP_GLSL}

/**
 * The inside of the mouth, painted on the band of skin between the lips (the jaw stretches it when it drops): the colour, and in a how much of the point it
 * is. v runs from +1 at the upper lip to -1 at the lower one, in the rest, so a stretched band is painted from one lip to the other whatever its size.
 */
vec4 mouthInside(vec3 h, float open, out float depth) {
  float v = (h.y - lipY(h.x, h.z)) / ${MOUTH.band.toFixed(4)};
  float inBand = sstep(1.55, 1.05, abs(v));
  float region = sstep(0.045, 0.065, h.x) * sstep(0.172, 0.152, h.x) * sstep(0.074, 0.06, abs(h.z));
  float a = inBand * region * sstep(0.03, 0.12, open);
  depth = sstep(0.15, 0.06, h.x);
  float az = abs(h.z);
  // the roof of the mouth and the throat: red at the lips, dark deeper in
  vec3 col = mix(vec3(0.66, 0.2, 0.22), vec3(0.21, 0.03, 0.045), clamp(0.3 + 0.7 * depth + 0.25 * (1.0 - abs(v)), 0.0, 1.0));
  // the tongue: pink, rising from the lower lip, with a groove down its middle
  float tongue = sstep(-0.1, -0.7, v) * sstep(0.05, 0.03, az) * sstep(0.162, 0.128, h.x);
  vec3 tc = mix(vec3(0.96, 0.54, 0.58), vec3(0.78, 0.34, 0.4), sstep(0.004, 0.0, az) * 0.8);
  col = mix(col, tc * (0.75 + 0.25 * (1.0 - depth)), tongue);
  // the fangs: a white point from each lip, at each side of the front
  float upper = sstep(0.0085 * (1.0 - clamp((0.95 - v) / 0.85, 0.0, 1.0)) + 0.0005, 0.0, abs(h.x - 0.119)) * sstep(0.0095, 0.004, abs(az - 0.031)) * step(0.1, v);
  float lower = sstep(0.0065 * (1.0 - clamp((0.95 + v) / 0.6, 0.0, 1.0)) + 0.0005, 0.0, abs(h.x - 0.113)) * sstep(0.008, 0.003, abs(az - 0.027)) * step(v, -0.35);
  col = mix(col, vec3(0.97, 0.94, 0.88), max(upper, lower));
  return vec4(col, a);
}

// the coat (see coats.ts): the colours, and how much of each marking this cat has (stripes, white, a tuxedo's white, patches)
uniform vec3 uBase;
uniform vec3 uLight;
uniform vec3 uStripeC;
uniform vec3 uWhiteC;
uniform vec3 uPatchA;
uniform vec3 uPatchB;
uniform vec4 uCoat;
const vec3 PINK = vec3(0.95, 0.60, 0.60);

/** Whether a hair with the random number own takes a marking of strength t (0 takes none, 1 takes all): the edge of a marking is a scatter of hairs. */
float hairs(float t, float own) {
  return sstep(own * 0.8, own * 0.8 + 0.22, clamp(t * 1.15, 0.0, 1.0));
}

/** How much of a point is the tabby's stripe (0..1), from where it stood in the rest. */
float stripes(vec3 p, float limb, float u) {
  float onLimb = sstep(0.35, 0.75, limb);
  float tail = onLimb * step(p.x, -0.43) * step(0.42, p.y);
  float leg = onLimb * (1.0 - tail);
  // (the other side of the cat has stripes of its own)
  float side = p.z < 0.0 ? 7.3 : 0.0;
  // the ribs: stripes that come down from the spine and lean back as they go down, in a sweep that follows the ribs (forward at the shoulders, back at the
  // hips) and wanders a little. Each has a place, a thickness and a length of its own: they are not a comb. They are thickest at the spine, thin out as they
  // go down, and some stop short of the belly; a few split in two near the top.
  float drop = 0.63 - p.y;
  float sweep = mix(0.2, 0.05, sstep(-0.35, 0.3, p.x)) * drop;
  float warp = 0.03 * sin(p.y * 11.0 + p.x * 6.0 + side) + 0.04 * (noise(p * vec3(7.0, 5.0, 7.0) + side) - 0.5) + 0.011 * sin(p.x * 37.0 + 2.0);
  float x = (p.x + sweep + warp) * 13.5 + 0.5;
  float cell = floor(x);
  float own = hash(vec3(cell, 1.7 + side, 3.1));
  float own2 = hash(vec3(cell, 8.3 + side, 6.1));
  float own3 = hash(vec3(cell, 2.9 + side, 9.7));
  float centre = 0.5 + (own3 - 0.5) * 0.34;
  float band = abs(fract(x) - centre);
  float thick = (0.16 + 0.13 * own) * (1.0 - 0.5 * sstep(0.02, 0.26, drop));
  float st = sstep(thick, thick * 0.35, band);
  // the lower part of a stripe fades out where it stops (some stop higher than others)
  float reach = 0.1 + 0.2 * own2;
  st *= sstep(reach + 0.1, reach - 0.02, drop);
  // a split near the top: a second, thinner stripe beside the first
  float split = sstep(0.11, 0.07, abs(fract(x * 2.1 + own * 4.0) - 0.5)) * sstep(0.12, 0.02, drop) * step(0.55, own3);
  st = max(st, split * 0.7);
  st *= 0.78 + 0.22 * noise(p * 23.0 + side);
  // the line down the spine
  float spine = sstep(0.05 + 0.012 * sin(p.x * 31.0), 0.012, abs(p.z)) * sstep(0.56, 0.61, p.y) * (0.65 + 0.35 * noise(p * 14.0));
  st = max(st, spine * 0.85);
  st *= 1.0 - onLimb;
  // the legs: bars that wrap them (a few, uneven, not reaching the paws), the tail: rings, thicker near the tip, which is dark
  float barPhase = u * 5.0 + 0.1 + 0.12 * sin(u * 23.0 + p.x * 9.0);
  float bars = mix(sstep(0.16, 0.07, abs(fract(barPhase) - 0.5)) * sstep(0.02, 0.3, u) * 0.85,
                   sstep(0.15, 0.06, abs(fract(u * 4.0 + 0.1 + 0.1 * sin(u * 19.0)) - 0.5)) * sstep(0.1, 0.25, u) * 0.85, step(0.0, p.x));
  float ringPhase = u * 8.5 + 0.2 * sin(u * 15.0 + 1.0) - 0.1;
  float rings = max(sstep(0.3, 0.18, abs(fract(ringPhase) - 0.5) + 0.04 * (1.0 - u)) * 0.95, sstep(0.84, 0.92, u));
  st = max(st, leg * bars);
  st = max(st, tail * rings);
  return clamp(st, 0.0, 1.0);
}

/** How much of a point is the inside of an ear, and whether it is an ear at all. */
float earInside(vec3 p, out float onEar) {
  float inside = 0.0;
  onEar = 0.0;
  for (int e = 0; e < 2; e++) {
    vec3 d = p - uEarA[e * 4];
    float ta = dot(d, uEarA[e * 4 + 1]);
    float ts = dot(d, uEarA[e * 4 + 2]);
    float tc = dot(d, uEarA[e * 4 + 3]);
    float width = mix(${EAR_SHAPE[1].toFixed(4)}, ${EAR_SHAPE[2].toFixed(4)}, clamp(ta / ${EAR_SHAPE[0].toFixed(4)}, 0.0, 1.0));
    float on = step(-0.012, ta) * step(ta, ${(EAR_SHAPE[0] + EAR_SHAPE[2]).toFixed(4)}) * step(abs(ts), width + 0.012) * step(abs(tc), 0.055);
    float in_ = sstep(0.0, 0.01, tc) * sstep(width * 0.82, width * 0.5, abs(ts)) * sstep(0.01, 0.04, ta) * sstep(${(EAR_SHAPE[0] * 0.96).toFixed(4)}, ${(EAR_SHAPE[0] * 0.72).toFixed(4)}, ta);
    onEar = max(onEar, on);
    inside = max(inside, in_ * on);
  }
  return inside;
}

/** One eye, painted on a point of the face: q is the place in the eye (across, up), o how open it is. */
vec4 eye(vec2 q, float o, vec2 gaze) {
  const float A = 0.037;
  const float B = 0.027;
  q.y -= 0.17 * q.x;
  float uu = q.x / A;
  // (the corner next to the nose is the more pointed one, the outer corner is rounder)
  float hh = B * pow(max(1.0 - pow(abs(uu), uu < 0.0 ? 2.0 : 2.6), 0.0), 0.72);
  float openH = hh * o;
  float closed = max(uEyes2.z, uEyes.w);
  // the lid line of a closed eye: lifted when content, lowered when asleep
  float bow = (uEyes.w > 0.5 ? 0.012 : -0.006) * (1.0 - uu * uu);
  float line = sstep(0.0036, 0.0014, abs(q.y - bow)) * sstep(1.0, 0.86, abs(uu));
  if (closed > 0.5) return vec4(0.13, 0.07, 0.045, line);
  float inside = sstep(0.0018, -0.0018, abs(q.y) - openH) * sstep(1.0, 0.92, abs(uu)) * sstep(0.0012, 0.0035, openH);
  vec2 d = q - gaze * vec2(0.011, 0.008);
  float r = length(d);
  float ang = atan(d.y, d.x);
  // the iris: gold round the pupil, green out to a dark ring at its edge, with fibres running out from the pupil
  float fib = noise(vec3(ang * 4.0, r * 70.0, 1.7)) * 0.6 + noise(vec3(ang * 9.0, r * 140.0, 5.1)) * 0.4;
  vec3 iris = mix(vec3(0.99, 0.8, 0.24), vec3(0.76, 0.7, 0.16), sstep(0.005, 0.018, r));
  iris = mix(iris, vec3(0.42, 0.48, 0.11), sstep(0.016, 0.029, r));
  iris *= 0.78 + 0.44 * fib;
  iris = mix(iris, vec3(0.05, 0.08, 0.03), sstep(0.025, 0.034, r));
  float pw = mix(0.0026, 0.017, uEyes.z);
  float pup = sstep(1.0, 0.62, length(vec2(d.x / pw, d.y / 0.026)));
  // (the white of a cat's eye is mostly lid: what shows of it, in the corners, is in shade, and the corner by the nose is pink)
  vec3 corner = mix(vec3(0.42, 0.26, 0.2), vec3(0.78, 0.46, 0.44), sstep(-0.01, -0.03, q.x));
  vec3 col = mix(corner, iris, sstep(0.036, 0.031, r));
  col = mix(col, vec3(0.01, 0.006, 0.006), pup);
  // the upper lid shades the eye, and the eye takes the light from the floor along its lower lid
  col *= 1.0 - 0.55 * sstep(0.05, 1.0, q.y / max(openH, 0.002));
  col += vec3(0.12, 0.1, 0.05) * sstep(-0.3, -1.0, q.y / max(openH, 0.002)) * (1.0 - pup);
  float glint = sstep(0.0075, 0.003, length(q - vec2(-0.011, 0.0105) - gaze * vec2(0.004, 0.003)));
  float glint2 = sstep(0.004, 0.0013, length(q - vec2(0.011, -0.009))) * 0.5;
  col = mix(col, vec3(1.0), max(glint, glint2) * 0.92);
  float rim = sstep(0.0046, 0.0012, abs(abs(q.y) - openH)) * sstep(1.0, 0.8, abs(uu));
  col = mix(col, vec3(0.1, 0.055, 0.03), rim * 0.92);
  float a = max(inside, rim * sstep(0.0012, 0.0035, openH) * 0.9);
  return vec4(col, a);
}

/** The painted face: returns the colour in rgb and how much it covers in a (the eyes, the nose, the mouth). */
vec4 face(vec3 h) {
  vec4 c = vec4(0.0);
  float front = sstep(0.035, 0.07, h.x);
  for (int e = 0; e < 2; e++) {
    float s = e == 0 ? 1.0 : -1.0;
    float o = e == 0 ? uEyes.x : uEyes.y;
    vec4 ec = eye(vec2((h.z - s * 0.062) * s, h.y - 0.018), o, uEyes2.xy);
    ec.a *= front;
    c = mix(c, vec4(ec.rgb, 1.0), ec.a);
  }
  // the nose: leather, a rounded triangle with its point down; lighter on top where it is wet, darker at its edge, with a nostril on each side
  float ny = (h.y + 0.03) / 0.03;
  float cy = clamp(ny, 0.0, 1.0);
  float nw = 0.021 * (0.38 + 0.62 * cy);
  float inNose = sstep(nw + 0.0015, nw - 0.0015, abs(h.z)) * sstep(-0.04, 0.1, ny) * sstep(1.1, 0.93, ny);
  inNose *= sstep(1.05, 0.78, length(vec2(h.z / 0.023, (h.y + 0.0125) / 0.0195)));
  float nose = inNose * sstep(0.12, 0.15, h.x);
  float nedge = sstep(0.62, 1.0, abs(h.z) / max(nw, 0.001)) * 0.5 + sstep(0.2, -0.05, ny) * 0.45;
  vec3 nc = mix(vec3(0.74, 0.38, 0.4), vec3(0.94, 0.62, 0.62), cy);
  nc = mix(nc, nc * vec3(0.62, 0.5, 0.52), nedge);
  float nostril = sstep(0.0042, 0.0016, length(vec2(abs(h.z) - 0.0105, (h.y + 0.0225) * 1.8)));
  nc = mix(nc, vec3(0.22, 0.09, 0.1), nostril * 0.85);
  nc += vec3(0.2) * sstep(0.006, 0.0015, length(vec2(h.z + 0.005, (h.y + 0.0045) * 1.5)));
  c = mix(c, vec4(nc, 1.0), nose);
  // the mouth: a line down from the nose, and a curve to each side that runs back to the corner (an open mouth is painted over it)
  float xin = sstep(0.055, 0.085, h.x);
  float phil = sstep(0.0024, 0.0009, abs(h.z)) * sstep(-0.056, -0.05, h.y) * sstep(-0.026, -0.032, h.y) * sstep(0.1, 0.13, h.x);
  float ym = lipY(h.x, h.z);
  float mouth = sstep(0.0026, 0.0009, abs(h.y - ym)) * sstep(0.056 + 0.03 * sstep(0.1, 0.05, h.x), 0.046 + 0.03 * sstep(0.1, 0.05, h.x), abs(h.z));
  c = mix(c, vec4(0.32, 0.16, 0.13, 1.0), max(phil, mouth) * xin * 0.62);
  // the whisker pads: two rows of three small dark spots on each side of the muzzle
  float sideZ = abs(h.z);
  float onPad = sstep(0.026, 0.034, sideZ) * sstep(0.074, 0.06, sideZ) * sstep(0.07, 0.082, h.x) * sstep(0.14, 0.128, h.x);
  float dots = 0.0;
  for (int i = 0; i < 6; i++) {
    float col = float(i - (i / 3) * 3);
    float fx = 0.09 + 0.015 * col;
    float fy = -0.039 - 0.012 * float(i / 3);
    dots = max(dots, sstep(0.0036, 0.0018, length(vec2(h.x - fx, h.y - fy))));
  }
  c = mix(c, vec4(0.36, 0.2, 0.15, 1.0), dots * onPad * 0.5);
  return c;
}

void main() {
  // the whiskers: a light line that fades towards its tip
  if (uWhisker > 0.5) {
    float wa = vPaint.r * 0.8 * uAppear;
    gl_FragColor = vec4(vec3(1.0, 0.97, 0.92) * wa, wa);
    return;
  }
  float limb = vPaint.a;
  float u = vPaint.b;
  vec3 p = vRest;
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;

  if (uDebug > 0.5) {
    vec3 d = vec3(0.5) + 0.5 * N;
    if (uDebug > 1.5 && uDebug < 2.5) d = vec3(vPaint.r);
    if (uDebug > 2.5) d = 0.5 + 0.5 * vec3(sin(vBone * 2.3), sin(vBone * 3.1 + 1.0), sin(vBone * 1.7 + 2.0));
    gl_FragColor = vec4(d, 1.0);
    return;
  }

  // the fur: each shell is one layer of the hair and keeps the places where a strand reaches that high. A strand stands where it was put on a lattice laid
  // in the rest (so it stays on the body as the body moves), has a length of its own and is thinner towards its tip; the lengths run in tufts, as a coat's do
  float cover = 1.0;
  float shellT = uShell / max(uShells, 1.0);
  float strandOwn = 0.5;
  if (uShell > 0.5) {
    vec3 q = p * uFreq;
    vec3 c = floor(q);
    vec3 f = q - c;
    vec3 jit = vec3(hash(c + 5.3), hash(c + 9.7), hash(c + 13.1));
    strandOwn = hash(c + 3.1);
    float tuft = noise(p * uFreq * 0.11 + 4.0);
    float len = clamp(0.3 + 0.62 * strandOwn + 0.4 * (tuft - 0.5), 0.15, 1.0);
    float dist = length(f - (0.2 + 0.6 * jit));
    float rad = 0.5 * (1.0 - 0.72 * shellT / len);
    cover = step(shellT, len) * sstep(rad, rad * 0.5, dist);
    // (seen edge-on the outer layers would be rows of dashes: they thin out there, and the inner layers make the edge soft)
    cover *= mix(1.0, sstep(0.02, 0.5, abs(N.z)), sstep(0.3, 0.9, shellT));
    if (cover < 0.01) discard;
  }

  vec3 h = p - uHead;
  float mouthDepth = 0.0;
  vec4 mo = vec4(0.0);
  // (only while the jaw is open, and only near the head)
  if (uEyes2.w > 0.03 && dot(h, h) < 0.05) mo = mouthInside(h, uEyes2.w, mouthDepth);
  // (there is no fur inside a mouth)
  if (uShell > 0.5 && mo.a > 0.04) discard;
  float onEar;
  float earIn = earInside(p, onEar);
  float onLimb = sstep(0.35, 0.75, limb);
  float tail = onLimb * step(p.x, -0.43) * step(0.42, p.y);
  float leg = onLimb * (1.0 - tail);
  float isHead = sstep(0.25, 0.2, length(h)) * sstep(-0.02, 0.01, h.x) * (1.0 - onEar);

  float tux = uCoat.z;
  vec3 alb = uBase;
  // the underside is the lighter colour (a tuxedo's white goes up the flank in a ragged line: it rises and falls along the body, and does not run the same on the two sides)
  float rag = 0.035 * (noise(p * 7.0) - 0.5) + tux * (0.045 * sin(p.x * 8.5 + 1.1 * sign(p.z + 0.001)) + 0.07 * (noise(p * vec3(2.6, 1.8, 2.6) + 11.0) - 0.5));
  // (a ginger's colours run into each other; a tuxedo's white has an edge, which is a scatter of hairs, one by one, in the layers of the fur)
  float edge = mix(0.045, 0.03, tux);
  float belly = sstep(0.375 + 0.07 * tux + edge, 0.375 + 0.07 * tux - edge, p.y + rag) * (1.0 - onLimb);
  float bellyH = (tux > 0.5 && uShell > 0.5) ? hairs(belly, strandOwn) : belly;
  alb = mix(alb, uLight, bellyH * mix(0.9, 1.0, tux));
  float st = stripes(p, limb, u) * (1.0 - sstep(0.235, 0.19, length(h * vec3(1.0, 0.85, 1.0)))) * uCoat.x;
  // (each hair is dark or light by itself: the edge of a marking is a scatter of hairs, not a line; the base layer is the smooth mean of them)
  float stH = uShell > 0.5 ? hairs(st, strandOwn) : st;
  alb = mix(alb, uStripeC, stH * (1.0 - belly * 0.8));

  // a patched coat: blotches of two colours over the back, the head and the tail, and not over the legs and the belly
  if (uCoat.w > 0.01) {
    float pa = noise(p * vec3(4.2, 4.8, 4.0) + 7.0) + 0.4 * noise(p * 12.0 + 1.0);
    float pb = noise(p * vec3(3.4, 4.0, 4.4) + 19.0) + 0.4 * noise(p * 11.0 + 5.0);
    float orangeP = sstep(0.8, 0.84, pa);
    float blackP = sstep(0.82, 0.86, pb) * (1.0 - orangeP);
    float where = max(sstep(0.3, 0.42, p.y) * (1.0 - onLimb), onLimb * sstep(0.28, 0.4, p.y)) * (1.0 - sstep(0.3, 0.24, length(h)));
    alb = mix(alb, uPatchA, orangeP * where * uCoat.w);
    alb = mix(alb, uPatchB, blackP * where * uCoat.w);
    // the face is not the same on both sides: one has an orange cap over its eye and ear, the other a black one, and a white strip is left between them
    float cap = sstep(0.27, 0.21, length(h)) * sstep(0.0, 0.03, h.y);
    alb = mix(alb, uPatchA, cap * sstep(0.014, 0.03, h.z) * uCoat.w);
    alb = mix(alb, uPatchB, cap * sstep(-0.014, -0.03, h.z) * uCoat.w);
  }

  // white: the chest, the chin and the muzzle, the socks (a tuxedo's boots go up the leg, and its blaze up the nose)
  float bib = 1.0 - sstep(mix(0.55, 0.85, tux), 1.0, length((p.xy - vec2(0.405, 0.43 - 0.03 * tux)) / (vec2(0.095, 0.16) * uCoat.y)));
  bib *= (1.0 - onLimb) * (1.0 - sstep(0.04, 0.09, abs(p.z) - 0.04));
  float white = bib;
  float pad = 1.0 - sstep(mix(0.72, 0.9, tux), 1.05, length((h - vec3(0.105, -0.052, 0.0)) / (vec3(0.075, 0.034, 0.066) * uCoat.y)));
  float chin = 1.0 - sstep(mix(0.72, 0.9, tux), 1.05, length((h - vec3(0.088, -0.084, 0.0)) / (vec3(0.058, 0.042, 0.05) * uCoat.y)));
  white = max(white, max(pad, chin) * mix(0.72, 0.96, tux) * isHead);
  float blazeW = 0.009 + 0.0011 * clamp((h.y + 0.02) / 0.01, 0.0, 10.0);
  float blaze = sstep(blazeW + 0.003, blazeW - 0.002, abs(h.z)) * sstep(0.0, 0.03, h.x) * sstep(0.115, 0.095, h.y) * sstep(-0.045, -0.02, h.y);
  white = max(white, blaze * isHead * tux);
  // the forehead's three strokes, and a line out from each eye along the cheek
  float inFront = sstep(-0.03, 0.03, h.x) * sstep(0.045, 0.075, h.y) * sstep(0.11, 0.08, h.y + max(0.0, -h.x) * 2.0);
  float stroke = max(sstep(0.0055, 0.002, abs(h.z)), max(sstep(0.0055, 0.002, abs(h.z - 0.03)), sstep(0.0055, 0.002, abs(h.z + 0.03))));
  alb = mix(alb, uStripeC, stroke * inFront * isHead * 0.7 * uCoat.x);
  float cheek = sstep(0.007, 0.002, abs(h.y - 0.005 + (abs(h.z) - 0.085) * 0.9)) * sstep(0.078, 0.1, abs(h.z)) * sstep(0.1, 0.04, h.x);
  alb = mix(alb, uStripeC, cheek * isHead * 0.3 * uCoat.x);
  float sock = 0.105 + 0.12 * tux;
  float sockEdge = mix(0.02, 0.008, tux);
  white = max(white, leg * sstep(sock + sockEdge, sock - sockEdge, p.y + rag * 1.2 * tux));
  white = max(white, leg * sstep(0.06, 0.035, p.y) * 2.0);
  // the ear: darker at the rim, pink inside
  alb = mix(alb, alb * 0.75, onEar * 0.4);
  // (the white and the pink have a scatter of hairs at their edge too)
  float whiteH = uShell > 0.5 ? hairs(white, strandOwn) : clamp(white, 0.0, 1.0);
  alb = mix(alb, uWhiteC, whiteH);
  alb = mix(alb, mix(PINK, vec3(1.0, 0.86, 0.8), 0.3), earIn);

  vec4 f = vec4(0.0);
  if (isHead > 0.5 && h.x > 0.03) f = face(h);
  if (uShell > 0.5 && f.a > 0.2) discard;
  alb = mix(alb, f.rgb, f.a);
  alb = mix(alb, mo.rgb, mo.a);
  // (black hair is not black all through: towards its tip it is warmer and lighter, strand by strand, which is what shows a black coat to be fur)
  float darkAlb = 1.0 - clamp(dot(alb, vec3(0.3, 0.55, 0.15)) * 2.6, 0.0, 1.0);
  alb += vec3(0.07, 0.042, 0.026) * darkAlb * pow(shellT, 1.4) * (0.5 + strandOwn) * (1.0 - f.a);

  // light: a warm key from above and the front, a cool fill from the sky; the fur holds light along its edges
  vec3 A = lin(alb);
  vec3 L = normalize(uKey);
  float wrap = clamp((dot(N, L) + 0.45) / 1.45, 0.0, 1.0);
  float key = wrap * wrap * (3.0 - 2.0 * wrap);
  float fill = clamp(dot(N, normalize(uFill)) * 0.5 + 0.5, 0.0, 1.0);
  float sky = N.y * 0.5 + 0.5;
  // (a face is shaded less by its hollows than a flank is: the muzzle and the chin would be grey)
  float ao = mix(mix(0.5, 0.76, isHead), 1.0, vPaint.r);
  ao *= 1.0 - 0.45 * mo.a * mouthDepth;
  // (the hair is darker where it leaves the skin and lighter at its tip, and each strand is a little lighter or darker than the next)
  // (a light coat has less to show between its hairs than a dark one: its strands are not as far apart in tone)
  float bright = clamp(dot(alb, vec3(0.3, 0.55, 0.15)) * 1.15, 0.0, 1.0);
  float root = uShell < 0.5 ? mix(0.66, 0.8, bright) : mix(mix(0.62, 0.78, bright), mix(1.1, 1.0, bright), pow(shellT, 0.6));
  root *= 0.94 + 0.12 * strandOwn;
  vec3 lit = A * (vec3(1.0, 0.94, 0.86) * key * 1.05 + vec3(0.66, 0.7, 0.8) * (0.2 + 0.26 * sky) * (0.6 + 0.4 * fill)) * ao * root;
  lit *= mix(1.0, 0.7, clamp(vFar, 0.0, 1.0));
  float rim = pow(1.0 - clamp(N.z, 0.0, 1.0), 2.2);
  lit += A * rim * 0.5 * (0.5 + 0.5 * key) + vec3(1.0, 0.85, 0.65) * rim * 0.06;
  // what the floor gives back to the underside: warm, so that a chin and a belly are not grey
  lit += A * vec3(0.95, 0.66, 0.42) * clamp(-N.y, 0.0, 1.0) * 0.3 * mix(0.6, 1.0, vPaint.r);
  // a coat has a soft sheen where the light grazes it
  float sheen = pow(clamp(dot(N, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0, 1.0), 14.0);
  lit += vec3(1.0, 0.88, 0.7) * sheen * 0.1 * (1.0 - st * 0.6) * (1.0 - white);
  // (and a band of light across the hair, where its strands are turned to the light: the way a coat shines)
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  // (the flow of two bones can cancel to nothing at a point, and the direction of nothing is not a number: a black dot)
  float flowLen = dot(vFlow, vFlow);
  float th = flowLen > 0.000001 ? dot(vFlow, H) * inversesqrt(flowLen) : 0.0;
  float strandShine = pow(sqrt(max(0.0, 1.0 - th * th)), 30.0) * clamp(dot(N, L) + 0.3, 0.0, 1.0);
  // (it is the colour of the hair that shines: a black coat that took it as a light, whatever its colour, would be blotched where the hair's direction changes)
  float dark = 1.0 - clamp(dot(alb, vec3(0.3, 0.55, 0.15)) * 2.6, 0.0, 1.0);
  lit += vec3(1.0, 0.86, 0.66) * strandShine * 0.16 * (1.0 - dark) * mix(0.5, 1.0, shellT) * (1.0 - white * 0.5);
  // the edge of a coat glows where the light comes through the hair: the outer layers, seen at a slant, are lit from behind
  lit += A * vec3(1.0, 0.8, 0.55) * pow(1.0 - clamp(abs(N.z), 0.0, 1.0), 1.5) * shellT * 0.5 * (0.4 + 0.6 * clamp(N.y * 0.5 + 0.7, 0.0, 1.0));
  // a dark coat takes almost nothing from the light as a colour, and would be a flat shape: the shine of its fur, cool, is what shows its form
  // (strand by strand: each hair catches the light of its own, so the shine is a glitter of hairs and not a band of plastic)
  // (and a coat is not equally glossy all over: where it is cleaner or flatter it shines, and elsewhere it does not, in patches the size of a hand)
  float patchy = dark > 0.02 ? 0.5 + 1.0 * noise(p * 4.5 + 3.0) : 1.0;
  float glint = (uShell > 0.5 ? 0.35 + 1.3 * strandOwn : 0.7) * patchy;
  lit += vec3(0.5, 0.58, 0.72) * dark * (0.012 * key + 0.12 * pow(sheen, 1.5) * glint + 0.07 * rim + 0.01 * sky);
  lit += vec3(0.5, 0.18, 0.12) * onEar * (0.18 + 0.3 * rim) * (1.0 - key * 0.4);
  vec3 col = pow(lit, vec3(1.0 / 2.2));
  // paint that is itself light (the eye) is not darkened by the fur's shade
  col = mix(col, f.rgb * (0.78 + 0.22 * key), f.a * 0.5);
  float alpha = uShell < 0.5 ? 1.0 : cover;
  gl_FragColor = vec4(col * alpha, alpha) * uAppear;
}
`;

export const SHADOW_VERTEX = /* glsl */ `
attribute vec2 aCorner;
uniform vec4 uRect;
varying vec2 vUv;
void main() {
  vUv = aCorner;
  gl_Position = vec4(uRect.xy + aCorner * uRect.zw, 0.0, 1.0);
}
`;

export const SHADOW_FRAGMENT = /* glsl */ `
precision mediump float;
varying vec2 vUv;
uniform float uStrength;
void main() {
  float d = length(vUv);
  float a = smoothstep(1.0, 0.0, d);
  a = a * a * uStrength;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}
`;


