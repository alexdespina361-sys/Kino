/**
 * RIFE (Real-Time Intermediate Flow Estimation, Huang et al., ECCV 2022; Practical-RIFE by hzwer), an existing neural network that makes the frame
 * between two, for the upscaler test page's frame boost ("Frames made by: RIFE"). It runs on ONNX Runtime Web (Microsoft, MIT) on WebGPU, loaded only when
 * it is picked: the runtime is about 30 MB, the network a few more.
 *
 * The pictures go in and out as RGBA bytes (a canvas's ImageData), padded to the network's step (its flow works on sizes divisible by 32 or 64).
 */

import type * as Ort from "onnxruntime-web/webgpu";

let runtime: Promise<typeof Ort> | undefined;

/** ONNX Runtime Web, loaded once, on first use. */
export function loadRuntime(): Promise<typeof Ort> {
  runtime ??= import("onnxruntime-web/webgpu").then((ort) => {
    ort.env.logLevel = "error";
    return ort;
  });
  return runtime;
}

export interface Picture {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** The size padded up to a multiple of `step`. */
export const padded = (size: number, step: number): number => Math.ceil(size / step) * step;

/**
 * Writes `picture`'s red, green and blue (0..1) into `planes` (channels after one another, each `width` x `height` of the padded size) from channel
 * `first` on. The padding repeats the last row and column (a black edge would pull the network's paths there).
 */
export function writePlanes(picture: Picture, planes: Float32Array, first: number, width: number, height: number): void {
  const plane = width * height;
  for (let y = 0; y < height; y++) {
    const row = Math.min(y, picture.height - 1) * picture.width;
    for (let x = 0; x < width; x++) {
      const at = (row + Math.min(x, picture.width - 1)) * 4;
      const to = y * width + x;
      planes[first * plane + to] = picture.data[at]! / 255;
      planes[(first + 1) * plane + to] = picture.data[at + 1]! / 255;
      planes[(first + 2) * plane + to] = picture.data[at + 2]! / 255;
    }
  }
}

/** The network's answer (three planes of the padded size, 0..1) back as RGBA bytes of the picture's own size. */
export function readPlanes(planes: Float32Array | Uint16Array, width: number, height: number, padWidth: number, padHeight: number): Uint8ClampedArray {
  const plane = padWidth * padHeight;
  const out = new Uint8ClampedArray(width * height * 4); // (it rounds what is put in it to the nearest, and clamps to 0..255)
  const value = planes instanceof Uint16Array ? (index: number) => halfToFloat(planes[index]!) : (index: number) => planes[index]!;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = y * padWidth + x;
      const to = (y * width + x) * 4;
      out[to] = value(from) * 255;
      out[to + 1] = value(plane + from) * 255;
      out[to + 2] = value(2 * plane + from) * 255;
      out[to + 3] = 255;
    }
  }
  return out;
}

/**
 * How the network takes its pictures, read from the file itself (the ONNX exports differ): all in one input of 7 channels (the two pictures, then the
 * moment as a plane), or three inputs (the two pictures and the moment, as a plane or as one number).
 */
export type Layout =
  | { kind: "one"; input: string; channels: number }
  | { kind: "three"; first: string; second: string; moment: string; momentPlane: boolean };

/** RIFE on ONNX Runtime Web (WebGPU). `make` gives the picture `t` of the way from `a` to `b` (0 < t < 1). */
export class Rife {
  private constructor(
    private readonly ort: typeof Ort,
    private readonly session: Ort.InferenceSession,
    private readonly layout: Layout,
    private readonly output: string,
    readonly step: number,
  ) {}

  /** Loads the runtime and the network from `address` (on WebGPU; throws what went wrong). `step`: the size the network's sizes must divide by. */
  static async load(address: string, step = 64): Promise<Rife> {
    const ort = await loadRuntime();
    const session = await ort.InferenceSession.create(address, { executionProviders: ["webgpu"], graphOptimizationLevel: "all" });
    return new Rife(ort, session, layoutOf(session), session.outputNames[0]!, step);
  }

  async make(a: Picture, b: Picture, t: number): Promise<Uint8ClampedArray> {
    const [width, height] = [padded(a.width, this.step), padded(a.height, this.step)];
    const plane = width * height;
    const feeds: Record<string, Ort.Tensor> = {};
    const layout = this.layout;
    if (layout.kind === "one") {
      const planes = new Float32Array(layout.channels * plane);
      writePlanes(a, planes, 0, width, height);
      writePlanes(b, planes, 3, width, height);
      planes.fill(t, 6 * plane, 7 * plane);
      feeds[layout.input] = new this.ort.Tensor("float32", planes, [1, layout.channels, height, width]);
    } else {
      const first = new Float32Array(3 * plane);
      const second = new Float32Array(3 * plane);
      writePlanes(a, first, 0, width, height);
      writePlanes(b, second, 0, width, height);
      feeds[layout.first] = new this.ort.Tensor("float32", first, [1, 3, height, width]);
      feeds[layout.second] = new this.ort.Tensor("float32", second, [1, 3, height, width]);
      feeds[layout.moment] = layout.momentPlane
        ? new this.ort.Tensor("float32", new Float32Array(plane).fill(t), [1, 1, height, width])
        : new this.ort.Tensor("float32", new Float32Array([t]), [1]);
    }
    const results = await this.session.run(feeds);
    const out = results[this.output]!;
    try {
      const data = (await out.getData()) as Float32Array | Uint16Array;
      return readPlanes(data, a.width, a.height, width, height);
    } finally {
      out.dispose();
      for (const tensor of Object.values(feeds)) tensor.dispose();
    }
  }

  dispose(): void {
    void this.session.release();
  }
}

/** The layout of `session`'s inputs (see Layout). */
function layoutOf(session: Ort.InferenceSession): Layout {
  const names = session.inputNames;
  if (names.length === 1) {
    // (Only the 7 channels this page fills: an export with more planes, left at 0, would give a plausible wrong picture and no error.)
    const meta = session.inputMetadata[0];
    const channels = meta && meta.isTensor ? meta.shape[1] : undefined;
    if (channels !== 7) throw new Error(`This RIFE file takes ${String(channels)} channels in one input; the page fills 7 (two pictures and the moment)`);
    return { kind: "one", input: names[0]!, channels };
  }
  if (names.length === 3) {
    const moment = names.find((name) => /time|step|^t$/i.test(name)) ?? names[2]!;
    const pictures = names.filter((name) => name !== moment);
    const meta = session.inputMetadata[names.indexOf(moment)];
    const momentPlane = Boolean(meta && meta.isTensor && meta.shape.length === 4);
    return { kind: "three", first: pictures[0]!, second: pictures[1]!, moment, momentPlane };
  }
  throw new Error(`This RIFE file takes ${names.length} inputs (${names.join(", ")}); the page knows 1 or 3`);
}

/** A 16-bit float (as its bits) as a number. */
export function halfToFloat(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 31) return fraction ? Number.NaN : sign * Number.POSITIVE_INFINITY;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}
