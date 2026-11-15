/**
 * The frame boost of the upscaler test page (labs/upscale/): makes frames between the video's own, so that a 24 fps video can be shown at 30 or 60.
 *
 * "Motion" is motion estimation and compensation, the way TVs do it, in four steps:
 *  1. the brightness of each frame is kept at several sizes (a pyramid);
 *  2. for each pair of frames, a block search finds where each part of the older frame went in the newer one, and where each part of the newer one came
 *     from, roughly on the smallest size and then finer on each bigger one ("paths", forward and backward);
 *  3. for the moment wanted, each part of both frames is carried along its path to where it is then ("projected"). Where two parts land on one spot,
 *     the one that moves unlike the picture as a whole (a thing in front of its background) wins; a spot nothing lands on is filled from around it;
 *  4. each pixel of the new frame is taken from both frames along its path and mixed, or from the one frame it is seen in (something going behind, or
 *     coming out from behind, something else). Across a cut, no frame is made at all.
 * "Blend" only mixes the two frames, the cheapest there is, which blurs what moves.
 *
 * All of it is WebGL 2 in the upscaler's own context (glUpscaler.ts), so its frames go to the Film and Sharp modes without a copy. Textures hold the
 * picture top row first, as the upscaler's do. The paths are in the video's own pixels.
 */

import { FULLSCREEN_VERTEX } from "./fsrShaders";

export type BoostHow = "motion" | "blend";

export interface Size {
  width: number;
  height: number;
}

interface Program {
  program: WebGLProgram;
  uniform: (name: string) => WebGLUniformLocation | null;
}

interface Target {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  size: Size;
}

interface Slot {
  serial: number;
  color: Target;
  luma: Target[];
  /** Where each part of the frame before went in this one (with mipmaps: their average is the picture's own motion, and how well they fit). */
  forward: Target;
  /** Where each part of this frame was in the frame before. */
  backward: Target;
  /** The serial of the frame the paths were found against (-1: none yet). */
  pathsFrom: number;
}

const HEADER = `#version 300 es
precision highp float;
out vec4 color;
`;

/** The brightness of a frame at half its size (each pixel the average of four: one bilinear tap at their shared corner). */
const LUMA_FRAGMENT = `${HEADER}
uniform sampler2D src;
uniform vec2 size;
void main() {
  color = vec4(dot(texture(src, gl_FragCoord.xy / size).rgb, vec3(0.299, 0.587, 0.114)), 0.0, 0.0, 1.0);
}`;

/** The next, half as big, size of the pyramid. */
const HALF_FRAGMENT = `${HEADER}
uniform sampler2D src;
uniform vec2 size;
void main() {
  color = vec4(texture(src, gl_FragCoord.xy / size).r, 0.0, 0.0, 1.0);
}`;

/** How well a path fits: 3 x 3 pixels around the point in one frame against the same moved along the path in the other. */
const COST = `
uniform sampler2D lumaA;
uniform sampler2D lumaB;
uniform vec2 size;
float cost(vec2 uv, vec2 shift) {
  vec2 px = 1.0 / size;
  float sum = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 at = uv + vec2(float(x), float(y)) * px;
      sum += abs(texture(lumaA, at).r - texture(lumaB, at + shift * px).r);
    }
  }
  return sum;
}`;

/** The search on the smallest size: every step up to 5 of its pixels away (80 of the video's pixels at 480p) is tried. Standing still costs a hair less. */
const SEARCH_FRAGMENT = `${HEADER}
${COST}
uniform vec2 scale;
void main() {
  vec2 uv = gl_FragCoord.xy / size;
  float best = 1e9;
  vec2 bestShift = vec2(0.0);
  for (int y = -5; y <= 5; y++) {
    for (int x = -5; x <= 5; x++) {
      vec2 shift = vec2(float(x), float(y));
      float c = cost(uv, shift) + 0.004 * length(shift);
      if (c < best) {
        best = c;
        bestShift = shift;
      }
    }
  }
  color = vec4(bestShift * scale, best, 1.0);
}`;

/**
 * One size finer: the paths found one size smaller (here, at the four next to it, and standing still) are tried, the best is moved around by a step, and
 * a path unlike the one around it costs a little more (so that the paths of one moving thing agree).
 */
const REFINE_FRAGMENT = `${HEADER}
${COST}
uniform sampler2D coarse;
uniform vec2 coarseSize;
uniform vec2 scale;
uniform float stepSize;
void main() {
  vec2 uv = gl_FragCoord.xy / size;
  vec2 cpx = 1.0 / coarseSize;
  vec2 tried[6];
  tried[0] = texture(coarse, uv).rg;
  tried[1] = texture(coarse, uv + vec2(cpx.x, 0.0)).rg;
  tried[2] = texture(coarse, uv - vec2(cpx.x, 0.0)).rg;
  tried[3] = texture(coarse, uv + vec2(0.0, cpx.y)).rg;
  tried[4] = texture(coarse, uv - vec2(0.0, cpx.y)).rg;
  tried[5] = vec2(0.0);
  vec2 around = tried[0] / scale;
  float best = 1e9;
  vec2 bestShift = vec2(0.0);
  for (int i = 0; i < 6; i++) {
    vec2 shift = tried[i] / scale;
    float c = cost(uv, shift) + 0.01 * length(shift - around);
    if (c < best) {
      best = c;
      bestShift = shift;
    }
  }
  vec2 start = bestShift;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      if (x == 0 && y == 0) continue;
      vec2 shift = start + vec2(float(x), float(y)) * stepSize;
      float c = cost(uv, shift) + 0.01 * length(shift - around);
      if (c < best) {
        best = c;
        bestShift = shift;
      }
    }
  }
  color = vec4(bestShift * scale, best, 1.0);
}`;

/** The paths, each the middle of the 3 x 3 around it (left and right, up and down apart): takes away the odd wrong one. Keeps the cost as it was. */
const MEDIAN_FRAGMENT = `${HEADER}
uniform sampler2D src;
float middle(float v[9]) {
  for (int i = 0; i < 5; i++) {
    for (int j = i + 1; j < 9; j++) {
      if (v[j] < v[i]) {
        float s = v[i];
        v[i] = v[j];
        v[j] = s;
      }
    }
  }
  return v[4];
}
void main() {
  ivec2 at = ivec2(gl_FragCoord.xy);
  ivec2 last = textureSize(src, 0) - 1;
  float xs[9];
  float ys[9];
  int n = 0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 v = texelFetch(src, clamp(at + ivec2(x, y), ivec2(0), last), 0).rg;
      xs[n] = v.x;
      ys[n] = v.y;
      n++;
    }
  }
  color = vec4(middle(xs), middle(ys), texelFetch(src, at, 0).b, 1.0);
}`;

/** The picture's own motion (the average of the forward paths: the smallest level of their mipmaps) and how well they fit on average. */
const GLOBAL = `
uniform sampler2D forward;
uniform float lastLevel;
vec4 overall() {
  return textureLod(forward, vec2(0.5), lastLevel);
}`;

/** Above this, the average fit of the paths says the two frames are not of one scene (a cut). In brightness, 0 to 1, a pixel. */
const CUT_COST = "0.09";
/** Above this, a path fits so badly that its part is not in the other frame at all (it is hidden there, or out of the picture). */
const LOST_COST = "0.08";

/**
 * Step 3: each part of one frame (a cell of its paths) carried to where it is at the moment wanted, as a small square; the depth test keeps, on each
 * spot, the part nearest the eye. Nearer: what moves unlike the picture as a whole; farthest: a part whose path fits badly.
 */
const SPLAT_VERTEX = `#version 300 es
precision highp float;
uniform sampler2D field;
uniform vec2 fieldSize;
uniform vec2 scale;
uniform float travel;
uniform float direction;
uniform float fromB;
${GLOBAL}
out vec4 splat;
void main() {
  int columns = int(fieldSize.x);
  ivec2 cell = ivec2(gl_InstanceID % columns, gl_InstanceID / columns);
  vec4 found = texelFetch(field, cell, 0);
  int id = gl_VertexID;
  vec2 corner = vec2((id == 1 || id == 4 || id == 5) ? 1.0 : 0.0, (id == 2 || id == 3 || id == 5) ? 1.0 : 0.0);
  vec2 at = vec2(cell) + 0.5 + travel * found.rg / scale + (corner - 0.5) * 1.5;
  vec2 path = direction * found.rg;
  float apart = clamp(length(path - overall().rg) / 32.0, 0.0, 1.0);
  float depth = found.b / 9.0 > ${LOST_COST} ? 0.98 : 0.9 - 0.8 * apart;
  gl_Position = vec4(at / fieldSize * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  splat = vec4(path, fromB, 1.0);
}`;

const SPLAT_FRAGMENT = `${HEADER}
in vec4 splat;
void main() {
  color = splat;
}`;

/** A spot no part landed on (it was behind something in both frames' paths) takes the path around it that moves most like the background. */
const FILL_FRAGMENT = `${HEADER}
uniform sampler2D src;
${GLOBAL}
void main() {
  ivec2 at = ivec2(gl_FragCoord.xy);
  vec4 here = texelFetch(src, at, 0);
  if (here.a > 0.0) {
    color = here;
    return;
  }
  ivec2 last = textureSize(src, 0) - 1;
  vec2 still = overall().rg;
  float best = 1e9;
  vec4 pick = vec4(0.0);
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      vec4 near = texelFetch(src, clamp(at + ivec2(x, y), ivec2(0), last), 0);
      float d = length(near.rg - still);
      if (near.a > 0.0 && d < best) {
        best = d;
        pick = near;
      }
    }
  }
  color = pick.a > 0.0 ? vec4(pick.rgb, 0.5) : vec4(0.0);
}`;

/** Step 4: a frame between the two, \`t\` of the way (0 = the older). */
const RENDER_FRAGMENT = `${HEADER}
uniform sampler2D frameA;
uniform sampler2D frameB;
uniform sampler2D projected;
uniform sampler2D lumaA;
uniform sampler2D lumaB;
uniform vec2 size;
uniform vec2 fieldSize;
uniform float t;
uniform int motion;
${GLOBAL}
void main() {
  vec2 uv = gl_FragCoord.xy / size;
  if (motion == 0) {
    color = vec4(mix(texture(frameA, uv).rgb, texture(frameB, uv).rgb, t), 1.0);
    return;
  }
  vec4 whole = overall();
  if (whole.b / 9.0 > ${CUT_COST}) {
    color = vec4(t < 0.5 ? texture(frameA, uv).rgb : texture(frameB, uv).rgb, 1.0);
    return;
  }
  vec2 npx = 1.0 / size;
  ivec2 cell = ivec2(uv * fieldSize);
  ivec2 last = ivec2(fieldSize) - 1;
  // The path of this spot, or of one next to it if that fits this pixel better (a spot on the edge of a moving thing is partly the one, partly the other).
  ivec2 offsets[5] = ivec2[5](ivec2(0), ivec2(1, 0), ivec2(-1, 0), ivec2(0, 1), ivec2(0, -1));
  vec4 pick = vec4(whole.rg, 0.0, 0.0);
  float best = 1e9;
  for (int i = 0; i < 5; i++) {
    vec4 tried = texelFetch(projected, clamp(cell + offsets[i], ivec2(0), last), 0);
    if (tried.a == 0.0) continue;
    vec2 v = tried.rg * npx;
    float e = abs(texture(lumaA, uv - t * v).r - texture(lumaB, uv + (1.0 - t) * v).r) + (i == 0 ? 0.0 : 0.01);
    if (e < best) {
      best = e;
      pick = tried;
    }
  }
  vec2 v = pick.rg * npx;
  vec3 a = texture(frameA, uv - t * v).rgb;
  vec3 b = texture(frameB, uv + (1.0 - t) * v).rgb;
  // Where the two disagree, the spot is seen in one frame only: the one its part came from (or, for a filled spot, the nearer one).
  float disagree = smoothstep(0.06, 0.2, dot(abs(a - b), vec3(1.0 / 3.0)));
  vec3 seen = pick.a > 0.75 ? (pick.b < 0.5 ? a : b) : (t < 0.5 ? a : b);
  color = vec4(mix(mix(a, b, t), seen, disagree), 1.0);
}`;

/** The size of the next level of the pyramid. */
const halfOf = (size: Size): Size => ({ width: Math.max(1, Math.ceil(size.width / 2)), height: Math.max(1, Math.ceil(size.height / 2)) });

/** How many sizes the pyramid has: halving until the smallest is at most 64 pixels wide (4 for 480p, 5 for 1080p). */
export function pyramidLevels(size: Size): number {
  let levels = 1;
  for (let width = Math.ceil(size.width / 2); width > 64 && levels < 7; width = Math.ceil(width / 2)) levels++;
  return levels;
}

const lastLevelOf = (size: Size): number => Math.floor(Math.log2(Math.max(size.width, size.height)));

/**
 * Holds the last few frames of the video (as `HELD_FRAMES` in boostTiming.ts says), each with its pyramid and its paths from and to the frame before, and
 * draws frames between two of them.
 */
export class FrameBoost {
  private readonly luma: Program;
  private readonly half: Program;
  private readonly render: Program;
  private readonly search: Program | undefined;
  private readonly refine: Program | undefined;
  private readonly median: Program | undefined;
  private readonly splat: Program | undefined;
  private readonly fill: Program | undefined;
  private readonly slots: Slot[] = [];
  /** The paths of each size of the pyramid, as they are being found (the finest is filtered into a slot's own). */
  private work: Target[] = [];
  /** Step 3's spots, with a depth buffer, and a second one for filling (they take turns). */
  private projected: (Target & { depth: WebGLRenderbuffer }) | undefined;
  private filled: Target | undefined;
  private size: Size = { width: 0, height: 0 };
  private pushed = 0;
  private out: Target | undefined;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly floatTargets: boolean,
    private readonly held = 3,
  ) {
    this.luma = this.link(LUMA_FRAGMENT);
    this.half = this.link(HALF_FRAGMENT);
    this.render = this.link(RENDER_FRAGMENT);
    if (floatTargets) {
      this.search = this.link(SEARCH_FRAGMENT);
      this.refine = this.link(REFINE_FRAGMENT);
      this.median = this.link(MEDIAN_FRAGMENT);
      this.splat = this.link(SPLAT_FRAGMENT, SPLAT_VERTEX);
      this.fill = this.link(FILL_FRAGMENT);
    }
  }

  /** Why "Motion" cannot run here, or "" ("Blend" runs everywhere WebGL 2 does). */
  motionProblem(): string {
    return this.floatTargets ? "" : "This graphics chip cannot draw into float textures (EXT_color_buffer_float), which the motion search needs.";
  }

  /** Takes the video's next frame (`source` shows it now) and returns its number, by which `draw` names it. */
  push(source: TexImageSource, size: Size): number {
    const gl = this.gl;
    if (size.width !== this.size.width || size.height !== this.size.height) this.allocate(size);
    const serial = ++this.pushed;
    const slot = this.slots[serial % this.held]!;
    slot.serial = serial;
    slot.pathsFrom = -1;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, slot.color.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); // (row 0 = the top of the picture, as everywhere here)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    this.pass(this.luma, slot.luma[0]!, [["src", slot.color.texture]]);
    for (let level = 1; level < slot.luma.length; level++) this.pass(this.half, slot.luma[level]!, [["src", slot.luma[level - 1]!.texture]]);
    return serial;
  }

  /** Whether frame `serial` is still held. */
  holds(serial: number): boolean {
    return serial > 0 && this.slots[serial % this.held]?.serial === serial;
  }

  /** Finds the paths between frame `from` and frame `to` now, if they are not found yet (`draw` does it when it needs them; a speed test times it). */
  prepare(from: number, to: number): void {
    if (!this.search || !this.holds(from) || !this.holds(to) || to !== from + 1) return;
    const b = this.slots[to % this.held]!;
    if (b.pathsFrom !== from) this.findPaths(this.slots[from % this.held]!, b);
  }

  /**
   * The frame `t` of the way from frame `from` to frame `to` (two frames in a row), as a texture of the video's size; at 0 or 1 it is one of them as it
   * is (no work at all). Throws when one of them is no longer held.
   */
  draw(from: number, to: number, t: number, how: BoostHow): { texture: WebGLTexture; size: Size } {
    if (!this.holds(from) || !this.holds(to)) throw new Error("The frame boost no longer holds that frame");
    const a = this.slots[from % this.held]!;
    const b = this.slots[to % this.held]!;
    if (t <= 0) return { texture: a.color.texture, size: this.size };
    if (t >= 1) return { texture: b.color.texture, size: this.size };
    const motion = how === "motion" && Boolean(this.search) && to === from + 1;
    if (motion) {
      if (b.pathsFrom !== from) this.findPaths(a, b);
      this.project(b, t);
    }
    this.out ??= this.target(this.size, this.gl.RGBA8, this.gl.LINEAR);
    const gl = this.gl;
    const spots = this.filled ?? b.forward;
    this.pass(
      this.render,
      this.out,
      [
        ["frameA", a.color.texture],
        ["frameB", b.color.texture],
        ["projected", spots.texture],
        ["lumaA", a.luma[0]!.texture],
        ["lumaB", b.luma[0]!.texture],
        ["forward", b.forward.texture],
      ],
      (use) => {
        gl.uniform1f(use("t"), t);
        gl.uniform1i(use("motion"), motion ? 1 : 0);
        gl.uniform2f(use("fieldSize"), spots.size.width, spots.size.height);
        gl.uniform1f(use("lastLevel"), lastLevelOf(b.forward.size));
      },
    );
    return { texture: this.out.texture, size: this.size };
  }

  /** Steps 1 and 2: the paths forward (from frame a to frame b) and backward (from b to a), coarse to fine. */
  private findPaths(a: Slot, b: Slot): void {
    this.searchPaths(a, b, b.forward);
    this.searchPaths(b, a, b.backward);
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, b.forward.texture);
    gl.generateMipmap(gl.TEXTURE_2D);
    b.pathsFrom = a.serial;
  }

  /** Where each part of frame `from` went in frame `to`, into `into`. */
  private searchPaths(from: Slot, to: Slot, into: Target): void {
    const gl = this.gl;
    const coarsest = from.luma.length - 1;
    const scaleOf = (level: number): [number, number] => [this.size.width / from.luma[level]!.size.width, this.size.height / from.luma[level]!.size.height];
    this.pass(this.search!, this.work[coarsest]!, [["lumaA", from.luma[coarsest]!.texture], ["lumaB", to.luma[coarsest]!.texture]], (use) => {
      gl.uniform2f(use("scale"), ...scaleOf(coarsest));
    });
    for (let level = coarsest - 1; level >= 0; level--) {
      this.pass(
        this.refine!,
        this.work[level]!,
        [
          ["lumaA", from.luma[level]!.texture],
          ["lumaB", to.luma[level]!.texture],
          ["coarse", this.work[level + 1]!.texture],
        ],
        (use) => {
          gl.uniform2f(use("scale"), ...scaleOf(level));
          gl.uniform2f(use("coarseSize"), this.work[level + 1]!.size.width, this.work[level + 1]!.size.height);
          gl.uniform1f(use("stepSize"), level === 0 ? 0.5 : 1);
        },
      );
    }
    this.pass(this.median!, into, [["src", this.work[0]!.texture]]);
  }

  /** Step 3: both frames' parts carried to the moment `t`, nearest the eye kept, the spots between filled (into `this.filled`). */
  private project(b: Slot, t: number): void {
    const gl = this.gl;
    const field = b.forward.size;
    this.projected ??= this.depthTarget(field);
    this.filled ??= this.target(field, gl.RGBA16F, gl.NEAREST);
    const splat = this.splat!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.projected.framebuffer);
    gl.viewport(0, 0, field.width, field.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.useProgram(splat.program);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, b.forward.texture);
    gl.uniform1i(splat.uniform("forward"), 1);
    gl.uniform1f(splat.uniform("lastLevel"), lastLevelOf(field));
    gl.uniform2f(splat.uniform("fieldSize"), field.width, field.height);
    gl.uniform2f(splat.uniform("scale"), this.size.width / field.width, this.size.height / field.height);
    gl.activeTexture(gl.TEXTURE0);
    const cells = field.width * field.height;
    // The older frame's parts go forward t of their way; the newer frame's go back 1 - t of theirs.
    for (const [paths, travel, direction, fromB] of [
      [b.forward, t, 1, 0],
      [b.backward, 1 - t, -1, 1],
    ] as const) {
      gl.bindTexture(gl.TEXTURE_2D, paths.texture);
      gl.uniform1i(splat.uniform("field"), 0);
      gl.uniform1f(splat.uniform("travel"), travel);
      gl.uniform1f(splat.uniform("direction"), direction);
      gl.uniform1f(splat.uniform("fromB"), fromB);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, cells);
    }
    gl.disable(gl.DEPTH_TEST);
    // Two rounds of filling (5 x 5 each): the projected spots into `filled`, and back.
    this.pass(this.fill!, this.filled, [["src", this.projected.texture], ["forward", b.forward.texture]], (use) => gl.uniform1f(use("lastLevel"), lastLevelOf(field)));
    this.pass(this.fill!, this.projected, [["src", this.filled.texture], ["forward", b.forward.texture]], (use) => gl.uniform1f(use("lastLevel"), lastLevelOf(field)));
    this.pass(this.fill!, this.filled, [["src", this.projected.texture], ["forward", b.forward.texture]], (use) => gl.uniform1f(use("lastLevel"), lastLevelOf(field)));
  }

  /** Draws `program` into `target`, with `textures` bound to its samplers (in order, from unit 0), `size` set to the target's, and what `numbers` sets. */
  private pass(program: Program, target: Target, textures: readonly [string, WebGLTexture][], numbers?: (use: (name: string) => WebGLUniformLocation | null) => void): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.size.width, target.size.height);
    gl.useProgram(program.program);
    textures.forEach(([name, texture], unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(program.uniform(name), unit);
    });
    gl.uniform2f(program.uniform("size"), target.size.width, target.size.height);
    numbers?.(program.uniform);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
  }

  private allocate(size: Size): void {
    this.dispose();
    const gl = this.gl;
    this.size = { ...size };
    const levels = pyramidLevels(size);
    const lumaSizes: Size[] = [halfOf(size)];
    for (let level = 1; level < levels; level++) lumaSizes.push(halfOf(lumaSizes[level - 1]!));
    const pathFormat = this.floatTargets ? gl.RGBA16F : gl.RGBA8;
    for (let index = 0; index < this.held; index++) {
      this.slots.push({
        serial: 0,
        color: this.target(size, gl.RGBA8, gl.LINEAR),
        luma: lumaSizes.map((each) => this.target(each, gl.R8, gl.LINEAR)),
        forward: this.target(lumaSizes[0]!, pathFormat, gl.NEAREST, true),
        backward: this.target(lumaSizes[0]!, pathFormat, gl.NEAREST),
        pathsFrom: -1,
      });
    }
    if (this.floatTargets) this.work = lumaSizes.map((each) => this.target(each, gl.RGBA16F, gl.LINEAR));
  }

  private target(size: Size, format: number, filter: number, mipmaps = false): Target {
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, mipmaps ? lastLevelOf(size) + 1 : 1, format, size.width, size.height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmaps ? gl.LINEAR_MIPMAP_NEAREST : filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, mipmaps ? gl.LINEAR : filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    return { texture, framebuffer, size: { ...size } };
  }

  private depthTarget(size: Size): Target & { depth: WebGLRenderbuffer } {
    const gl = this.gl;
    const target = this.target(size, gl.RGBA16F, gl.NEAREST);
    const depth = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, size.width, size.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    return { ...target, depth };
  }

  private link(fragment: string, vertex = FULLSCREEN_VERTEX): Program {
    const gl = this.gl;
    const compile = (type: number, code: string): WebGLShader => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, code);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`A frame boost shader did not compile: ${gl.getShaderInfoLog(shader) ?? ""}`);
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`A frame boost shader did not link: ${gl.getProgramInfoLog(program) ?? ""}`);
    const places = new Map<string, WebGLUniformLocation | null>();
    return {
      program,
      uniform: (name) => {
        if (!places.has(name)) places.set(name, gl.getUniformLocation(program, name));
        return places.get(name)!;
      },
    };
  }

  dispose(): void {
    const gl = this.gl;
    const all = [
      ...this.slots.flatMap((slot) => [slot.color, ...slot.luma, slot.forward, slot.backward]),
      ...this.work,
      ...(this.out ? [this.out] : []),
      ...(this.projected ? [this.projected] : []),
      ...(this.filled ? [this.filled] : []),
    ];
    for (const each of all) {
      gl.deleteTexture(each.texture);
      gl.deleteFramebuffer(each.framebuffer);
    }
    if (this.projected) gl.deleteRenderbuffer(this.projected.depth);
    this.slots.length = 0;
    this.work = [];
    this.out = undefined;
    this.projected = undefined;
    this.filled = undefined;
    this.size = { width: 0, height: 0 };
  }
}
