/*
 * The shaders of the "Sharp" mode: AMD FidelityFX Super Resolution 1 (EASU, then RCAS), ported to WebGL 2 (GLSL ES 3.00) from AMD's own source,
 * ffx-fsr/ffx_fsr1.h and ffx-fsr/ffx_a.h of https://github.com/GPUOpen-Effects/FidelityFX-FSR (v1.20210629), under this licence:
 *
 * FidelityFX Super Resolution Sample
 *
 * Copyright (c) 2021 Advanced Micro Devices, Inc. All rights reserved.
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files(the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and / or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions :
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 * What differs from AMD's code, and why:
 *  - `FsrEasuF` (the non-packed 32-bit version) reads its 12 taps with `texelFetch`, one by one, where AMD gathers them four at a time: WebGL 2 has no
 *    `textureGather`. The taps, their offsets from 'f', and everything computed from them are AMD's (b c / e f g h / i j k l / n o).
 *  - AMD's predicates (`biS`..`biV`) choose the bilinear weight inside `FsrEasuSetF`; here the caller passes that weight. Same numbers.
 *  - The fast approximations are AMD's bit tricks from ffx_a.h: `APrxLoRcpF1` (0x7ef07ebb), `APrxLoRsqF1` (0x5f347d74), `APrxMedRcpF1` (0x7ef19fff).
 *  - RCAS without FSR_RCAS_DENOISE and without the alpha pass-through (AMD's defaults). Its two limiters divide as AMD's do; on a pure black or pure
 *    white 3x3 (0 / 0) GLSL leaves `max(NaN, x)` undefined where HLSL returns x, so each divisor is kept 1e-5 away from zero: the result is AMD's
 *    wherever AMD's is a number.
 *  - Rows: the video is uploaded with its top row as row 0. EASU writes the image in that order to its own texture; RCAS reads it so and turns it the
 *    right way up for the canvas.
 */

export const FULLSCREEN_VERTEX = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

export const EASU_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D src;
uniform ivec2 srcSize;
uniform vec4 con0; // FsrEasuCon con0: input / output, and 0.5 * input / output - 0.5
out vec4 color;

float APrxLoRcpF1(float a) { return uintBitsToFloat(0x7ef07ebbu - floatBitsToUint(a)); }
float APrxLoRsqF1(float a) { return uintBitsToFloat(0x5f347d74u - (floatBitsToUint(a) >> 1u)); }
float ASatF1(float a) { return clamp(a, 0.0, 1.0); }

vec3 tap(ivec2 p) { return texelFetch(src, clamp(p, ivec2(0), srcSize - 1), 0).rgb; }
// Simplest multi-channel approximate luma possible (luma times 2, in 2 FMA/MAD).
float luma2(vec3 c) { return c.b * 0.5 + (c.r * 0.5 + c.g); }

// Filtering for a given tap for the scalar.
void FsrEasuTapF(inout vec3 aC, inout float aW, vec2 off, vec2 dir, vec2 len, float lob, float clp, vec3 c) {
  vec2 v;
  v.x = (off.x * (dir.x)) + (off.y * dir.y);
  v.y = (off.x * (-dir.y)) + (off.y * dir.x);
  v *= len;
  float d2 = v.x * v.x + v.y * v.y;
  d2 = min(d2, clp);
  float wB = (2.0 / 5.0) * d2 + (-1.0);
  float wA = lob * d2 + (-1.0);
  wB *= wB;
  wA *= wA;
  wB = (25.0 / 16.0) * wB + (-(25.0 / 16.0 - 1.0));
  float w = wB * wA;
  aC += c * w;
  aW += w;
}

// Accumulate direction and length (w: the bilinear weight AMD's predicates pick).
void FsrEasuSetF(inout vec2 dir, inout float len, float w, float lA, float lB, float lC, float lD, float lE) {
  float dc = lD - lC;
  float cb = lC - lB;
  float lenX = max(abs(dc), abs(cb));
  lenX = APrxLoRcpF1(lenX);
  float dirX = lD - lB;
  dir.x += dirX * w;
  lenX = ASatF1(abs(dirX) * lenX);
  lenX *= lenX;
  len += lenX * w;
  float ec = lE - lC;
  float ca = lC - lA;
  float lenY = max(abs(ec), abs(ca));
  lenY = APrxLoRcpF1(lenY);
  float dirY = lE - lA;
  dir.y += dirY * w;
  lenY = ASatF1(abs(dirY) * lenY);
  lenY *= lenY;
  len += lenY * w;
}

void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec2 pp = vec2(ip) * con0.xy + con0.zw;
  vec2 fp = floor(pp);
  pp -= fp;
  ivec2 f0 = ivec2(fp);
  //    b c
  //  e f g h
  //  i j k l
  //    n o
  vec3 b = tap(f0 + ivec2(0, -1));
  vec3 c = tap(f0 + ivec2(1, -1));
  vec3 e = tap(f0 + ivec2(-1, 0));
  vec3 f = tap(f0);
  vec3 g = tap(f0 + ivec2(1, 0));
  vec3 h = tap(f0 + ivec2(2, 0));
  vec3 i = tap(f0 + ivec2(-1, 1));
  vec3 j = tap(f0 + ivec2(0, 1));
  vec3 k = tap(f0 + ivec2(1, 1));
  vec3 l = tap(f0 + ivec2(2, 1));
  vec3 n = tap(f0 + ivec2(0, 2));
  vec3 o = tap(f0 + ivec2(1, 2));
  float bL = luma2(b), cL = luma2(c), eL = luma2(e), fL = luma2(f), gL = luma2(g), hL = luma2(h);
  float iL = luma2(i), jL = luma2(j), kL = luma2(k), lL = luma2(l), nL = luma2(n), oL = luma2(o);
  // Accumulate for bilinear interpolation.
  vec2 dir = vec2(0.0);
  float len = 0.0;
  FsrEasuSetF(dir, len, (1.0 - pp.x) * (1.0 - pp.y), bL, eL, fL, gL, jL);
  FsrEasuSetF(dir, len, pp.x * (1.0 - pp.y), cL, fL, gL, hL, kL);
  FsrEasuSetF(dir, len, (1.0 - pp.x) * pp.y, fL, iL, jL, kL, nL);
  FsrEasuSetF(dir, len, pp.x * pp.y, gL, jL, kL, lL, oL);
  // Normalize with approximation, and cleanup close to zero.
  vec2 dir2 = dir * dir;
  float dirR = dir2.x + dir2.y;
  bool zro = dirR < (1.0 / 32768.0);
  dirR = APrxLoRsqF1(dirR);
  dirR = zro ? 1.0 : dirR;
  dir.x = zro ? 1.0 : dir.x;
  dir *= vec2(dirR);
  // Transform from {0 to 2} to {0 to 1} range, and shape with square.
  len = len * 0.5;
  len *= len;
  // Stretch kernel {1.0 vert|horz, to sqrt(2.0) on diagonal}.
  float stretch = (dir.x * dir.x + dir.y * dir.y) * APrxLoRcpF1(max(abs(dir.x), abs(dir.y)));
  // Anisotropic length after rotation.
  vec2 len2 = vec2(1.0 + (stretch - 1.0) * len, 1.0 + (-0.5) * len);
  // Based on the amount of 'edge', the window shifts from +/-{sqrt(2.0) to slightly beyond 2.0}.
  float lob = 0.5 + ((1.0 / 4.0 - 0.04) - 0.5) * len;
  // Set distance^2 clipping point to the end of the adjustable window.
  float clp = APrxLoRcpF1(lob);
  // Accumulation mixed with min/max of 4 nearest.
  vec3 min4 = min(min(f, min(g, j)), k);
  vec3 max4 = max(max(f, max(g, j)), k);
  vec3 aC = vec3(0.0);
  float aW = 0.0;
  FsrEasuTapF(aC, aW, vec2(0.0, -1.0) - pp, dir, len2, lob, clp, b);
  FsrEasuTapF(aC, aW, vec2(1.0, -1.0) - pp, dir, len2, lob, clp, c);
  FsrEasuTapF(aC, aW, vec2(-1.0, 1.0) - pp, dir, len2, lob, clp, i);
  FsrEasuTapF(aC, aW, vec2(0.0, 1.0) - pp, dir, len2, lob, clp, j);
  FsrEasuTapF(aC, aW, vec2(0.0, 0.0) - pp, dir, len2, lob, clp, f);
  FsrEasuTapF(aC, aW, vec2(-1.0, 0.0) - pp, dir, len2, lob, clp, e);
  FsrEasuTapF(aC, aW, vec2(1.0, 1.0) - pp, dir, len2, lob, clp, k);
  FsrEasuTapF(aC, aW, vec2(2.0, 1.0) - pp, dir, len2, lob, clp, l);
  FsrEasuTapF(aC, aW, vec2(2.0, 0.0) - pp, dir, len2, lob, clp, h);
  FsrEasuTapF(aC, aW, vec2(1.0, 0.0) - pp, dir, len2, lob, clp, g);
  FsrEasuTapF(aC, aW, vec2(1.0, 2.0) - pp, dir, len2, lob, clp, o);
  FsrEasuTapF(aC, aW, vec2(0.0, 2.0) - pp, dir, len2, lob, clp, n);
  // Normalize and dering.
  color = vec4(min(max4, max(min4, aC * vec3(1.0 / aW))), 1.0);
}`;

export const RCAS_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D src;
uniform ivec2 size;
uniform float sharpness; // FsrRcasCon con.x
out vec4 color;

#define FSR_RCAS_LIMIT (0.25 - (1.0 / 16.0))
float APrxMedRcpF1(float a) { float b = uintBitsToFloat(0x7ef19fffu - floatBitsToUint(a)); return b * (-b * a + 2.0); }
vec3 load(ivec2 p) { return texelFetch(src, clamp(p, ivec2(0), size - 1), 0).rgb; }

void main() {
  ivec2 sp = ivec2(int(gl_FragCoord.x), size.y - 1 - int(gl_FragCoord.y));
  //    b
  //  d e f
  //    h
  vec3 b = load(sp + ivec2(0, -1));
  vec3 d = load(sp + ivec2(-1, 0));
  vec3 e = load(sp);
  vec3 f = load(sp + ivec2(1, 0));
  vec3 h = load(sp + ivec2(0, 1));
  // Min and max of ring.
  vec3 mn4 = min(min(b, min(d, f)), h);
  vec3 mx4 = max(max(b, max(d, f)), h);
  // Immediate constants for peak range.
  vec2 peakC = vec2(1.0, -1.0 * 4.0);
  // Limiters, these need to be high precision RCPs.
  vec3 hitMin = min(mn4, e) * (1.0 / max(4.0 * mx4, vec3(1e-5)));
  vec3 hitMax = (peakC.x - max(mx4, e)) * (1.0 / min(4.0 * mn4 + peakC.y, vec3(-1e-5)));
  vec3 lobeRGB = max(-hitMin, hitMax);
  float lobe = max(-FSR_RCAS_LIMIT, min(max(lobeRGB.r, max(lobeRGB.g, lobeRGB.b)), 0.0)) * sharpness;
  // Resolve, which needs the medium precision rcp approximation to avoid visible tonality changes.
  float rcpL = APrxMedRcpF1(4.0 * lobe + 1.0);
  color = vec4((lobe * b + lobe * d + lobe * h + lobe * f + e) * rcpL, 1.0);
}`;
