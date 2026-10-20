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
uniform float uFurLen;
varying vec3 vRest;
varying vec3 vRN;
varying vec3 vN;
varying vec4 vPaint;
varying float vBone;
varying float vFar;
void main() {
  vec3 p = vec3(0.0);
  vec3 n = vec3(0.0);
  vec4 q = vec4(aPos, 1.0);
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
      if (w > top) { top = w; lead = id; }
      // the legs on the far side of the body (bones 13..15 and 19..21): they are seen darker, as what is further from the light and the eye is
      if ((id > 12.5 && id < 15.5) || (id > 18.5 && id < 21.5)) far += w;
    }
  }
  vFar = far;
  n = normalize(n);
  p += n * (uShell * uFurLen * aPaint.g * 2.55);
  vRest = aPos;
  vRN = aNor;
  vN = n;
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

const vec3 GINGER = vec3(0.90, 0.56, 0.25);
const vec3 GINGER_LIGHT = vec3(0.98, 0.78, 0.52);
const vec3 STRIPE = vec3(0.70, 0.34, 0.12);
const vec3 WHITE = vec3(1.0, 0.95, 0.88);
const vec3 PINK = vec3(0.95, 0.60, 0.60);

/** How much of a point is the tabby's stripe (0..1), from where it stood in the rest. */
float stripes(vec3 p, float limb, float u) {
  float onLimb = sstep(0.35, 0.75, limb);
  float tail = onLimb * step(p.x, -0.43) * step(0.42, p.y);
  float leg = onLimb * (1.0 - tail);
  float warp = 0.04 * sin(p.y * 13.0 + p.x * 5.0) + 0.03 * (noise(p * 8.0) - 0.5);
  float band = abs(fract((p.x + warp) * 15.0) - 0.5);
  float st = sstep(0.31, 0.2, band);
  st *= sstep(0.36, 0.5, p.y);
  st *= 0.72 + 0.28 * noise(p * 21.0);
  // the line down the spine
  st = max(st, sstep(0.045, 0.02, abs(p.z)) * sstep(0.55, 0.6, p.y) * 0.8);
  st *= 1.0 - onLimb;
  float bars = mix(sstep(0.17, 0.09, abs(fract(u * 5.0 + 0.1) - 0.5)) * sstep(0.02, 0.3, u) * 0.8,
                   sstep(0.16, 0.08, abs(fract(u * 4.0 + 0.1) - 0.5)) * sstep(0.1, 0.25, u) * 0.85, step(0.0, p.x));
  float rings = max(sstep(0.3, 0.2, abs(fract(u * 9.0) - 0.5)) * 0.95, sstep(0.84, 0.92, u));
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
    float width = 0.056 * (1.0 - ta / 0.175);
    float on = step(-0.012, ta) * step(ta, 0.17) * step(abs(ts), width + 0.012) * step(abs(tc), 0.055);
    float in_ = sstep(0.0, 0.01, tc) * sstep(width * 0.82, width * 0.5, abs(ts)) * sstep(0.01, 0.04, ta) * sstep(0.165, 0.12, ta);
    onEar = max(onEar, on);
    inside = max(inside, in_ * on);
  }
  return inside;
}

/** One eye, painted on a point of the face: q is the place in the eye (across, up), o how open it is. */
vec4 eye(vec2 q, float o, vec2 gaze) {
  const float A = 0.041;
  const float B = 0.034;
  q.y -= 0.16 * q.x;
  float uu = q.x / A;
  float hh = B * pow(max(1.0 - pow(abs(uu), 2.4), 0.0), 0.7);
  float openH = hh * o;
  float closed = max(uEyes2.z, uEyes.w);
  // the lid line of a closed eye: lifted when content, lowered when asleep
  float bow = (uEyes.w > 0.5 ? 0.014 : -0.007) * (1.0 - uu * uu);
  float line = sstep(0.0048, 0.0018, abs(q.y - bow)) * sstep(1.0, 0.86, abs(uu));
  if (closed > 0.5) return vec4(0.16, 0.08, 0.05, line);
  float inside = sstep(0.002, -0.002, abs(q.y) - openH) * sstep(1.0, 0.9, abs(uu)) * sstep(0.0015, 0.004, openH);
  vec2 d = q - gaze * vec2(0.014, 0.011);
  float r = length(d);
  vec3 iris = mix(vec3(0.98, 0.82, 0.22), vec3(0.50, 0.70, 0.16), sstep(0.004, 0.024, r));
  iris = mix(iris, vec3(0.14, 0.24, 0.07), sstep(0.022, 0.031, r));
  iris *= 0.9 + 0.1 * noise(vec3(atan(d.y, d.x) * 2.5, r * 80.0, 1.7));
  float pw = mix(0.0032, 0.021, uEyes.z);
  float pup = sstep(1.0, 0.7, length(vec2(d.x / pw, d.y / 0.029)));
  vec3 col = mix(vec3(0.95, 0.92, 0.84), iris, sstep(0.034, 0.029, r));
  col = mix(col, vec3(0.015, 0.01, 0.01), pup);
  // the upper lid shades the eye; a glint makes it wet
  col *= 1.0 - 0.5 * sstep(0.1, 1.0, q.y / max(openH, 0.002));
  float glint = sstep(0.0085, 0.0035, length(q - vec2(-0.011, 0.0125) - gaze * vec2(0.004, 0.003)));
  float glint2 = sstep(0.0045, 0.0015, length(q - vec2(0.012, -0.011))) * 0.55;
  col = mix(col, vec3(1.0), max(glint, glint2) * 0.95);
  float rim = sstep(0.0058, 0.0016, abs(abs(q.y) - openH)) * sstep(1.0, 0.8, abs(uu));
  col = mix(col, vec3(0.14, 0.07, 0.04), rim * 0.9);
  float a = max(inside, rim * sstep(0.0015, 0.004, openH) * 0.9);
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
  // the nose: a rounded triangle, pointing down
  float ny = (h.y + 0.028) / 0.028;
  float nw = 0.019 * (0.4 + 0.6 * clamp(ny, 0.0, 1.0));
  float nose = sstep(nw + 0.002, nw - 0.002, abs(h.z)) * sstep(-0.05, 0.15, ny) * sstep(1.12, 0.9, ny) * sstep(0.12, 0.15, h.x);
  vec3 nc = mix(vec3(0.82, 0.42, 0.46), vec3(0.96, 0.62, 0.64), clamp(ny, 0.0, 1.0));
  c = mix(c, vec4(nc, 1.0), nose);
  // the mouth: a line down from the nose, and a curve to each side that runs back to the corner (an open mouth is painted over it)
  float xin = sstep(0.055, 0.085, h.x);
  float phil = sstep(0.0032, 0.0012, abs(h.z)) * sstep(-0.056, -0.05, h.y) * sstep(-0.026, -0.032, h.y) * sstep(0.1, 0.13, h.x);
  float ym = lipY(h.x, h.z);
  float mouth = sstep(0.0034, 0.0012, abs(h.y - ym)) * sstep(0.056 + 0.03 * sstep(0.1, 0.05, h.x), 0.046 + 0.03 * sstep(0.1, 0.05, h.x), abs(h.z));
  c = mix(c, vec4(0.30, 0.15, 0.12, 1.0), max(phil, mouth) * xin * 0.8);
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

  // the fur: the shells keep the points where a strand is (it is the longer where the noise is high); the base keeps all
  float cover = 1.0;
  float shellT = uShell / (uShells + 1.0);
  if (uShell > 0.5) {
    float n1 = noise(p * uFreq);
    float n2 = noise(p * uFreq * 0.5 + 3.1);
    float len = 0.42 + 0.58 * (0.65 * n1 + 0.35 * n2);
    cover = sstep(shellT - 0.22, shellT + 0.1, len);
    // (where the coat is seen edge-on the outer shells would show as rows of dashes: they thin out there, and the inner ones make the edge soft)
    cover *= mix(1.0, sstep(0.04, 0.42, abs(N.z)), sstep(0.35, 0.85, shellT));
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

  vec3 alb = GINGER;
  float belly = sstep(0.42, 0.33, p.y) * (1.0 - onLimb);
  alb = mix(alb, GINGER_LIGHT, belly * 0.9);
  float st = stripes(p, limb, u) * (1.0 - sstep(0.235, 0.19, length(h * vec3(1.0, 0.85, 1.0))));
  alb = mix(alb, STRIPE, st * (1.0 - belly * 0.8));

  // white: the chest, the chin and the muzzle, the socks
  float bib = 1.0 - sstep(0.55, 1.0, length((p.xy - vec2(0.405, 0.43)) / vec2(0.095, 0.16)));
  bib *= (1.0 - onLimb) * (1.0 - sstep(0.04, 0.09, abs(p.z) - 0.04));
  float white = bib;
  float pad = 1.0 - sstep(0.72, 1.05, length((h - vec3(0.105, -0.052, 0.0)) / vec3(0.075, 0.034, 0.066)));
  float chin = 1.0 - sstep(0.72, 1.05, length((h - vec3(0.088, -0.084, 0.0)) / vec3(0.058, 0.042, 0.05)));
  white = max(white, max(pad, chin) * 0.96 * isHead);
  // the forehead's three strokes, and a line out from each eye along the cheek
  float inFront = sstep(-0.03, 0.03, h.x) * sstep(0.045, 0.075, h.y) * sstep(0.11, 0.08, h.y + max(0.0, -h.x) * 2.0);
  float stroke = max(sstep(0.0055, 0.002, abs(h.z)), max(sstep(0.0055, 0.002, abs(h.z - 0.03)), sstep(0.0055, 0.002, abs(h.z + 0.03))));
  alb = mix(alb, STRIPE, stroke * inFront * isHead * 0.7);
  float cheek = sstep(0.007, 0.002, abs(h.y - 0.005 + (abs(h.z) - 0.085) * 0.9)) * sstep(0.078, 0.1, abs(h.z)) * sstep(0.1, 0.04, h.x);
  alb = mix(alb, STRIPE, cheek * isHead * 0.3);
  white = max(white, leg * sstep(0.125, 0.085, p.y));
  white = max(white, leg * sstep(0.06, 0.035, p.y) * 2.0);
  // the ear: ginger and dark at the rim, pink inside
  alb = mix(alb, STRIPE * 0.85, onEar * 0.4);
  alb = mix(alb, WHITE, clamp(white, 0.0, 1.0));
  alb = mix(alb, mix(PINK, vec3(1.0, 0.86, 0.8), 0.3), earIn);

  vec4 f = vec4(0.0);
  if (isHead > 0.5 && h.x > 0.03) f = face(h);
  if (uShell > 0.5 && f.a > 0.2) discard;
  alb = mix(alb, f.rgb, f.a);
  alb = mix(alb, mo.rgb, mo.a);

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
  float root = uShell < 0.5 ? 0.86 : mix(0.84, 1.08, shellT);
  vec3 lit = A * (vec3(1.0, 0.94, 0.86) * key * 1.05 + vec3(0.66, 0.7, 0.8) * (0.2 + 0.26 * sky) * (0.6 + 0.4 * fill)) * ao * root;
  lit *= mix(1.0, 0.7, clamp(vFar, 0.0, 1.0));
  float rim = pow(1.0 - clamp(N.z, 0.0, 1.0), 2.2);
  lit += A * rim * 0.5 * (0.5 + 0.5 * key) + vec3(1.0, 0.85, 0.65) * rim * 0.06;
  // what the floor gives back to the underside: warm, so that a chin and a belly are not grey
  lit += A * vec3(0.95, 0.66, 0.42) * clamp(-N.y, 0.0, 1.0) * 0.3 * mix(0.6, 1.0, vPaint.r);
  // a coat has a soft sheen where the light grazes it
  float sheen = pow(clamp(dot(N, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0, 1.0), 14.0);
  lit += vec3(1.0, 0.88, 0.7) * sheen * 0.1 * (1.0 - st * 0.6) * (1.0 - white);
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


