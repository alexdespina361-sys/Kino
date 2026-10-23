import { clamp, lerp } from "../../math";
import type { CatCoat } from "../../settings";
import type { Solved } from "../rig";
import { COATS } from "./coats";
import { decodeClips } from "./clipfile";
import { Director, headYawOf, tipOf } from "./director";
import { decodeMesh, type CatMesh } from "./format";
import { HEAD_CENTRE } from "./mouth";
import { SKIN_LINEAR, Skeleton, globals, matrixOf, solveDual } from "./pose";
import { FRAGMENT, SHADOW_FRAGMENT, SHADOW_VERTEX, VERTEX } from "./shader";
import { mat, mul, pitchAbout } from "./world";

/**
 * The solid cat: the mesh, skinned on the graphics card by the bones of the skeleton it was made with (pose.ts), moved by clips (director.ts), and lit. This file only
 * draws; what the cat does is decided by the engine and the director, and what it looks like is the mesh and the shader.
 */

export interface View {
  /** Where the camera looks down from, radians (0 is level). */
  tilt?: number;
  /** Turns the body about the vertical, radians, over what the rig says (for looking at it from the front or the back in the lab). */
  turn?: number;
  /** 0: the finished picture; 1: normals; 2: how closed in; 3: which bone; 4: the colour the mesh carries. */
  debug?: number;
  /** Wear this coat for this picture (default: the one the cat was given with `setCoat`). */
  coat?: CatCoat;
  /** How much of the skin is bones as matrices averaged, as the model's own program does it, and how much quaternions blended: 0 to 1, or true for 1 (default: `SKIN_LINEAR`; for the lab, to see what the one saves over the other). */
  linear?: boolean | number;
}

export interface Box {
  /** Where the cat's feet are, in CSS pixels from the canvas's top left, and the body length in CSS pixels. */
  ox: number;
  oy: number;
  px: number;
}

const TILT = 0.14;
/** The shader has room for this many bones. */
const MAX_SHADER_BONES = 40;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader: ${log}`);
  }
  return shader;
}

function link(gl: WebGLRenderingContext, vs: string, fs: string): WebGLProgram {
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`program: ${gl.getProgramInfoLog(program)}`);
  return program;
}

const ATTRIBUTES = ["aPos", "aNor", "aSkin", "aWgt", "aColor", "aPart"] as const;
const UNIFORMS = ["uDQ", "uWorld", "uProj", "uLinear", "uSide", "uAppear", "uDebug", "uHead", "uEyes", "uEyes2", "uGlint", "uIris0", "uIris1", "uIris2", "uKey", "uFill", "uBase", "uLight", "uStripeC", "uWhiteC", "uPatchA", "uPatchB", "uPointC", "uCoat", "uOwn"] as const;

export class GlCat {
  readonly canvas: HTMLCanvasElement;
  readonly skeleton: Skeleton;
  readonly director: Director;
  private gl: WebGLRenderingContext;
  private mesh: CatMesh;
  private main: WebGLProgram;
  private shadow: WebGLProgram;
  private buffers: WebGLBuffer[] = [];
  private indexBuffer: WebGLBuffer;
  private cornerBuffer: WebGLBuffer;
  private loc: Record<string, number | WebGLUniformLocation | null> = {};
  /** The bones as the card has them: eight numbers each, a dual quaternion (pose.ts, `solveDual`). */
  private bones: Float32Array;
  private world = mat();
  /** (the same, for the card: it takes 32-bit numbers) */
  private worldRows = new Float32Array(12);
  private tmp = mat();
  /** Where the head's own up and across lie in the picture, as the last `step` left them (up x, up y, across x, across y). */
  private readonly headFrame = [0, 1, 0, 0];
  private readonly rot = new Float64Array(9);
  private cssW = 1;
  private cssH = 1;
  private dpr = 1;
  private gone = false;
  private readonly probe = new Uint8Array(4);
  private coat: CatCoat = "ragdoll";
  private readonly headBone: number;
  lost = false;

  private constructor(canvas: HTMLCanvasElement, gl: WebGLRenderingContext, mesh: CatMesh, skeleton: Skeleton, director: Director) {
    this.canvas = canvas;
    this.gl = gl;
    this.mesh = mesh;
    this.skeleton = skeleton;
    this.director = director;
    this.bones = new Float32Array(skeleton.count * 8);
    this.headBone = skeleton.bone("head");
    this.main = link(gl, VERTEX, FRAGMENT);
    this.shadow = link(gl, SHADOW_VERTEX, SHADOW_FRAGMENT);
    const buffer = (target: number, data: ArrayBufferView): WebGLBuffer => {
      const b = gl.createBuffer()!;
      gl.bindBuffer(target, b);
      gl.bufferData(target, data, gl.STATIC_DRAW);
      this.buffers.push(b);
      return b;
    };
    buffer(gl.ARRAY_BUFFER, mesh.pos);
    buffer(gl.ARRAY_BUFFER, mesh.normal);
    buffer(gl.ARRAY_BUFFER, mesh.skin);
    buffer(gl.ARRAY_BUFFER, mesh.weight);
    buffer(gl.ARRAY_BUFFER, mesh.color);
    buffer(gl.ARRAY_BUFFER, mesh.part);
    this.indexBuffer = buffer(gl.ELEMENT_ARRAY_BUFFER, mesh.index);
    this.cornerBuffer = buffer(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]));
    for (const name of ATTRIBUTES) this.loc[name] = gl.getAttribLocation(this.main, name);
    for (const name of UNIFORMS) this.loc[name] = gl.getUniformLocation(this.main, name);
    this.loc.aCorner = gl.getAttribLocation(this.shadow, "aCorner");
    this.loc.sRect = gl.getUniformLocation(this.shadow, "uRect");
    this.loc.sStrength = gl.getUniformLocation(this.shadow, "uStrength");
    canvas.addEventListener("webglcontextlost", this.onLost);
  }

  /**
   * A solid cat on the canvas, or null if this browser cannot, or the files are not a mesh and clips made for each other. Without clips the cat stands in the rest of its
   * skeleton (it moves its head, jaw and ears, and nothing else).
   */
  static create(canvas: HTMLCanvasElement, data: ArrayBuffer, clips: ArrayBuffer | null = null, options: { preserve?: boolean } = {}): GlCat | null {
    let gl: WebGLRenderingContext | null = null;
    // (a context that was made and is not going to be used is given back: a browser lets a page have only so many)
    const refuse = (): null => {
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
      return null;
    };
    try {
      const attrs: WebGLContextAttributes = { alpha: true, premultipliedAlpha: true, antialias: true, depth: true, stencil: false, powerPreference: "low-power", preserveDrawingBuffer: options.preserve === true };
      const mesh = decodeMesh(data);
      if (mesh.skeleton.names.length > MAX_SHADER_BONES) return null;
      const skeleton = new Skeleton(mesh.skeleton);
      // (the clips are made for one skeleton, and refuse to be worn by another)
      const director = new Director(skeleton, clips ? decodeClips(clips, skeleton) : []);
      gl = (canvas.getContext("webgl", attrs) ?? canvas.getContext("experimental-webgl", attrs)) as WebGLRenderingContext | null;
      if (!gl) return null;
      // (what the shaders need of the card: room for the bones, and numbers that are not too coarse to paint the face with)
      if ((gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS) as number) < 96) return refuse();
      if ((gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision ?? 0) < 16) return refuse();
      return new GlCat(canvas, gl, mesh, skeleton, director);
    } catch {
      return refuse();
    }
  }

  private onLost = (event: Event): void => {
    event.preventDefault();
    this.lost = true;
  };

  /** The coat the cat wears from the next picture on. */
  setCoat(coat: CatCoat): void {
    this.coat = coat;
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
  }

  /** The matrix that takes the cat's own space to the one the camera looks at: the body's turn, squash and tilt, then the camera's lean. */
  private worldOf(s: Solved, view: View): void {
    const w = this.world;
    const t = this.tmp;
    const g = lerp(0.82, 1, clamp(s.appear, 0, 1));
    const sx = g * s.sx;
    const sy = g * s.sy;
    const sz = g * (s.sx + s.sy) * 0.5;
    // the pitch of a leap, about the middle of the body (the rig's angle is turned over: its y is down), as the flat painter's is: that point stays where it is
    // (a climb is told in the ledge's own space by its clip, which hangs the body and does the travel itself: the rig's tip for the flat cat would turn it twice)
    pitchAbout(w, -tipOf(s), 0.4);
    // squash and grow
    t.fill(0);
    t[0] = sx;
    t[5] = sy;
    t[10] = sz;
    mul(w, t, w);
    // the turn about the vertical: facing right is no turn, facing left is half a turn, and the face-on moment is between
    const yaw = -(Math.PI / 2) * (1 - s.flip) + (view.turn ?? 0);
    const cyw = Math.cos(yaw);
    const syw = Math.sin(yaw);
    t.fill(0);
    t[0] = cyw;
    t[2] = syw;
    t[5] = 1;
    t[8] = -syw;
    t[10] = cyw;
    mul(w, t, w);
    // the camera looks down a little
    const tilt = view.tilt ?? TILT;
    const ct = Math.cos(tilt);
    const st = Math.sin(tilt);
    t.fill(0);
    t[0] = 1;
    t[5] = ct;
    t[6] = -st;
    t[9] = st;
    t[10] = ct;
    mul(w, t, w);
  }

  /** How far the head is turned about the vertical against the body: from the rig's `yaw` (0 faces the viewer, 1 faces the way the body faces). */
  headYaw(s: Solved): number {
    return headYawOf(s);
  }

  /** Moves the bones on by what the rig solved (one call for each picture of a moving cat; `draw` does it itself). */
  step(s: Solved, box: Box, view: View = {}): void {
    this.worldOf(s, view);
    this.director.update(s, s.dt, box.px, this.headYaw(s));
    solveDual(this.skeleton, this.director.pose, this.bones, this.director.adjust);
    // where the head's own up and across lie in the picture (the whole cat's turn after the head's), for the catch of light in the eyes
    const h = this.headBone * 8;
    const b = this.bones;
    const R = this.rot;
    const W = this.world;
    matrixOf(R, b[h]!, b[h + 1]!, b[h + 2]!, b[h + 3]!);
    const f = this.headFrame;
    f[0] = W[0]! * R[1]! + W[1]! * R[4]! + W[2]! * R[7]!;
    f[1] = W[4]! * R[1]! + W[5]! * R[4]! + W[6]! * R[7]!;
    f[2] = W[0]! * R[2]! + W[1]! * R[5]! + W[2]! * R[8]!;
    f[3] = W[4]! * R[2]! + W[5]! * R[5]! + W[6]! * R[8]!;
  }

  /** Where a bone's joint is in the cat's own space (x forward, y up from the feet, z toward the viewer; body lengths) as the last `step` left it. For the lab, which looks closely at places. */
  place(bone: string): [number, number, number] {
    const n = this.skeleton.count;
    const R = new Float64Array(n * 9);
    const T = new Float64Array(n * 3);
    globals(this.skeleton, this.director.pose, this.director.adjust, R, T);
    const j = this.skeleton.bone(bone);
    return [T[j * 3]!, T[j * 3 + 1]!, T[j * 3 + 2]!];
  }

  draw(s: Solved, box: Box, view: View = {}): void {
    if (this.gone || this.lost) return;
    const gl = this.gl;
    this.step(s, box, view);

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const appear = clamp(s.appear, 0, 1);

    // --- the shadow on the ground
    {
      gl.useProgram(this.shadow);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const sw = 0.5 * (1 - 0.35 * s.air) * box.px;
      const sh = sw * 0.17;
      const cx = box.ox;
      const cy = box.oy + 0.01 * box.px;
      gl.uniform4f(this.loc.sRect as WebGLUniformLocation, (2 * cx) / this.cssW - 1, 1 - (2 * cy) / this.cssH, (2 * sw) / this.cssW, (2 * sh) / this.cssH);
      gl.uniform1f(this.loc.sStrength as WebGLUniformLocation, 0.42 * (1 - 0.5 * s.air) * appear * s.shadow);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
      const a = this.loc.aCorner as number;
      gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.disableVertexAttribArray(a);
    }

    // --- the cat (the thin tufts of its coat are one sheet each: they are seen from both sides, so nothing is culled)
    gl.useProgram(this.main);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    const sc = (2 * box.px) / this.cssW;
    const sy = (2 * box.px) / this.cssH;
    gl.uniform4f(this.loc.uProj as WebGLUniformLocation, sc, sy, (2 * box.ox) / this.cssW - 1, 1 - (2 * box.oy) / this.cssH);
    gl.uniform1f(this.loc.uLinear as WebGLUniformLocation, view.linear === undefined ? SKIN_LINEAR : clamp(Number(view.linear), 0, 1));
    gl.uniform4fv(this.loc.uDQ as WebGLUniformLocation, this.bones);
    this.worldRows.set(this.world);
    gl.uniform4fv(this.loc.uWorld as WebGLUniformLocation, this.worldRows);
    // (which side of the cat faces the viewer: where the cat's own z axis points once it is turned)
    gl.uniform1f(this.loc.uSide as WebGLUniformLocation, clamp(this.world[10]! / 0.35, -1, 1));
    gl.uniform1f(this.loc.uAppear as WebGLUniformLocation, appear);
    gl.uniform1f(this.loc.uDebug as WebGLUniformLocation, view.debug ?? 0);
    gl.uniform3f(this.loc.uHead as WebGLUniformLocation, HEAD_CENTRE[0], HEAD_CENTRE[1], 0);
    const h = s.head;
    gl.uniform4f(this.loc.uEyes as WebGLUniformLocation, h.openL, h.openR, h.pupil, h.happy > 0.5 ? 1 : 0);
    gl.uniform4f(this.loc.uEyes2 as WebGLUniformLocation, clamp(-s.flip * (h.eyeX - h.yaw * 0.9), -1, 1), clamp(-h.eyeY, -1, 1), h.asleep > 0.5 ? 1 : 0, h.jaw);
    // where the catch of light lies in each eye: toward the upper right of the picture, whichever way the head is turned (the eye's own across and up, as they are
    // in the picture, say how far along each to go)
    {
      const [upX, upY, acrossX, acrossY] = this.headFrame as [number, number, number, number];
      const glintOf = (side: number, out: number[], at: number): void => {
        const ax = side * acrossX;
        const ay = side * acrossY;
        const want = { x: 0.0095, y: 0.0098 };
        const det = ax * upY - upX * ay;
        let qx: number;
        let qy: number;
        if (Math.abs(det) > 0.35) {
          qx = (want.x * upY - upX * want.y) / det;
          qy = (ax * want.y - want.x * ay) / det;
        } else {
          qx = (want.x * ax + want.y * ay) / Math.max(ax * ax + ay * ay, 0.3);
          qy = (want.x * upX + want.y * upY) / Math.max(upX * upX + upY * upY, 0.3);
        }
        const len = Math.hypot(qx, qy);
        const k = len > 0.0145 ? 0.0145 / len : 1;
        out[at] = qx * k;
        out[at + 1] = qy * k;
      };
      const glint = [0, 0, 0, 0];
      glintOf(1, glint, 0);
      glintOf(-1, glint, 2);
      gl.uniform4f(this.loc.uGlint as WebGLUniformLocation, glint[0]!, glint[1]!, glint[2]!, glint[3]!);
    }
    const coat = COATS[view.coat ?? this.coat];
    gl.uniform3f(this.loc.uBase as WebGLUniformLocation, coat.base[0], coat.base[1], coat.base[2]);
    gl.uniform3f(this.loc.uLight as WebGLUniformLocation, coat.light[0], coat.light[1], coat.light[2]);
    gl.uniform3f(this.loc.uStripeC as WebGLUniformLocation, coat.stripe[0], coat.stripe[1], coat.stripe[2]);
    gl.uniform3f(this.loc.uWhiteC as WebGLUniformLocation, coat.white[0], coat.white[1], coat.white[2]);
    gl.uniform3f(this.loc.uPatchA as WebGLUniformLocation, coat.patchA[0], coat.patchA[1], coat.patchA[2]);
    gl.uniform3f(this.loc.uPatchB as WebGLUniformLocation, coat.patchB[0], coat.patchB[1], coat.patchB[2]);
    gl.uniform3f(this.loc.uPointC as WebGLUniformLocation, coat.point[0], coat.point[1], coat.point[2]);
    gl.uniform4f(this.loc.uCoat as WebGLUniformLocation, coat.stripes, coat.whites, coat.tuxedo, coat.patches);
    gl.uniform2f(this.loc.uOwn as WebGLUniformLocation, coat.own ? 1 : 0, coat.gain);
    gl.uniform3f(this.loc.uIris0 as WebGLUniformLocation, coat.iris[0][0], coat.iris[0][1], coat.iris[0][2]);
    gl.uniform3f(this.loc.uIris1 as WebGLUniformLocation, coat.iris[1][0], coat.iris[1][1], coat.iris[1][2]);
    gl.uniform3f(this.loc.uIris2 as WebGLUniformLocation, coat.iris[2][0], coat.iris[2][1], coat.iris[2][2]);
    gl.uniform3f(this.loc.uKey as WebGLUniformLocation, -0.45, 0.75, 0.55);
    gl.uniform3f(this.loc.uFill as WebGLUniformLocation, 0.7, 0.2, 0.4);

    const bind = (index: number, name: (typeof ATTRIBUTES)[number], size: number, type: number, normalized: boolean): void => {
      const a = this.loc[name] as number;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[index]!);
      gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(a, size, type, normalized, 0, 0);
    };
    bind(0, "aPos", 3, gl.FLOAT, false);
    bind(1, "aNor", 3, gl.BYTE, true);
    bind(2, "aSkin", 4, gl.UNSIGNED_BYTE, false);
    bind(3, "aWgt", 4, gl.UNSIGNED_BYTE, true);
    bind(4, "aColor", 4, gl.UNSIGNED_BYTE, true);
    bind(5, "aPart", 4, gl.UNSIGNED_BYTE, true);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.drawElements(gl.TRIANGLES, this.mesh.index.length, gl.UNSIGNED_SHORT, 0);
    for (const name of ATTRIBUTES) gl.disableVertexAttribArray(this.loc[name] as number);
  }

  /**
   * Waits until the card has finished what it was given (a card answers later than it is asked: this is for timing it). Reading back one pixel is what
   * makes a browser wait: `finish()` is only a flush in the browsers that TVs have (Chrome's), and a flush returns at once whatever the picture costs.
   */
  finish(): void {
    if (!this.gone && !this.lost) this.gl.readPixels(0, 0, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, this.probe);
  }

  dispose(): void {
    if (this.gone) return;
    this.gone = true;
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    try {
      const gl = this.gl;
      for (const b of this.buffers) gl.deleteBuffer(b);
      gl.deleteProgram(this.main);
      gl.deleteProgram(this.shadow);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      /* a picture that was already taken away has nothing left to give back */
    }
  }
}
