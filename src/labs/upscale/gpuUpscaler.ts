/**
 * The "Anime" modes: Anime4K's neural upscalers (anime4k-webgpu 1.0.0, MIT, https://github.com/Anime4KWebBoost/Anime4K-WebGPU) on WebGPU. The package's
 * own `render()` runs a loop of its own; this drives its pipelines one frame at a time instead, so that a speed test can wait for each frame. Its 2x
 * output is then drawn at the chosen size with plain bilinear filtering.
 */

/** "fast": CNNx2M, the smallest of its 2x networks; "quality": CNNx2VL, a bigger one. */
export type AnimeMode = "anime-fast" | "anime-quality";

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

export class GpuUpscaler {
  private readonly context: GPUCanvasContext;
  private readonly format: GPUTextureFormat;
  private readonly blit: GPURenderPipeline;
  private readonly sampler: GPUSampler;
  private input: GPUTexture | undefined;
  private pipeline: Pipeline | undefined;
  private bindGroup: GPUBindGroup | undefined;
  private built = "";
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

  /** Draws the frame the video shows now with `mode`, at `out`. */
  draw(video: HTMLVideoElement, mode: AnimeMode, out: { width: number; height: number }): void {
    if (this.lost) throw new Error("The graphics chip was lost (its driver restarted): reload the page");
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (this.canvas.width !== out.width || this.canvas.height !== out.height) {
      this.canvas.width = out.width;
      this.canvas.height = out.height;
    }
    this.build(mode, width, height);
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

  /** Waits until the graphics chip has done all it was given, so that a time measured around it is the real one. */
  finish(): Promise<void> {
    return this.device.queue.onSubmittedWorkDone();
  }

  /** (Re)makes the network for this mode and this size of video: once, not every frame. */
  private build(mode: AnimeMode, width: number, height: number): void {
    const key = `${mode} ${width}x${height}`;
    if (key === this.built) return;
    this.input?.destroy();
    this.input = this.device.createTexture({
      size: [width, height, 1],
      format: "rgba16float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const options = { device: this.device, inputTexture: this.input };
    this.pipeline = mode === "anime-fast" ? new this.library.CNNx2M(options) : new this.library.CNNx2VL(options);
    this.bindGroup = this.device.createBindGroup({
      layout: this.blit.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: this.pipeline.getOutputTexture().createView() },
      ],
    });
    this.built = key;
  }
}
