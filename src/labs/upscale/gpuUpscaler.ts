import { animeSteps, type AnimeMode, type AnimeStep, type Size } from "./measure";

/**
 * The "Anime" modes: Anime4K's neural upscalers (anime4k-webgpu 1.0.0, MIT, https://github.com/Anime4KWebBoost/Anime4K-WebGPU) on WebGPU. The package's
 * own `render()` runs a loop of its own; this drives its pipelines one frame at a time instead, so that a speed test can wait for each frame. What the
 * networks give (see `animeSteps`) is then drawn at the chosen size with plain bilinear filtering.
 */

export type { AnimeMode } from "./measure";

interface Pipeline {
  pass(encoder: GPUCommandEncoder): void;
  getOutputTexture(): GPUTexture;
}

const BLIT = /* wgsl */ `
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

/** The name of the graphics chip WebGPU would use, or why there is none (WebGPU is in recent Chrome and Edge on a computer, not on old TVs). */
export async function webgpuAdapter(): Promise<{ adapter?: GPUAdapter; name: string; problem?: string }> {
  if (!("gpu" in navigator) || !navigator.gpu) return { name: "", problem: "This browser has no WebGPU (recent Chrome or Edge on a computer have it)." };
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) return { name: "", problem: "WebGPU is there, but it found no graphics chip it can use (an old or blocked driver)." };
    const info = (adapter as GPUAdapter & { info?: GPUAdapterInfo }).info;
    const name = info ? [info.vendor, info.architecture, info.description].filter(Boolean).join(" ") : "";
    return { adapter, name };
  } catch (error) {
    return { name: "", problem: `WebGPU did not start: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Several pipelines one after another, as one. */
const chained = (pipelines: readonly Pipeline[]): Pipeline => ({
  pass: (encoder) => {
    for (const pipeline of pipelines) pipeline.pass(encoder);
  },
  getOutputTexture: () => pipelines[pipelines.length - 1]!.getOutputTexture(),
});

export class GpuUpscaler {
  private readonly context: GPUCanvasContext;
  private readonly format: GPUTextureFormat;
  private readonly blit: GPURenderPipeline;
  private readonly sampler: GPUSampler;
  private input: GPUTexture | undefined;
  private pipeline: Pipeline | undefined;
  private bindGroup: GPUBindGroup | undefined;
  private built = "";
  /** What the networks of the mode built last made (their textures and buffers), freed when another is built: a few modes at 4K would fill a small card. */
  private made: (GPUTexture | GPUBuffer)[] = [];
  lost = false;

  private constructor(
    private readonly device: GPUDevice,
    private readonly canvas: HTMLCanvasElement,
    private readonly library: typeof import("anime4k-webgpu"),
  ) {
    const context = canvas.getContext("webgpu");
    if (!context) throw new Error("This canvas cannot draw with WebGPU");
    this.context = context;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device, format: this.format, alphaMode: "opaque" });
    const module = device.createShaderModule({ code: BLIT });
    this.blit = device.createRenderPipeline({ layout: "auto", vertex: { module, entryPoint: "vs" }, fragment: { module, entryPoint: "fs", targets: [{ format: this.format }] }, primitive: { topology: "triangle-list" } });
    this.sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
    void device.lost.then(() => {
      this.lost = true;
    });
  }

  /** Starts WebGPU on `canvas` and loads Anime4K (about 3.5 MB, fetched only here, only when WebGPU is there). */
  static async create(adapter: GPUAdapter, canvas: HTMLCanvasElement): Promise<GpuUpscaler> {
    const [device, library] = await Promise.all([adapter.requestDevice(), import("anime4k-webgpu")]);
    return new GpuUpscaler(device, canvas, library);
  }

  /**
   * Draws the frame the video shows now with `mode`, at `out`; or, with `size`, the picture `video` stands for (a canvas the frame boost just drew, of
   * that size: it must be drawn in the same task, while the canvas still holds it).
   */
  draw(video: HTMLVideoElement | HTMLCanvasElement, mode: AnimeMode, out: Size, size?: Size): void {
    if (this.lost) throw new Error("The graphics chip was lost (its driver restarted): reload the page");
    const width = size?.width ?? (video as HTMLVideoElement).videoWidth;
    const height = size?.height ?? (video as HTMLVideoElement).videoHeight;
    if (this.canvas.width !== out.width || this.canvas.height !== out.height) {
      this.canvas.width = out.width;
      this.canvas.height = out.height;
    }
    this.build(mode, { width, height }, out);
    this.device.queue.copyExternalImageToTexture({ source: video }, { texture: this.input! }, [width, height]);
    const encoder = this.device.createCommandEncoder();
    this.pipeline!.pass(encoder);
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
    pass.setPipeline(this.blit);
    pass.setBindGroup(0, this.bindGroup!);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  /** The size of the picture the networks of the mode built last give, before it is fitted to the target (for the page's check by hand). */
  networkSize(): Size | undefined {
    const texture = this.pipeline?.getOutputTexture();
    return texture ? { width: texture.width, height: texture.height } : undefined;
  }

  /** Waits until the graphics chip has done all it was given, so that a time measured around it is the real one. */
  finish(): Promise<void> {
    return this.device.queue.onSubmittedWorkDone();
  }

  /** Frames given to the graphics chip and not finished yet (see `caughtUp`). */
  private unfinished = 0;

  /**
   * Whether the graphics chip has finished all it was given before (asked when the next frame of the video arrives, before drawing it: a frame that
   * is still being drawn then has fallen behind the video). Never waits.
   */
  caughtUp(): boolean {
    return this.unfinished === 0;
  }

  /** Marks the end of what was given so far, for `caughtUp`. */
  mark(): void {
    this.unfinished++;
    void this.device.queue.onSubmittedWorkDone().then(() => {
      this.unfinished--;
    });
  }

  /** (Re)makes the networks for this mode, this size of video and this target (Mode A and C change with the target): once, not every frame. */
  private build(mode: AnimeMode, native: Size, out: Size): void {
    const key = `${mode} ${native.width}x${native.height} ${out.width}x${out.height}`;
    if (key === this.built) return;
    for (const thing of this.made) thing.destroy();
    this.made = [];
    this.built = "";
    // (Everything the package makes while the networks are built is noted, to be freed with them: it keeps no list of its own.)
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
      this.input = device.createTexture({
        size: [native.width, native.height, 1],
        format: "rgba16float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.pipeline = this.networks(mode, this.input, native, out);
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

  private networks(mode: AnimeMode, input: GPUTexture, native: Size, out: Size): Pipeline {
    const device = this.device;
    const library = this.library;
    if (mode === "anime-restore") return new library.ModeA({ device, inputTexture: input, nativeDimensions: native, targetDimensions: out });
    if (mode === "anime-clean") return new library.ModeC({ device, inputTexture: input, nativeDimensions: native, targetDimensions: out });
    const make = (step: AnimeStep, inputTexture: GPUTexture): Pipeline => {
      const options = { device, inputTexture };
      switch (step.network) {
        case "CNNx2M":
          return new library.CNNx2M(options);
        case "CNNx2VL":
          return new library.CNNx2VL(options);
        case "CNNx2UL":
          return new library.CNNx2UL(options);
        case "GANx3L":
          return new library.GANx3L(options);
        case "GANx4UUL":
          return new library.GANx4UUL(options);
        default:
          throw new Error(`${step.network} is not a step of ${mode}`);
      }
    };
    const pipelines: Pipeline[] = [];
    for (const step of animeSteps(mode, native, out)) pipelines.push(make(step, pipelines.length ? pipelines[pipelines.length - 1]!.getOutputTexture() : input));
    return chained(pipelines);
  }
}
