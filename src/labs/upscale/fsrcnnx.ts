/**
 * The "Film" modes: FSRCNNX (igv, https://github.com/igv/FSRCNN-TensorFlow, release 1.1), small neural networks trained on photographs that double the
 * luma (the brightness) of a picture, written as mpv "user shaders" (GLSL, one fragment shader a pass). Those files are LGPL 3.0, the one part of this
 * page that is not MIT: they are served unchanged from /labs/upscale/fsrcnnx/ with their licence, fetched when a Film mode is first chosen, and run here.
 *
 * This file reads mpv's format (`//!HOOK`, `//!BIND`, `//!SAVE`, `//!WIDTH`, `//!HEIGHT`; `//!WHEN` and `//!COMPONENTS` are not needed here) and gives
 * each pass the names mpv would: `NAME_tex(pos)`, `NAME_texOff(offset in pixels)`, `NAME_pos` (where this pixel is, 0 to 1), `NAME_size` and `NAME_pt`
 * (a pixel's size, 0 to 1). `LUMA`, the picture the passes start from, is the video's frame made luma here (Rec. 601 weights). Rows count from the top
 * of the picture, as in mpv.
 */

export interface Size {
  width: number;
  height: number;
}

/** One pass of an mpv user shader. */
export interface HookPass {
  desc: string;
  /** The texture it hooks (`LUMA` here): its result replaces it when the pass saves nothing. */
  hook: string;
  binds: string[];
  /** The name its result goes by. */
  save: string;
  /** mpv's size expressions (reverse Polish: `LUMA.w 2 *`); without them, the pass is the size of what it hooks. */
  width?: string;
  height?: string;
  /** The GLSL of the pass: a `vec4 hook()` and what it needs. */
  body: string;
}

const KNOWN = new Set(["HOOK", "DESC", "BIND", "SAVE", "WIDTH", "HEIGHT", "WHEN", "COMPONENTS"]);

/** The passes of an mpv user shader file, in order. */
export function parseHooks(text: string): HookPass[] {
  const passes: HookPass[] = [];
  let current: HookPass | undefined;
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const directive = /^\/\/!([A-Z]+)\s*(.*)$/.exec(line);
    if (directive) {
      const [, key = "", rest = ""] = directive;
      const value = rest.trim();
      if (!KNOWN.has(key)) throw new Error(`The shader says //!${key}, which this page does not know`);
      if (key === "HOOK") {
        if (current) passes.push(current);
        current = { desc: "", hook: value, binds: [], save: "", body: "" };
      } else if (current) {
        if (key === "DESC") current.desc = value;
        else if (key === "BIND") current.binds.push(value);
        else if (key === "SAVE") current.save = value;
        else if (key === "WIDTH") current.width = value;
        else if (key === "HEIGHT") current.height = value;
      }
      continue;
    }
    if (current) current.body += `${line}\n`;
  }
  if (current) passes.push(current);
  for (const pass of passes) {
    pass.save ||= pass.hook;
    if (!/\bvec4\s+hook\s*\(\s*\)/.test(pass.body)) throw new Error(`The pass "${pass.desc}" has no hook()`);
    for (const name of pass.binds) if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`The pass "${pass.desc}" binds "${name}"`);
  }
  if (passes.length === 0) throw new Error("The shader has no passes");
  return passes;
}

/** An mpv size expression (`LUMA.w 2 *`) for textures of these sizes. */
export function sizeExpression(expression: string, sizes: ReadonlyMap<string, Size>): number {
  const stack: number[] = [];
  for (const token of expression.trim().split(/\s+/)) {
    const named = /^([A-Z][A-Z0-9_]*)\.([wh])$/.exec(token);
    if (named) {
      const size = sizes.get(named[1]!);
      if (!size) throw new Error(`The size of ${named[1]} is not known yet`);
      stack.push(named[2] === "w" ? size.width : size.height);
    } else if (/^-?\d+(\.\d+)?$/.test(token)) {
      stack.push(Number(token));
    } else if (["+", "-", "*", "/"].includes(token)) {
      const right = stack.pop();
      const left = stack.pop();
      if (left === undefined || right === undefined) throw new Error(`"${expression}" is not a size`);
      stack.push(token === "+" ? left + right : token === "-" ? left - right : token === "*" ? left * right : left / right);
    } else {
      throw new Error(`"${token}" in "${expression}" is not known here`);
    }
  }
  if (stack.length !== 1 || !Number.isFinite(stack[0])) throw new Error(`"${expression}" is not a size`);
  return Math.round(stack[0]!);
}

/** The size of each pass's result, from the size of the video. */
export function passSizes(passes: readonly HookPass[], luma: Size): Size[] {
  const sizes = new Map<string, Size>([["LUMA", luma]]);
  return passes.map((pass) => {
    const hooked = sizes.get(pass.hook);
    if (!hooked) throw new Error(`The pass "${pass.desc}" hooks ${pass.hook}, which is not there`);
    const size = {
      width: pass.width ? sizeExpression(pass.width, sizes) : hooked.width,
      height: pass.height ? sizeExpression(pass.height, sizes) : hooked.height,
    };
    sizes.set(pass.save, size);
    return size;
  });
}

/** Rec. 601 luma, as the network's training pictures were made (it is given and gives luma only). */
export const LUMA_WEIGHTS = "vec3(0.299, 0.587, 0.114)";

/** The WebGL 2 fragment shader of a pass: mpv's names, then the pass's own code. */
export function passFragment(pass: HookPass): string {
  const names = pass.binds.map((name) =>
    [
      `uniform sampler2D ${name}_raw;`,
      `uniform vec2 ${name}_size;`,
      `#define ${name}_pt (1.0 / ${name}_size)`,
      `#define ${name}_pos (gl_FragCoord.xy / outSize)`,
      name === "LUMA" ? `#define ${name}_tex(pos) vec4(dot(texture(${name}_raw, pos).rgb, ${LUMA_WEIGHTS}), 0.0, 0.0, 1.0)` : `#define ${name}_tex(pos) texture(${name}_raw, pos)`,
      `#define ${name}_texOff(off) ${name}_tex(${name}_pos + ${name}_pt * vec2(off))`,
    ].join("\n"),
  );
  return `#version 300 es
precision highp float;
precision highp int;
uniform vec2 outSize;
out vec4 fragColor;
${names.join("\n")}
${pass.body}
void main() {
  fragColor = hook();
}`;
}

/**
 * The 2x luma, the video's colour around it: the picture at `outSize`, the right way up for the canvas. The luma is fitted to the target with
 * Catmull-Rom (bicubic): bilinear would blur back what the network drew, from 2x to 3x and more. The colour (chroma) is the video's, bilinear: luma is
 * changed by the same amount in red, green and blue, which leaves the colour as it was.
 */
export const FILM_COMPOSITE_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D src;
uniform sampler2D luma;
uniform vec2 outSize;
out vec4 color;
const vec3 WEIGHTS = ${LUMA_WEIGHTS};
vec4 catmullRom(float t) {
  float t2 = t * t;
  float t3 = t2 * t;
  return vec4(-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1.0, -1.5 * t3 + 2.0 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2);
}
float bicubicLuma(vec2 uv) {
  ivec2 size = textureSize(luma, 0);
  vec2 p = uv * vec2(size) - 0.5;
  vec2 i = floor(p);
  vec2 f = p - i;
  vec4 wx = catmullRom(f.x);
  vec4 wy = catmullRom(f.y);
  float sum = 0.0;
  for (int y = 0; y < 4; y++) {
    float row = 0.0;
    for (int x = 0; x < 4; x++) {
      ivec2 at = clamp(ivec2(i) + ivec2(x - 1, y - 1), ivec2(0), size - 1);
      row += texelFetch(luma, at, 0).r * wx[x];
    }
    sum += row * wy[y];
  }
  return sum;
}
void main() {
  vec2 uv = vec2(gl_FragCoord.x, outSize.y - gl_FragCoord.y) / outSize;
  vec3 rgb = texture(src, uv).rgb;
  color = vec4(clamp(rgb + (bicubicLuma(uv) - dot(rgb, WEIGHTS)), 0.0, 1.0), 1.0);
}`;

interface Program {
  program: WebGLProgram;
  uniform: (name: string) => WebGLUniformLocation | null;
}

interface Target {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  size: Size;
}

/** One FSRCNNX network on a WebGL 2 context: its passes compiled, and a float texture for the result of each. */
export class FilmNet {
  private readonly programs: Program[];
  private targets: Target[] = [];
  private builtFor = "";

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly passes: readonly HookPass[],
    link: (fragment: string) => Program,
  ) {
    this.programs = passes.map((pass) => link(passFragment(pass)));
  }

  /** Runs every pass on the video's frame (`source`, RGBA, `size`); gives the 2x luma (in red) and its size. Leaves the last framebuffer bound. */
  run(source: WebGLTexture, size: Size): { texture: WebGLTexture; size: Size } {
    const gl = this.gl;
    this.allocate(size);
    const named = new Map<string, { texture: WebGLTexture; size: Size }>([["LUMA", { texture: source, size }]]);
    this.passes.forEach((pass, index) => {
      const target = this.targets[index]!;
      const program = this.programs[index]!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.viewport(0, 0, target.size.width, target.size.height);
      gl.useProgram(program.program);
      gl.uniform2f(program.uniform("outSize"), target.size.width, target.size.height);
      pass.binds.forEach((name, unit) => {
        const bound = named.get(name);
        if (!bound) throw new Error(`The pass "${pass.desc}" needs ${name}, which no pass before it made`);
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, bound.texture);
        gl.uniform1i(program.uniform(`${name}_raw`), unit);
        gl.uniform2f(program.uniform(`${name}_size`), bound.size.width, bound.size.height);
      });
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      named.set(pass.save, { texture: target.texture, size: target.size });
    });
    gl.activeTexture(gl.TEXTURE0);
    return named.get(this.passes[this.passes.length - 1]!.save)!;
  }

  /** Frees its textures and programs. */
  dispose(): void {
    this.free();
    for (const program of this.programs) this.gl.deleteProgram(program.program);
  }

  /** A float texture for each pass, of its size (made again only when the video's size changes). */
  private allocate(size: Size): void {
    const key = `${size.width}x${size.height}`;
    if (key === this.builtFor) return;
    const gl = this.gl;
    this.free();
    this.targets = passSizes(this.passes, size).map((each, index) => {
      const texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      // (The passes read their inputs at pixel centres: nearest. The last, the 2x luma, is read between them by the composite: linear.)
      const filter = index === this.passes.length - 1 ? gl.LINEAR : gl.NEAREST;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, each.width, each.height, 0, gl.RGBA, gl.HALF_FLOAT, null);
      const framebuffer = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("This graphics chip cannot draw into a half-float texture");
      return { texture, framebuffer, size: each };
    });
    this.builtFor = key;
  }

  private free(): void {
    for (const target of this.targets) {
      this.gl.deleteTexture(target.texture);
      this.gl.deleteFramebuffer(target.framebuffer);
    }
    this.targets = [];
    this.builtFor = "";
  }
}
