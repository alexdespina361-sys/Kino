import { EYE, LIP_GLSL, MOUTH } from "./mouth";

/**
 * The shaders of the solid cat. The vertex shader skins the mesh (up to four bones a point); the fragment shader lights it. The coat is the colour the mesh carries
 * in each vertex (the model's own, painted by its maker), lit with how open to the room the skin is there; the eyes, the mouth and the markings of the other coats are
 * painted from where a point stood in the rest (so that they stay on the body as it moves), and the eyes are drawn by the shader because they blink and look about.
 */

export const VERTEX = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aNor;
attribute vec4 aSkin;
attribute vec4 aWgt;
attribute vec4 aColor;
uniform vec4 uBones[96];
uniform vec4 uProj;
varying vec3 vRest;
varying vec3 vN;
varying vec4 vColor;
varying vec3 vPart;
varying float vBone;
varying float vFar;
void main() {
  vec3 p = vec3(0.0);
  vec3 n = vec3(0.0);
  vec4 q = vec4(aPos, 1.0);
  float top = -1.0;
  float lead = 0.0;
  float far = 0.0;
  float legs = 0.0;
  float tail = 0.0;
  float along = 0.0;
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
      if (w > top) { top = w; lead = id; }
      // the legs on the far side of the body (bones 13..15 and 19..21): they are seen darker, as what is further from the light and the eye is
      if ((id > 12.5 && id < 15.5) || (id > 18.5 && id < 21.5)) far += w;
      // what part of the cat a point is: a leg (bones 10..21) or the tail (22..31, and how far along it)
      if (id > 9.5 && id < 21.5) legs += w;
      if (id > 21.5) { tail += w; along += w * (id - 22.0) / 9.0; }
    }
  }
  vFar = far;
  vPart = vec3(legs, tail, tail > 0.01 ? along / tail : 0.0);
  vRest = aPos;
  vN = normalize(n);
  vColor = aColor;
  vBone = lead;
  gl_Position = vec4(p.x * uProj.x + uProj.z, p.y * uProj.y + uProj.w, -p.z * 0.4, 1.0);
}
`;

const EYE_A = EYE.a.toFixed(4);
const EYE_B = EYE.b.toFixed(4);

export const FRAGMENT = /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec3 vRest;
varying vec3 vN;
varying vec4 vColor;
varying vec3 vPart;
varying float vBone;
varying float vFar;
uniform float uAppear;
uniform float uDebug;
uniform float uLean;
uniform vec3 uHead;
uniform vec4 uEyes;
uniform vec4 uEyes2;
uniform vec4 uGlint;
uniform vec3 uIris0;
uniform vec3 uIris1;
uniform vec3 uIris2;
uniform vec3 uKey;
uniform vec3 uFill;

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
float luma(vec3 c) { return dot(c, vec3(0.3, 0.55, 0.15)); }

${LIP_GLSL}

/**
 * The inside of the mouth, painted on the band of skin between the lips (the jaw stretches it when it drops): the colour, and in a how much of the point it
 * is. v runs from +1 at the upper lip to -1 at the lower one, in the rest, so a stretched band is painted from one lip to the other whatever its size.
 */
vec4 mouthInside(vec3 h, float open, out float depth) {
  float v = (h.y - lipY(h.x, h.z)) / ${MOUTH.band.toFixed(4)};
  float inBand = sstep(1.55, 1.05, abs(v));
  float region = sstep(0.022, 0.04, h.x) * sstep(0.112, 0.096, h.x) * sstep(0.05, 0.04, abs(h.z));
  float a = inBand * region * sstep(0.03, 0.12, open);
  depth = sstep(0.095, 0.035, h.x);
  float az = abs(h.z);
  // the roof of the mouth and the throat: red at the lips, dark deeper in
  vec3 col = mix(vec3(0.66, 0.2, 0.22), vec3(0.21, 0.03, 0.045), clamp(0.3 + 0.7 * depth + 0.25 * (1.0 - abs(v)), 0.0, 1.0));
  // the tongue: pink, rising from the lower lip, with a groove down its middle
  float tongue = sstep(-0.1, -0.7, v) * sstep(0.03, 0.018, az) * sstep(0.096, 0.07, h.x);
  vec3 tc = mix(vec3(0.96, 0.54, 0.58), vec3(0.78, 0.34, 0.4), sstep(0.003, 0.0, az) * 0.8);
  col = mix(col, tc * (0.75 + 0.25 * (1.0 - depth)), tongue);
  // the fangs: a white point from each lip, at each side of the front
  float upper = sstep(0.0065 * (1.0 - clamp((0.95 - v) / 0.85, 0.0, 1.0)) + 0.0004, 0.0, abs(h.x - 0.094)) * sstep(0.0075, 0.003, abs(az - 0.02)) * step(0.1, v);
  float lower = sstep(0.005 * (1.0 - clamp((0.95 + v) / 0.6, 0.0, 1.0)) + 0.0004, 0.0, abs(h.x - 0.09)) * sstep(0.006, 0.0024, abs(az - 0.017)) * step(v, -0.35);
  col = mix(col, vec3(0.97, 0.94, 0.88), max(upper, lower));
  return vec4(col, a);
}

// the coat (see coats.ts): the mesh's own colours (a ragdoll), or the colours of another coat painted over the light and dark of the mesh's
uniform vec3 uBase;
uniform vec3 uLight;
uniform vec3 uStripeC;
uniform vec3 uWhiteC;
uniform vec3 uPatchA;
uniform vec3 uPatchB;
uniform vec3 uPointC;
uniform vec4 uCoat;
uniform vec2 uOwn;
const vec3 PINK = vec3(0.95, 0.60, 0.60);

/** How much of a point is the tabby's stripe (0..1), from where it stood in the rest. */
float stripes(vec3 p, vec3 part) {
  float legs = clamp(part.x, 0.0, 1.0);
  float tail = clamp(part.y, 0.0, 1.0);
  float u = part.z;
  float body = 1.0 - max(legs, tail);
  // (the other side of the cat has stripes of its own)
  float side = p.z < 0.0 ? 7.3 : 0.0;
  // the ribs: stripes that come down from the spine and lean back as they go down; each has a place, a thickness and a length of its own, thinning out towards the belly
  float drop = 0.6 - p.y;
  float warp = 0.03 * sin(p.y * 11.0 + p.x * 6.0 + side) + 0.04 * (noise(p * vec3(7.0, 5.0, 7.0) + side) - 0.5);
  float x = (p.x + 0.18 * drop + warp) * 14.0 + 0.5;
  float cell = floor(x);
  float own = hash(vec3(cell, 1.7 + side, 3.1));
  float own2 = hash(vec3(cell, 8.3 + side, 6.1));
  float band = abs(fract(x) - 0.5);
  float thick = (0.16 + 0.13 * own) * (1.0 - 0.5 * sstep(0.02, 0.26, drop));
  float st = sstep(thick, thick * 0.35, band);
  float reach = 0.12 + 0.2 * own2;
  st *= sstep(reach + 0.1, reach - 0.02, drop - 0.12);
  st *= 0.78 + 0.22 * noise(p * 23.0 + side);
  // the line down the spine
  float spine = sstep(0.05, 0.012, abs(p.z)) * sstep(0.54, 0.59, p.y) * (0.65 + 0.35 * noise(p * 14.0));
  st = max(st, spine * 0.85) * body;
  // the legs: bars that wrap them, the tail: rings, thicker near the tip, which is dark
  float bars = sstep(0.17, 0.08, abs(fract(p.y * 9.0 + 0.2 * sin(p.x * 17.0)) - 0.5)) * sstep(0.05, 0.14, p.y) * 0.85;
  float rings = max(sstep(0.3, 0.18, abs(fract(u * 8.5 + 0.2 * sin(u * 15.0 + 1.0)) - 0.5) + 0.04 * (1.0 - u)) * 0.95, sstep(0.84, 0.92, u));
  st = max(st, legs * (1.0 - tail) * bars);
  st = max(st, tail * rings);
  return clamp(st, 0.0, 1.0);
}

/**
 * One eye, painted on a point of the face: q is the place in the eye (across, up), o how open it is, g where the light's catch lies in it. A big eye whose iris
 * fills the opening (no white shows): a dark rim, the lid's shadow over the top of the iris, a ring at its edge, a lighter lower half, a pupil that is a tall oval
 * with a warm glow in its lower part, and one bright catch of light.
 */
vec4 eye(vec2 q, float o, vec2 gaze, vec2 g) {
  const float A = ${EYE_A};
  const float B = ${EYE_B};
  // (the outer corner a little higher than the inner one, and the inner corner a little more pointed)
  q.y -= 0.1 * q.x;
  float uu = q.x / A;
  float hh = B * sqrt(max(1.0 - pow(abs(uu), uu < 0.0 ? 2.15 : 2.0), 0.0));
  float openH = hh * o;
  float closed = max(uEyes2.z, uEyes.w);
  // the lid line of a closed eye: lifted when content, lowered when asleep
  float bow = (uEyes.w > 0.5 ? 0.0085 : -0.0045) * (1.0 - uu * uu);
  float line = sstep(0.0028, 0.0011, abs(q.y - bow)) * sstep(1.0, 0.86, abs(uu));
  vec3 lid = mix(vec3(0.13, 0.07, 0.045), vec3(0.07, 0.07, 0.085), uOwn.x);
  if (closed > 0.5) return vec4(lid, line);
  float inside = sstep(0.0014, -0.0014, abs(q.y) - openH) * sstep(0.0009, 0.0027, openH);
  vec2 d = q - gaze * vec2(0.0058, 0.0036);
  // (the iris is a little wider than it is tall)
  vec2 R = vec2(A, B * 1.06);
  float r = length(d / R);
  float ang = atan(d.y, d.x);
  // the iris: dark under the upper lid, the body of it in the middle, light below; fibres run out from the pupil, and a darker ring is at its edge
  float up = clamp(d.y / R.y * 0.5 + 0.5, 0.0, 1.0);
  float fib = noise(vec3(ang * 6.0, r * 9.0, 1.7)) * 0.6 + noise(vec3(ang * 13.0, r * 17.0, 5.1)) * 0.4;
  vec3 iris = mix(uIris2, uIris1, sstep(0.0, 0.62, up));
  iris = mix(iris, uIris0, sstep(0.52, 1.0, up) * 0.7);
  iris *= 0.9 + 0.2 * fib;
  iris = mix(iris, uIris0 * 0.62, sstep(0.74, 0.99, r));
  // (the light that comes through the lower edge of the eye)
  iris += uIris2 * sstep(0.45, 1.0, 1.0 - up) * sstep(0.35, 0.95, r) * 0.3;
  // the pupil: a tall oval, wider when the cat is excited or in the dark; warm brown at its lower part, black above
  float pw = mix(0.0064, 0.0175, uEyes.z);
  float ph = mix(0.0148, 0.0198, uEyes.z);
  float pup = sstep(1.0, 0.82, length(vec2(d.x / pw, d.y / ph)));
  // (black round the edge, a dark warm brown in the middle of it)
  vec3 pupC = mix(vec3(0.02, 0.014, 0.016), vec3(0.15, 0.062, 0.045), sstep(0.75, 0.0, length(vec2(d.x / pw, (d.y + 0.25 * ph) / ph))) * 0.85);
  vec3 col = mix(iris, pupC, pup);
  // the lid shades the eye
  col *= 1.0 - 0.72 * sstep(0.15, 1.0, q.y / max(openH, 0.002));
  // the catch of light: one bright round spot, and a faint one opposite
  float catchA = sstep(0.0049, 0.0037, length(q - g));
  float catchB = sstep(0.002, 0.0008, length(q + g * 0.62)) * 0.28;
  col = mix(col, vec3(1.0), max(catchA, catchB) * 0.97);
  // the rim of the lids (thin below and heavy above)
  float rimTop = sstep(0.0001, 0.003, q.y);
  float rim = sstep(mix(0.0029, 0.0055, rimTop), 0.0007, abs(abs(q.y) - openH)) * sstep(1.0, 0.9, abs(uu));
  col = mix(col, lid, rim * mix(0.62, 0.97, rimTop));
  float a = max(inside, rim * sstep(0.0009, 0.0027, openH) * 0.9);
  return vec4(col, a);
}

/** The painted face: returns the colour in rgb and how much it covers in a (the eyes and the mouth; the nose is the mesh's). */
vec4 face(vec3 h) {
  vec4 c = vec4(0.0);
  float front = sstep(0.035, 0.07, h.x);
  for (int e = 0; e < 2; e++) {
    float s = e == 0 ? 1.0 : -1.0;
    float o = e == 0 ? uEyes.x : uEyes.y;
    vec4 ec = eye(vec2((h.z - s * ${EYE.z.toFixed(4)}) * s, h.y - ${EYE.y.toFixed(4)}), o, uEyes2.xy, e == 0 ? uGlint.xy : uGlint.zw);
    ec.a *= front;
    c = mix(c, vec4(ec.rgb, 1.0), ec.a);
  }
  // the mouth: a line down from the nose, and a curve to each side that runs back to the corner (an open mouth is painted over it)
  float xin = sstep(0.03, 0.06, h.x);
  float phil = sstep(0.0019, 0.0007, abs(h.z)) * sstep(-0.046, -0.041, h.y) * sstep(-0.058, -0.063, h.y) * sstep(0.08, 0.095, h.x);
  float ym = lipY(h.x, h.z);
  float mouth = sstep(0.002, 0.0007, abs(h.y - ym)) * sstep(0.044 + 0.02 * sstep(0.095, 0.04, h.x), 0.036 + 0.02 * sstep(0.095, 0.04, h.x), abs(h.z));
  c = mix(c, vec4(0.52, 0.36, 0.38, 1.0), max(phil, mouth) * xin * 0.55);
  return c;
}

void main() {
  vec3 p = vRest;
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 mine = vColor.rgb;

  if (uDebug > 0.5) {
    vec3 d = vec3(0.5) + 0.5 * N;
    if (uDebug > 1.5 && uDebug < 2.5) d = vec3(vColor.a);
    if (uDebug > 2.5 && uDebug < 3.5) d = 0.5 + 0.5 * vec3(sin(vBone * 2.3), sin(vBone * 3.1 + 1.0), sin(vBone * 1.7 + 2.0));
    if (uDebug > 3.5) d = mine;
    gl_FragColor = vec4(d, 1.0);
    return;
  }

  vec3 h = p - uHead;
  float mouthDepth = 0.0;
  vec4 mo = vec4(0.0);
  // (only while the jaw is open, and only near the head)
  if (uEyes2.w > 0.03 && dot(h, h) < 0.05) mo = mouthInside(h, uEyes2.w, mouthDepth);

  // --- the coat
  float L = luma(mine);
  vec3 alb;
  if (uOwn.x > 0.5) {
    // the model's own: a little lighter than it was painted, for the screen is a bright place; its dark places (the points) a cooler grey than the warm brown they were painted
    alb = clamp(mine * uOwn.y, 0.0, 1.0);
    float points = sstep(0.52, 0.3, L);
    alb = mix(alb, vec3(L * 1.2) * vec3(0.97, 1.0, 1.06), points * 0.6);
  } else {
    // another coat, painted over the light and dark of the model: its dark places (the mask, the ears, the tail) are the coat's points, its underside, chest, muzzle and socks are white
    float tux = uCoat.z;
    float dark = sstep(0.5, 0.34, L);
    float legs = clamp(vPart.x, 0.0, 1.0);
    float tail = clamp(vPart.y, 0.0, 1.0);
    float limb = max(legs, tail);
    float rag = 0.03 * (noise(p * 7.0) - 0.5) + tux * (0.04 * sin(p.x * 8.5 + 1.1 * sign(p.z + 0.001)) + 0.06 * (noise(p * vec3(2.6, 1.8, 2.6) + 11.0) - 0.5));
    float edge = mix(0.04, 0.025, tux);
    float belly = sstep(0.25 + 0.06 * tux + edge, 0.25 + 0.06 * tux - edge, p.y + rag) * (1.0 - limb);
    alb = mix(uBase, uLight, belly);
    float st = stripes(p, vPart) * uCoat.x;
    alb = mix(alb, uStripeC, st * (1.0 - belly * 0.8));
    // the points: as the model has them, in the colour the coat gives them
    alb = mix(alb, uPointC, dark * 0.9);
    // a patched coat: blotches of two colours over the back, the head and the tail, and not over the legs and the belly
    if (uCoat.w > 0.01) {
      float pa = noise(p * vec3(4.2, 4.8, 4.0) + 7.0) + 0.4 * noise(p * 12.0 + 1.0);
      float pb = noise(p * vec3(3.4, 4.0, 4.4) + 19.0) + 0.4 * noise(p * 11.0 + 5.0);
      float orangeP = sstep(0.8, 0.84, pa);
      float blackP = sstep(0.82, 0.86, pb) * (1.0 - orangeP);
      float where = max(sstep(0.3, 0.42, p.y) * (1.0 - limb), limb * sstep(0.28, 0.4, p.y));
      alb = mix(alb, uPatchA, orangeP * where * uCoat.w);
      alb = mix(alb, uPatchB, blackP * where * uCoat.w);
      // the face is not the same on both sides: one has an orange cap over its eye and ear, the other a black one
      float cap = sstep(0.21, 0.16, length(h)) * sstep(0.0, 0.03, h.y);
      alb = mix(alb, uPatchA, cap * sstep(0.014, 0.03, h.z) * uCoat.w);
      alb = mix(alb, uPatchB, cap * sstep(-0.014, -0.03, h.z) * uCoat.w);
    }
    // white: the chest, the chin and the muzzle, the socks (a tuxedo's boots go up the leg, and its blaze up the nose)
    float bib = 1.0 - sstep(mix(0.55, 0.85, tux), 1.0, length((p.xy - vec2(0.33, 0.33)) / (vec2(0.1, 0.17) * uCoat.y)));
    bib *= (1.0 - limb);
    float white = bib;
    float headZone = sstep(0.2, 0.16, length(h)) * sstep(-0.02, 0.01, h.x);
    float pad = 1.0 - sstep(mix(0.72, 0.9, tux), 1.05, length((h - vec3(0.085, -0.045, 0.0)) / (vec3(0.06, 0.03, 0.05) * uCoat.y)));
    float chin = 1.0 - sstep(mix(0.72, 0.9, tux), 1.05, length((h - vec3(0.07, -0.075, 0.0)) / (vec3(0.05, 0.035, 0.04) * uCoat.y)));
    white = max(white, max(pad, chin) * mix(0.72, 0.96, tux) * headZone);
    float blazeW = 0.008 + 0.001 * clamp((h.y + 0.02) / 0.01, 0.0, 10.0);
    float blaze = sstep(blazeW + 0.003, blazeW - 0.002, abs(h.z)) * sstep(0.0, 0.03, h.x) * sstep(0.1, 0.08, h.y) * sstep(-0.04, -0.015, h.y);
    white = max(white, blaze * headZone * tux);
    float sock = 0.1 + 0.1 * tux;
    white = max(white, legs * (1.0 - tail) * sstep(sock + 0.02, sock - 0.02, p.y + rag));
    alb = mix(alb, uWhiteC, clamp(white, 0.0, 1.0));
    // (the colour of a coat is not flat: it is a little lighter and darker where the model is)
    alb *= 0.9 + 0.2 * L;
  }

  vec4 f = vec4(0.0);
  if (length(h) < 0.2 && h.x > 0.03) f = face(h);
  alb = mix(alb, f.rgb, f.a);
  alb = mix(alb, mo.rgb, mo.a);

  // --- light: a warm key from above and the front, a cool fill from the sky; the fur holds light along its edges
  vec3 A = lin(alb);
  vec3 Lt = normalize(uKey);
  float wrap = clamp((dot(N, Lt) + 0.45) / 1.45, 0.0, 1.0);
  float key = wrap * wrap * (3.0 - 2.0 * wrap);
  float fill = clamp(dot(N, normalize(uFill)) * 0.5 + 0.5, 0.0, 1.0);
  float sky = N.y * 0.5 + 0.5;
  // (how open to the room the skin is, baked into the mesh: the creases between the tufts, the underside and the armpits are darker; the face is shaded less by its hollows)
  float isHead = sstep(0.24, 0.18, length(h)) * sstep(-0.03, 0.01, h.x);
  float ao = mix(0.34, 1.0, mix(vColor.a, sqrt(vColor.a), isHead * 0.7));
  ao *= 1.0 - 0.45 * mo.a * mouthDepth;
  vec3 lit = A * (vec3(1.0, 0.94, 0.86) * key * 0.95 + vec3(0.66, 0.7, 0.8) * (0.16 + 0.24 * sky) * (0.6 + 0.4 * fill)) * ao;
  lit *= mix(1.0, 0.7, clamp(vFar, 0.0, 1.0));
  float rim = pow(1.0 - clamp(N.z, 0.0, 1.0), 2.2);
  lit += A * rim * 0.5 * (0.5 + 0.5 * key) + vec3(1.0, 0.85, 0.65) * rim * 0.05;
  // what the floor gives back to the underside: warm, so that a chin and a belly are not grey
  lit += A * vec3(0.95, 0.66, 0.42) * clamp(-N.y, 0.0, 1.0) * 0.28 * mix(0.6, 1.0, vColor.a);
  // a coat has a soft sheen where the light grazes it
  float sheen = pow(clamp(dot(N, normalize(Lt + vec3(0.0, 0.0, 1.0))), 0.0, 1.0), 14.0);
  lit += vec3(1.0, 0.88, 0.7) * sheen * 0.09 * (1.0 - 0.5 * f.a);
  // (a dark coat takes almost nothing from the light as a colour, and would be a flat shape: the shine of its fur, cool, is what shows its form)
  float dark = 1.0 - clamp(luma(alb) * 2.6, 0.0, 1.0);
  lit += vec3(0.5, 0.58, 0.72) * dark * (0.012 * key + 0.1 * pow(sheen, 1.5) + 0.06 * rim + 0.01 * sky);
  vec3 col = pow(lit, vec3(1.0 / 2.2));
  // paint that is itself light (the eye) is not darkened by the fur's shade
  col = mix(col, f.rgb * (0.78 + 0.22 * key), f.a * 0.5);
  gl_FragColor = vec4(col, 1.0) * uAppear;
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
