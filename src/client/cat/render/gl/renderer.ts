import { clamp, lerp } from "../../math";
import type { CatCoat } from "../../settings";
import type { Solved } from "../rig";
import { COATS } from "./coats";
import { decodeMesh, type CatMesh } from "./format";
import { FRAGMENT, SHADOW_FRAGMENT, SHADOW_VERTEX, VERTEX } from "./shader";
import { EARS } from "./model";
import { BONE, BONE_COUNT, BONE_FLOATS, Skeleton, mat, mul, pitchAbout, restStamp } from "./skeleton";
import { makeWhiskers } from "./whiskers";

/**
 * The solid cat: the mesh, skinned on the graphics card by the bones the rig's numbers give (skeleton.ts), lit, and covered in fur by a few
 * shells. This file only draws; what the cat does is decided elsewhere, and what it looks like is the mesh and the shader.
 */

export interface View {
  /** Where the camera looks down from, radians (0 is level). */
  tilt?: number;
  /** Turns the body about the vertical, radians, over what the rig says (for looking at it from the front or the back in the lab). */
  turn?: number;
  /** 0: the finished picture; 1: normals; 2: how closed in; 3: which bone. */
  debug?: number;
  /** How many shells of fur (default: as many as the card is asked for). */
  shells?: number;
  /** Draw the whiskers (default: yes). */
  whiskers?: boolean;
  /** Wear this coat for this picture (default: the one the cat was given with `setCoat`). */
  coat?: CatCoat;
}

export interface Box {
  /** Where the cat's feet are, in CSS pixels from the canvas's top left, and the body length in CSS pixels. */
  ox: number;
  oy: number;
  px: number;
}

const TILT = 0.14;
/** How long the hair is where the coat is of the usual length, in body lengths (the mesh says where it is longer or shorter). */
const FUR_LENGTH = 0.03;
/** The ears' frames, for the shader (the inside of an ear is painted by where a point is in the ear's own frame). */
const EAR_UNIFORM = new Float32Array(EARS.flatMap((ear) => [...ear.base, ...ear.a, ...ear.b, ...ear.c]));

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

export class GlCat {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;
  private mesh: CatMesh;
  private skeleton = new Skeleton();
  private main: WebGLProgram;
  private shadow: WebGLProgram;
  private buffers: WebGLBuffer[] = [];
  private whiskerBuffers: WebGLBuffer[] = [];
  private whiskerCount = 0;
  private indexBuffer: WebGLBuffer;
  private cornerBuffer: WebGLBuffer;
  private loc: Record<string, number | WebGLUniformLocation | null> = {};
  private bones = new Float32Array(BONE_COUNT * BONE_FLOATS);
  private world = mat();
  private tmp = mat();
  private tmp2 = mat();
  private cssW = 1;
  private cssH = 1;
  private dpr = 1;
  private gone = false;
  private readonly probe = new Uint8Array(4);
  private coat: CatCoat = "ragdoll";
  lost = false;

  private constructor(canvas: HTMLCanvasElement, gl: WebGLRenderingContext, mesh: CatMesh) {
    this.canvas = canvas;
    this.gl = gl;
    this.mesh = mesh;
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
    buffer(gl.ARRAY_BUFFER, mesh.paint);
    this.indexBuffer = buffer(gl.ELEMENT_ARRAY_BUFFER, mesh.index);
    this.cornerBuffer = buffer(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]));
    for (const name of ["aPos", "aNor", "aSkin", "aWgt", "aPaint"]) this.loc[name] = gl.getAttribLocation(this.main, name);
    for (const name of ["uBones", "uProj", "uShell", "uShells", "uFreq", "uFurLen", "uAppear", "uDebug", "uWhisker", "uHead", "uEyes", "uEyes2", "uGlint", "uIris0", "uIris1", "uIris2", "uPointC", "uPoints", "uKey", "uFill", "uEarA", "uBase", "uLight", "uStripeC", "uWhiteC", "uPatchA", "uPatchB", "uCoat"]) {
      this.loc[name] = gl.getUniformLocation(this.main, name);
    }
    // the whiskers have buffers of their own and are drawn with the same program
    const w = makeWhiskers();
    this.whiskerCount = w.count;
    this.whiskerBuffers = [buffer(gl.ARRAY_BUFFER, w.pos), buffer(gl.ARRAY_BUFFER, w.normal), buffer(gl.ARRAY_BUFFER, w.skin), buffer(gl.ARRAY_BUFFER, w.weight), buffer(gl.ARRAY_BUFFER, w.paint)];
    this.loc.aCorner = gl.getAttribLocation(this.shadow, "aCorner");
    this.loc.sRect = gl.getUniformLocation(this.shadow, "uRect");
    this.loc.sStrength = gl.getUniformLocation(this.shadow, "uStrength");
    canvas.addEventListener("webglcontextlost", this.onLost);
  }

  /** A solid cat on the canvas, or null if this browser cannot. */
  static create(canvas: HTMLCanvasElement, data: ArrayBuffer, options: { preserve?: boolean } = {}): GlCat | null {
    let gl: WebGLRenderingContext | null = null;
    // (a context that was made and is not going to be used is given back: a browser lets a page have only so many)
    const refuse = (): null => {
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
      return null;
    };
    try {
      const attrs: WebGLContextAttributes = { alpha: true, premultipliedAlpha: true, antialias: true, depth: true, stencil: false, powerPreference: "low-power", preserveDrawingBuffer: options.preserve === true };
      const mesh = decodeMesh(data);
      if (mesh.rest !== restStamp()) return null; // (a mesh made around another rest pose would be worn crooked)
      gl = (canvas.getContext("webgl", attrs) ?? canvas.getContext("experimental-webgl", attrs)) as WebGLRenderingContext | null;
      if (!gl) return null;
      // (what the shaders need of the card: room for the bones, and numbers that are not too coarse to make fur of)
      if ((gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS) as number) < 112) return refuse();
      if ((gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision ?? 0) < 16) return refuse();
      return new GlCat(canvas, gl, mesh);
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
    pitchAbout(w, -s.pitch, 0.4);
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
    const away = 1 - Math.min(1, Math.abs(s.head.yaw) * 1.0);
    const turn = -(Math.PI / 2) * s.flip * (1 - s.head.yaw);
    void away;
    return clamp(turn, -2.1, 2.1);
  }

  draw(s: Solved, box: Box, view: View = {}): void {
    if (this.gone || this.lost) return;
    const gl = this.gl;
    const rest = this.mesh;
    void rest;
    this.worldOf(s, view);
    this.skeleton.solve(s, this.headYaw(s), this.world, this.bones);

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const appear = clamp(s.appear, 0, 1);

    // --- the shadow on the ground
    {
      gl.useProgram(this.shadow);
      gl.disable(gl.DEPTH_TEST);
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

    // --- the cat
    gl.useProgram(this.main);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    const sc = (2 * box.px) / this.cssW;
    const sy = (2 * box.px) / this.cssH;
    gl.uniform4f(this.loc.uProj as WebGLUniformLocation, sc, sy, (2 * box.ox) / this.cssW - 1, 1 - (2 * box.oy) / this.cssH);
    gl.uniform4fv(this.loc.uBones as WebGLUniformLocation, this.bones);
    gl.uniform1f(this.loc.uAppear as WebGLUniformLocation, appear);
    gl.uniform1f(this.loc.uDebug as WebGLUniformLocation, view.debug ?? 0);
    gl.uniform3f(this.loc.uHead as WebGLUniformLocation, this.skeleton.restUp.head.x, this.skeleton.restUp.head.y, 0);
    const h = s.head;
    gl.uniform4f(this.loc.uEyes as WebGLUniformLocation, h.openL, h.openR, h.pupil, h.happy > 0.5 ? 1 : 0);
    gl.uniform4f(this.loc.uEyes2 as WebGLUniformLocation, clamp(-s.flip * (h.eyeX - h.yaw * 0.9), -1, 1), clamp(-h.eyeY, -1, 1), h.asleep > 0.5 ? 1 : 0, h.jaw);
    // where the catch of light lies in each eye: toward the upper right of the picture, whichever way the head is turned (the eye's own across and up, as they are
    // in the picture, say how far along each to go)
    {
      const hb = BONE.head * BONE_FLOATS;
      const m = this.bones;
      const upX = m[hb + 1]!;
      const upY = m[hb + 5]!;
      const glintOf = (side: number, out: number[], at: number): void => {
        const ax = side * m[hb + 2]!;
        const ay = side * m[hb + 6]!;
        const want = { x: 0.0112, y: 0.0122 };
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
        const k = len > 0.0185 ? 0.0185 / len : 1;
        out[at] = qx * k;
        out[at + 1] = qy * k;
      };
      const glint = [0, 0, 0, 0];
      glintOf(1, glint, 0);
      glintOf(-1, glint, 2);
      gl.uniform4f(this.loc.uGlint as WebGLUniformLocation, glint[0]!, glint[1]!, glint[2]!, glint[3]!);
    }
    gl.uniform3fv(this.loc.uEarA as WebGLUniformLocation, EAR_UNIFORM);
    const coat = COATS[view.coat ?? this.coat];
    gl.uniform3f(this.loc.uBase as WebGLUniformLocation, coat.base[0], coat.base[1], coat.base[2]);
    gl.uniform3f(this.loc.uLight as WebGLUniformLocation, coat.light[0], coat.light[1], coat.light[2]);
    gl.uniform3f(this.loc.uStripeC as WebGLUniformLocation, coat.stripe[0], coat.stripe[1], coat.stripe[2]);
    gl.uniform3f(this.loc.uWhiteC as WebGLUniformLocation, coat.white[0], coat.white[1], coat.white[2]);
    gl.uniform3f(this.loc.uPatchA as WebGLUniformLocation, coat.patchA[0], coat.patchA[1], coat.patchA[2]);
    gl.uniform3f(this.loc.uPatchB as WebGLUniformLocation, coat.patchB[0], coat.patchB[1], coat.patchB[2]);
    gl.uniform4f(this.loc.uCoat as WebGLUniformLocation, coat.stripes, coat.whites, coat.tuxedo, coat.patches);
    gl.uniform3f(this.loc.uPointC as WebGLUniformLocation, coat.point[0], coat.point[1], coat.point[2]);
    gl.uniform1f(this.loc.uPoints as WebGLUniformLocation, coat.points);
    gl.uniform3f(this.loc.uIris0 as WebGLUniformLocation, coat.iris[0][0], coat.iris[0][1], coat.iris[0][2]);
    gl.uniform3f(this.loc.uIris1 as WebGLUniformLocation, coat.iris[1][0], coat.iris[1][1], coat.iris[1][2]);
    gl.uniform3f(this.loc.uIris2 as WebGLUniformLocation, coat.iris[2][0], coat.iris[2][1], coat.iris[2][2]);
    gl.uniform3f(this.loc.uKey as WebGLUniformLocation, -0.45, 0.75, 0.55);
    gl.uniform3f(this.loc.uFill as WebGLUniformLocation, 0.7, 0.2, 0.4);
    // the hair is as long as this part of the cat's coat is (in body lengths, the longest the thickest: see the mesh), in as many layers as the screen can spare
    gl.uniform1f(this.loc.uFurLen as WebGLUniformLocation, FUR_LENGTH);
    gl.uniform1f(this.loc.uFreq as WebGLUniformLocation, clamp(box.px / 2.2, 40, 150));

    const bindAll = (from: WebGLBuffer[]): void => {
      const bind = (index: number, name: string, size: number, type: number, normalized: boolean) => {
        const a = this.loc[name] as number;
        gl.bindBuffer(gl.ARRAY_BUFFER, from[index]!);
        gl.enableVertexAttribArray(a);
        gl.vertexAttribPointer(a, size, type, normalized, 0, 0);
      };
      bind(0, "aPos", 3, gl.FLOAT, false);
      bind(1, "aNor", 3, gl.BYTE, true);
      bind(2, "aSkin", 4, gl.UNSIGNED_BYTE, false);
      bind(3, "aWgt", 4, gl.UNSIGNED_BYTE, true);
      bind(4, "aPaint", 4, gl.UNSIGNED_BYTE, true);
    };
    bindAll(this.buffers);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);

    const shells = view.shells ?? clamp(Math.round(box.px / 24), 3, 12);
    gl.uniform1f(this.loc.uShells as WebGLUniformLocation, shells);
    gl.uniform1f(this.loc.uShell as WebGLUniformLocation, 0);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.drawElements(gl.TRIANGLES, this.mesh.index.length, gl.UNSIGNED_SHORT, 0);

    if (shells > 0 && !view.debug) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      for (let i = 1; i <= shells; i++) {
        gl.uniform1f(this.loc.uShell as WebGLUniformLocation, i);
        gl.drawElements(gl.TRIANGLES, this.mesh.index.length, gl.UNSIGNED_SHORT, 0);
      }
      gl.depthMask(true);
    }

    // --- the whiskers, over the fur
    if (!view.debug && view.whiskers !== false) {
      bindAll(this.whiskerBuffers);
      gl.uniform1f(this.loc.uWhisker as WebGLUniformLocation, 1);
      gl.uniform1f(this.loc.uShell as WebGLUniformLocation, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.CULL_FACE);
      gl.depthMask(false);
      gl.drawArrays(gl.LINES, 0, this.whiskerCount);
      gl.depthMask(true);
      gl.uniform1f(this.loc.uWhisker as WebGLUniformLocation, 0);
    }
    for (const name of ["aPos", "aNor", "aSkin", "aWgt", "aPaint"]) gl.disableVertexAttribArray(this.loc[name] as number);
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

