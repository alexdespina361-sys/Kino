import { EASU_FRAGMENT, FULLSCREEN_VERTEX, RCAS_FRAGMENT } from "./fsrShaders";

export interface Size {
  width: number;
  height: number;
}

export const easuScale = (inWidth: number, inHeight: number, outWidth: number, outHeight: number): [number, number, number, number] => {
  const x = inWidth / outWidth;
  const y = inHeight / outHeight;
  return [x, y, 0.5 * x - 0.5, 0.5 * y - 0.5];
};

export const rcasAmount = (stops: number): number => 2 ** -Math.max(0, stops);

interface Program {
  program: WebGLProgram;
  uniform: (name: string) => WebGLUniformLocation | null;
}

export class GlUpscaler {
  private readonly gl: WebGL2RenderingContext;
  private readonly easu: Program;
  private readonly rcas: Program;
  private readonly source: WebGLTexture;
  private readonly middle: WebGLTexture;
  private readonly middleTarget: WebGLFramebuffer;
  private sourceSize = { width: 0, height: 0 };
  private middleSize = { width: 0, height: 0 };
  private fence: WebGLSync | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: "high-performance" });
    if (!gl) throw new Error("WebGL 2 is not available in this browser");
    this.gl = gl;
    this.easu = this.link(EASU_FRAGMENT);
    this.rcas = this.link(RCAS_FRAGMENT);
    this.source = this.texture(gl.LINEAR);
    this.middle = this.texture(gl.NEAREST);
    this.middleTarget = gl.createFramebuffer()!;
  }

  draw(video: HTMLVideoElement, out: Size): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    if (this.sourceSize.width !== video.videoWidth || this.sourceSize.height !== video.videoHeight) {
      this.sourceSize = { width: video.videoWidth, height: video.videoHeight };
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, video);
    } else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, video);
    const size = this.sourceSize;
    if (this.canvas.width !== out.width || this.canvas.height !== out.height) {
      this.canvas.width = out.width;
      this.canvas.height = out.height;
    }
    if (this.middleSize.width !== out.width || this.middleSize.height !== out.height) {
      this.middleSize = { ...out };
      gl.bindTexture(gl.TEXTURE_2D, this.middle);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, out.width, out.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.middleTarget);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.middle, 0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.middleTarget);
    gl.viewport(0, 0, out.width, out.height);
    gl.useProgram(this.easu.program);
    this.bind(this.source, this.easu.uniform("src"));
    gl.uniform2i(this.easu.uniform("srcSize"), size.width, size.height);
    gl.uniform4f(this.easu.uniform("con0"), ...easuScale(size.width, size.height, out.width, out.height));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, out.width, out.height);
    gl.useProgram(this.rcas.program);
    this.bind(this.middle, this.rcas.uniform("src"));
    gl.uniform2i(this.rcas.uniform("size"), out.width, out.height);
    gl.uniform1f(this.rcas.uniform("sharpness"), rcasAmount(0.2));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

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

  mark(): void {
    const gl = this.gl;
    if (this.fence) gl.deleteSync(this.fence);
    this.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
  }

  lost(): boolean {
    return this.gl.isContextLost();
  }

  dispose(): void {
    if (this.fence) this.gl.deleteSync(this.fence);
    this.fence = null;
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
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

export const bestSteps = (native: Size, out: Size): { network: "CNNx2UL" | "CNNx2M"; size: Size }[] => {
  const times = (factor: number): Size => ({ width: native.width * factor, height: native.height * factor });
  const first = { network: "CNNx2UL" as const, size: times(2) };
  return out.width > 2.4 * native.width && out.height > 2.4 * native.height ? [first, { network: "CNNx2M", size: times(4) }] : [first];
};

interface Pipeline {
  pass(encoder: GPUCommandEncoder): void;
  getOutputTexture(): GPUTexture;
}

const BLIT = `
struct Out { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) index: u32) -> Out {
  var corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var out: Out;
  out.pos = vec4f(corners[index], 0.0, 1.0);
  out.uv = vec2f((corners[index].x + 1.0) * 0.5, (1.0 - corners[index].y) * 0.5);
  return out;
}
@group(0) @binding(0) var linearSampler: sampler;
@group(0) @binding(1) var picture: texture_2d<f32>;
@fragment fn fs(in: Out) -> @location(0) vec4f {
  return vec4f(textureSample(picture, linearSampler, in.uv).rgb, 1.0);
}`;

export async function webgpuAdapter(): Promise<{ adapter?: GPUAdapter; problem?: string }> {
  if (!("gpu" in navigator) || !navigator.gpu) return { problem: "This browser has no WebGPU (recent Chrome or Edge on a computer have it)." };
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    return adapter ? { adapter } : { problem: "WebGPU is there, but it found no graphics chip it can use (an old or blocked driver)." };
  } catch (error) {
    return { problem: `WebGPU did not start: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Anime4K (anime4k-webgpu 1.0.0, MIT, https://github.com/Anime4KWebBoost/Anime4K-WebGPU) on WebGPU, its pipelines driven one frame at a time; what the
 * networks give is drawn at the chosen size with bilinear filtering.
 */
export class GpuUpscaler {
  private readonly context: GPUCanvasContext;
  private readonly blit: GPURenderPipeline;
  private readonly sampler: GPUSampler;
  private input: GPUTexture | undefined;
  private pipeline: Pipeline | undefined;
  private bindGroup: GPUBindGroup | undefined;
  private built = "";
  private made: (GPUTexture | GPUBuffer)[] = [];
  private unfinished = 0;
  lost = false;

  private constructor(
    private readonly device: GPUDevice,
    private readonly canvas: HTMLCanvasElement,
    private readonly library: typeof import("anime4k-webgpu"),
  ) {
    const context = canvas.getContext("webgpu");
    if (!context) throw new Error("This canvas cannot draw with WebGPU");
    this.context = context;
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "opaque" });
    const module = device.createShaderModule({ code: BLIT });
    this.blit = device.createRenderPipeline({ layout: "auto", vertex: { module, entryPoint: "vs" }, fragment: { module, entryPoint: "fs", targets: [{ format }] }, primitive: { topology: "triangle-list" } });
    this.sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
    void device.lost.then(() => {
      this.lost = true;
    });
  }

  static async create(adapter: GPUAdapter, canvas: HTMLCanvasElement): Promise<GpuUpscaler> {
    const [device, library] = await Promise.all([adapter.requestDevice(), import("anime4k-webgpu")]);
    return new GpuUpscaler(device, canvas, library);
  }

  draw(video: HTMLVideoElement, out: Size): void {
    if (this.lost) throw new Error("The graphics chip was lost (its driver restarted): reload the page");
    const native = { width: video.videoWidth, height: video.videoHeight };
    if (this.canvas.width !== out.width || this.canvas.height !== out.height) {
      this.canvas.width = out.width;
      this.canvas.height = out.height;
    }
    this.build(native, out);
    this.device.queue.copyExternalImageToTexture({ source: video }, { texture: this.input! }, [native.width, native.height]);
    const encoder = this.device.createCommandEncoder();
    this.pipeline!.pass(encoder);
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
    pass.setPipeline(this.blit);
    pass.setBindGroup(0, this.bindGroup!);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  caughtUp(): boolean {
    return this.unfinished === 0;
  }

  mark(): void {
    this.unfinished++;
    void this.device.queue.onSubmittedWorkDone().then(() => {
      this.unfinished--;
    });
  }

  dispose(): void {
    for (const thing of this.made) thing.destroy();
    this.made = [];
    this.built = "";
    this.device.destroy();
  }

  private build(native: Size, out: Size): void {
    const key = `${native.width}x${native.height} ${out.width}x${out.height}`;
    if (key === this.built) return;
    for (const thing of this.made) thing.destroy();
    this.made = [];
    this.built = "";
    const device = this.device;
    const createTexture = device.createTexture.bind(device);
    const createBuffer = device.createBuffer.bind(device);
    device.createTexture = (descriptor) => {
      const texture = createTexture(descriptor);
      this.made.push(texture);
      return texture;
    };
    device.createBuffer = (descriptor) => {
      const buffer = createBuffer(descriptor);
      this.made.push(buffer);
      return buffer;
    };
    try {
      const input = device.createTexture({ size: [native.width, native.height, 1], format: "rgba16float", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
      this.input = input;
      const pipelines: Pipeline[] = [];
      for (const step of bestSteps(native, out)) pipelines.push(new this.library[step.network]({ device, inputTexture: pipelines.at(-1)?.getOutputTexture() ?? input }));
      this.pipeline = {
        pass: (encoder) => {
          for (const pipeline of pipelines) pipeline.pass(encoder);
        },
        getOutputTexture: () => pipelines.at(-1)!.getOutputTexture(),
      };
    } finally {
      device.createTexture = createTexture;
      device.createBuffer = createBuffer;
    }
    this.bindGroup = device.createBindGroup({
      layout: this.blit.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: this.pipeline.getOutputTexture().createView() },
      ],
    });
    this.built = key;
  }
}
