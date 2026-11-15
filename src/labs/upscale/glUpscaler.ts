import { BILINEAR_FRAGMENT, EASU_FRAGMENT, FULLSCREEN_VERTEX, RCAS_FRAGMENT } from "./fsrShaders";
import { easuScale, rcasAmount } from "./measure";
import { FILM_COMPOSITE_FRAGMENT, FilmNet, parseHooks } from "./fsrcnnx";

/** The modes WebGL 2 draws: the browser's own bilinear scaling ("off"), AMD FSR 1 ("sharp": EASU, then RCAS), and FSRCNNX ("film": see fsrcnnx.ts). */
export type GlMode = "off" | "sharp" | FilmMode;
export type FilmMode = "film" | "film-quality";
export const isFilm = (mode: string): mode is FilmMode => mode === "film" || mode === "film-quality";

/** A Film mode doubles only a picture drawn at least this many times as big (as mpv runs FSRCNNX); a smaller one is drawn plainly. */
export const FILM_FROM = 1.3;

/** RCAS sharpness in stops, as AMD's sample sets it (0 = the most). */
const SHARPNESS_STOPS = 0.2;

interface Program {
  program: WebGLProgram;
  uniform: (name: string) => WebGLUniformLocation | null;
}

/**
 * Draws a playing <video> into a WebGL 2 canvas at a chosen size, plainly or with FSR 1. The video must be readable by the page (a file picked on this
 * computer is): WebGL cannot take the frames of a video from another site that did not allow it.
 */
export class GlUpscaler {
  private readonly gl: WebGL2RenderingContext;
  private readonly bilinear: Program;
  private readonly easu: Program;
  private readonly rcas: Program;
  private readonly source: WebGLTexture;
  private readonly middle: WebGLTexture;
  private readonly middleTarget: WebGLFramebuffer;
  private sourceSize = { width: 0, height: 0 };
  private middleSize = { width: 0, height: 0 };
  private readonly pixel = new Uint8Array(4);
  private fence: WebGLSync | null = null;
  /** Whether this chip can draw into float textures (EXT_color_buffer_float), which FSRCNNX's passes need: nearly every computer's can. */
  private readonly floatTargets: boolean;
  private readonly films = new Map<FilmMode, FilmNet>();
  private composite: Program | undefined;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: "high-performance" });
    if (!gl) throw new Error("WebGL 2 is not available in this browser");
    this.gl = gl;
    this.bilinear = this.link(BILINEAR_FRAGMENT);
    this.easu = this.link(EASU_FRAGMENT);
    this.rcas = this.link(RCAS_FRAGMENT);
    this.source = this.texture(gl.LINEAR);
    this.middle = this.texture(gl.NEAREST);
    this.middleTarget = gl.createFramebuffer()!;
    this.floatTargets = Boolean(gl.getExtension("EXT_color_buffer_float"));
  }

  /** Why the Film modes cannot run here, or "". */
  filmProblem(): string {
    return this.floatTargets ? "" : "This graphics chip cannot draw into float textures (EXT_color_buffer_float), which the network needs.";
  }

  hasFilm(mode: FilmMode): boolean {
    return this.films.has(mode);
  }

  /** Compiles an FSRCNNX network from its mpv shader file (the text of it). Throws what went wrong. */
  loadFilm(mode: FilmMode, shader: string): void {
    const why = this.filmProblem();
    if (why) throw new Error(why);
    this.composite ??= this.link(FILM_COMPOSITE_FRAGMENT);
    this.films.get(mode)?.dispose();
    this.films.set(mode, new FilmNet(this.gl, parseHooks(shader), (fragment) => this.link(fragment)));
  }

  /** The name the browser gives the graphics chip (only shown on the page: nothing is sent anywhere). */
  gpuName(): string {
    const gl = this.gl;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "");
  }

  /** Draws the frame the video shows now, at `out` (the canvas is made that size). */
  draw(video: HTMLVideoElement, mode: GlMode, out: { width: number; height: number }): void {
    const gl = this.gl;
    if (this.canvas.width !== out.width || this.canvas.height !== out.height) {
      this.canvas.width = out.width;
      this.canvas.height = out.height;
    }
    this.upload(video);
    if (isFilm(mode) && out.width >= FILM_FROM * this.sourceSize.width) {
      const net = this.films.get(mode);
      if (!net || !this.composite) throw new Error("The Film network is not loaded");
      // The network doubles the luma (in float textures of its own)...
      const luma = net.run(this.source, this.sourceSize);
      // ...and the composite puts the video's colour around it, at the target, the right way up.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, out.width, out.height);
      gl.useProgram(this.composite.program);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, luma.texture);
      gl.uniform1i(this.composite.uniform("luma"), 1);
      this.bind(this.source, this.composite.uniform("src"));
      gl.uniform2f(this.composite.uniform("outSize"), out.width, out.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return;
    }
    if (mode !== "sharp") {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, out.width, out.height);
      gl.useProgram(this.bilinear.program);
      this.bind(this.source, this.bilinear.uniform("src"));
      gl.uniform2f(this.bilinear.uniform("outSize"), out.width, out.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return;
    }
    // EASU into a texture of the output's size, the image's top row first...
    this.sizeMiddle(out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.middleTarget);
    gl.viewport(0, 0, out.width, out.height);
    gl.useProgram(this.easu.program);
    this.bind(this.source, this.easu.uniform("src"));
    gl.uniform2i(this.easu.uniform("srcSize"), this.sourceSize.width, this.sourceSize.height);
    gl.uniform4f(this.easu.uniform("con0"), ...easuScale(this.sourceSize.width, this.sourceSize.height, out.width, out.height));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // ...then RCAS from it onto the canvas, the right way up.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, out.width, out.height);
    gl.useProgram(this.rcas.program);
    this.bind(this.middle, this.rcas.uniform("src"));
    gl.uniform2i(this.rcas.uniform("size"), out.width, out.height);
    gl.uniform1f(this.rcas.uniform("sharpness"), rcasAmount(SHARPNESS_STOPS));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /**
   * Whether the graphics chip has finished all it was given before (asked when the next frame of the video arrives, before drawing it: a frame that
   * is still being drawn then has fallen behind the video). Never waits.
   */
  caughtUp(): boolean {
    const gl = this.gl;
    if (!this.fence) return true;
    const done = gl.getSyncParameter(this.fence, gl.SYNC_STATUS) === gl.SIGNALED;
    if (done) {
      gl.deleteSync(this.fence);
      this.fence = null;
    }
    return done;
  }

  /** Marks the end of what was given so far, for `caughtUp`. */
  mark(): void {
    const gl = this.gl;
    if (this.fence) gl.deleteSync(this.fence);
    this.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
  }

  /** Waits for the graphics chip to finish what it was given (reading one pixel back makes it), so that a time measured around it is the real one. */
  finish(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.pixel);
  }

  /** The colour of one pixel of what was drawn last, x and y from the top left (for the test that checks a picture was drawn). */
  sample(x: number, y: number): [number, number, number] {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(x, this.canvas.height - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.pixel);
    return [this.pixel[0]!, this.pixel[1]!, this.pixel[2]!];
  }

  private upload(video: HTMLVideoElement): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); // (row 0 = the top of the picture: the shaders count from there)
    if (this.sourceSize.width !== video.videoWidth || this.sourceSize.height !== video.videoHeight) {
      this.sourceSize = { width: video.videoWidth, height: video.videoHeight };
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, video);
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, video);
    }
  }

  private sizeMiddle(out: { width: number; height: number }): void {
    if (this.middleSize.width === out.width && this.middleSize.height === out.height) return;
    const gl = this.gl;
    this.middleSize = { ...out };
    gl.bindTexture(gl.TEXTURE_2D, this.middle);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, out.width, out.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.middleTarget);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.middle, 0);
  }

  private bind(texture: WebGLTexture, at: WebGLUniformLocation | null): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(at, 0);
  }

  private texture(filter: number): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  private link(fragment: string): Program {
    const gl = this.gl;
    const compile = (type: number, code: string): WebGLShader => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, code);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`A shader did not compile: ${gl.getShaderInfoLog(shader) ?? ""}`);
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, FULLSCREEN_VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`A shader did not link: ${gl.getProgramInfoLog(program) ?? ""}`);
    const places = new Map<string, WebGLUniformLocation | null>();
    return {
      program,
      uniform: (name) => {
        if (!places.has(name)) places.set(name, gl.getUniformLocation(program, name));
        return places.get(name)!;
      },
    };
  }
}
