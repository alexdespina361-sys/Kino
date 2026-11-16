/**
 * The frame boost of the upscaler test page (labs/upscale/): holds the video's last frames as textures in the upscaler's own WebGL 2 context
 * (glUpscaler.ts), so that what is shown goes to the Film and Sharp modes without a copy, and makes the cheapest frame between two ("Blend": the two mixed,
 * which shows what moves twice, faintly). The good frames between are RIFE's (rife.ts), made ahead and handed in with `upload`.
 *
 * (A motion search of Kino's own, block matching as TVs do it, was here until 16 Nov 2026: the owner found its tears around moving edges too visible,
 * and RIFE's frames are far closer to the real ones: 35-38 dB where it got 27-29, on Tears of Steel. It is in git history, commit b2ad53b.)
 */

import { FULLSCREEN_VERTEX } from "./fsrShaders";

/** How the frames between are made: by RIFE (an existing neural network), or by mixing the two. */
export type BoostHow = "rife" | "blend";

export interface Size {
  width: number;
  height: number;
}

interface Target {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  size: Size;
}

const BLEND_FRAGMENT = `#version 300 es
precision highp float;
out vec4 color;
uniform sampler2D frameA;
uniform sampler2D frameB;
uniform vec2 size;
uniform float t;
void main() {
  vec2 uv = gl_FragCoord.xy / size;
  color = vec4(mix(texture(frameA, uv).rgb, texture(frameB, uv).rgb, t), 1.0);
}`;

/** Holds the last few frames of the video (as `HELD_FRAMES` in boostTiming.ts says) and draws frames between two of them. */
export class FrameBoost {
  private readonly blend: { program: WebGLProgram; uniform: (name: string) => WebGLUniformLocation | null };
  private readonly slots: { serial: number; color: Target }[] = [];
  private size: Size = { width: 0, height: 0 };
  private pushed = 0;
  private out: Target | undefined;
  /** A frame made elsewhere (RIFE's), handed in by `upload`. */
  private made: Target | undefined;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly held = 3,
  ) {
    this.blend = this.link(BLEND_FRAGMENT);
  }

  /** Takes the video's next frame (`source` shows it now) and returns its number, by which `draw` names it. */
  push(source: TexImageSource, size: Size): number {
    if (size.width !== this.size.width || size.height !== this.size.height) this.allocate(size);
    const serial = ++this.pushed;
    const slot = this.slots[serial % this.held]!;
    slot.serial = serial;
    this.fill(slot.color, source);
    return serial;
  }

  /** Whether frame `serial` is still held. */
  holds(serial: number): boolean {
    return serial > 0 && this.slots[serial % this.held]?.serial === serial;
  }

  /**
   * The frame `t` of the way from frame `from` to frame `to`, mixed, as a texture of the video's size; at 0 or 1 it is one of them as it is (no work at
   * all). Throws when one of them is no longer held.
   */
  draw(from: number, to: number, t: number): { texture: WebGLTexture; size: Size } {
    if (!this.holds(from) || !this.holds(to)) throw new Error("The frame boost no longer holds that frame");
    const a = this.slots[from % this.held]!;
    const b = this.slots[to % this.held]!;
    if (t <= 0) return { texture: a.color.texture, size: this.size };
    if (t >= 1) return { texture: b.color.texture, size: this.size };
    const gl = this.gl;
    this.out ??= this.target(this.size);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.out.framebuffer);
    gl.viewport(0, 0, this.size.width, this.size.height);
    gl.useProgram(this.blend.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, a.color.texture);
    gl.uniform1i(this.blend.uniform("frameA"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, b.color.texture);
    gl.uniform1i(this.blend.uniform("frameB"), 1);
    gl.uniform2f(this.blend.uniform("size"), this.size.width, this.size.height);
    gl.uniform1f(this.blend.uniform("t"), t);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
    return { texture: this.out.texture, size: this.size };
  }

  /** A frame made elsewhere (RIFE's: RGBA bytes of the video's size) as a texture, to be drawn like the others. */
  upload(source: TexImageSource, size: Size): { texture: WebGLTexture; size: Size } {
    if (size.width !== this.size.width || size.height !== this.size.height) this.allocate(size);
    this.made ??= this.target(this.size);
    this.fill(this.made, source);
    return { texture: this.made.texture, size: this.size };
  }

  private fill(target: Target, source: TexImageSource): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); // (row 0 = the top of the picture, as everywhere here)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  private allocate(size: Size): void {
    this.dispose();
    this.size = { ...size };
    for (let index = 0; index < this.held; index++) this.slots.push({ serial: 0, color: this.target(size) });
  }

  private target(size: Size): Target {
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, size.width, size.height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    return { texture, framebuffer, size: { ...size } };
  }

  private link(fragment: string): { program: WebGLProgram; uniform: (name: string) => WebGLUniformLocation | null } {
    const gl = this.gl;
    const compile = (type: number, code: string): WebGLShader => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, code);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`A frame boost shader did not compile: ${gl.getShaderInfoLog(shader) ?? ""}`);
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, FULLSCREEN_VERTEX));
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
    for (const each of [...this.slots.map((slot) => slot.color), ...(this.out ? [this.out] : []), ...(this.made ? [this.made] : [])]) {
      gl.deleteTexture(each.texture);
      gl.deleteFramebuffer(each.framebuffer);
    }
    this.slots.length = 0;
    this.out = undefined;
    this.made = undefined;
    this.size = { width: 0, height: 0 };
  }
}
