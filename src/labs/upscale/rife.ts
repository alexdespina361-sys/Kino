/**
 * RIFE (Real-Time Intermediate Flow Estimation, Huang et al., ECCV 2022; Practical-RIFE by hzwer), an existing neural network that makes the frame
 * between two, for the upscaler test page's frame boost ("Frames made by: RIFE"). It runs on ONNX Runtime Web (Microsoft, MIT) on WebGPU, loaded only when
 * it is picked: the runtime is about 30 MB, the network a few more.
 *
 * The pictures go in and out as RGBA bytes (a canvas's ImageData), padded to the network's step (its flow works on sizes divisible by 32 or 64).
 */

import type * as Ort from "onnxruntime-web";

let runtime: Promise<typeof Ort> | undefined;

/** Which of ONNX Runtime Web's engines (for a look by hand: `?rifeEp=wasm` on the page's address, the processor). */
const wanted = new URLSearchParams(typeof location === "undefined" ? "" : location.search);

/**
 * ONNX Runtime Web, loaded once, on first use. Its main build (WebGPU through "JSEP"), not "onnxruntime-web/webgpu": in 1.31.1 that newer WebGPU engine
 * made RIFE's frames wrong where things move (33 dB from the processor's own answer, against 64 for this one) and was slower (97 against 60 ms at 1280x534).
 */
export function loadRuntime(): Promise<typeof Ort> {
  runtime ??= import("onnxruntime-web").then((ort) => {
    ort.env.logLevel = "error";
    return ort;
  });
  return runtime;
}

export interface Picture {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

/** Two pictures and the moment between them RIFE is asked for (0 < t < 1). */
export interface Pair {
  a: Picture;
  b: Picture;
  t: number;
}

/** The name of the one answer of the RIFE file cut before its last step (public/labs/upscale/rife/README.md). */
export const MOTION_OUTPUT = "flowmask";

/**
 * What the cut RIFE file answers for two pictures of `width` x `height` (padded to `padWidth` x `padHeight`): five planes one after another, each of the
 * padded size: how far to look in the first picture (x, then y, in its pixels), the same for the second, then how much of the first to take (0..1). The
 * frame between is `first(p + motion0) * take + second(p + motion1) * (1 - take)`, as RIFE's own last step makes it.
 */
export interface Motion {
  data: Float32Array;
  width: number;
  height: number;
  padWidth: number;
  padHeight: number;
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
export function readPlanes(planes: Float32Array | Uint16Array, width: number, height: number, padWidth: number, padHeight: number): Uint8ClampedArray<ArrayBuffer> {
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
 * moment as a plane); the two pictures in one input of 6 channels and the moment apart; or three inputs. The moment apart is one number in the shape
 * the file asks for ([1], [1,1,1,1]) or a plane ([1,1,H,W]).
 */
export type Moment = { name: string; shape: "one" | "four" | "plane" };
export type Layout =
  | { kind: "seven"; input: string }
  | { kind: "six"; input: string; moment: Moment }
  | { kind: "three"; first: string; second: string; moment: Moment };

/** RIFE on ONNX Runtime Web (WebGPU). `make` gives the picture `t` of the way from `a` to `b` (0 < t < 1). */
export class Rife {
  /** A session for each picture size, its sizes fixed in it (the runtime plans a fixed size once, not at every frame). */
  private readonly sized = new Map<string, Promise<Ort.InferenceSession>>();

  private constructor(
    private readonly ort: typeof Ort,
    private readonly model: Uint8Array,
    private readonly inputs: InputShape[],
    private readonly layout: Layout,
    private readonly output: string,
    readonly step: number,
  ) {}

  /** Loads the runtime and the network from `address` (on WebGPU; throws what went wrong). `step`: the size the network's sizes must divide by. */
  static async load(address: string, step = 64): Promise<Rife> {
    const ort = await loadRuntime();
    const answer = await fetch(address);
    if (!answer.ok) throw new Error(`the network file did not come (the site answered ${answer.status})`);
    const model = new Uint8Array(await answer.arrayBuffer());
    const session = await ort.InferenceSession.create(model, Rife.options({}));
    const inputs = inputShapes(session);
    const output = session.outputNames[0]!;
    void session.release();
    return new Rife(ort, model, inputs, layoutOf(inputs), output, step);
  }

  private static options(overrides: Record<string, number>): Ort.InferenceSession.SessionOptions {
    // (logSeverityLevel 3: errors only; the runtime otherwise warns on the console, each time, that it keeps shape sums on the processor, as it should.)
    return { executionProviders: [wanted.get("rifeEp") === "wasm" ? "wasm" : "webgpu"], graphOptimizationLevel: "all", freeDimensionOverrides: overrides, logSeverityLevel: 3 };
  }

  /** Whether the file makes several moments in one run (its batch size is named, not fixed at 1): the cut file's is. */
  get batches(): boolean {
    return this.inputs.length > 0 && this.inputs.every((input) => typeof input.shape[0] === "string");
  }

  /**
   * The session for `batch` pairs of pictures of `width` x `height` (padded): the sizes that vary in the file (the batch, then the height and width of
   * each picture) fixed.
   */
  private sessionFor(width: number, height: number, batch: number): Promise<Ort.InferenceSession> {
    const key = `${width}x${height}x${batch}`;
    let session = this.sized.get(key);
    if (!session) {
      const overrides: Record<string, number> = {};
      if (wanted.get("rifeFixed") !== "0") {
        for (const input of this.inputs) {
          input.shape.forEach((dim, index) => {
            if (typeof dim === "string") overrides[dim] = index === 0 ? batch : index === 2 ? height : index === 3 ? width : 1;
          });
        }
      }
      session = this.ort.InferenceSession.create(this.model, Rife.options(overrides));
      this.sized.set(key, session);
    }
    return session;
  }

  /** Where the last `make` or `motion` spent its time (ms): packing the pictures, the network, bringing its answer back, unpacking it. */
  times = { pack: 0, run: 0, download: 0, unpack: 0 };

  /** Whether this file is RIFE without its last step (see `motion`): its answer is the motion, not the frame. */
  get givesMotion(): boolean {
    return this.output === MOTION_OUTPUT;
  }

  /** The frame between `a` and `b`, `t` of the way (a file that gives the frame: the stock one). */
  async make(a: Picture, b: Picture, t: number): Promise<Uint8ClampedArray<ArrayBuffer>> {
    if (this.givesMotion) throw new Error("This RIFE file gives the motion, not the frame");
    const answer = await this.run([{ a, b, t }]);
    const started = performance.now();
    const picture = readPlanes(answer.data as Float32Array | Uint16Array, a.width, a.height, answer.padWidth, answer.padHeight);
    this.times.unpack = performance.now() - started;
    return picture;
  }

  /**
   * How each part moves from `a` and `b` to the moment `t` between them, and how much of each to take (a file cut before RIFE's last step: see the
   * README next to it). The pictures can be smaller than the frames they stand for: the warp (frameBoost.ts `warp`) moves the full-size frames.
   */
  async motion(a: Picture, b: Picture, t: number): Promise<Motion> {
    return (await this.motions([{ a, b, t }]))[0]!;
  }

  /**
   * `motion` for several moments in one run (a file whose batch size is named, see `batches`): much faster a moment than one at a time on small
   * pictures, where the graphics card's time goes on starting each of the network's few hundred steps more than on the pixels. All of one size.
   */
  async motions(items: readonly Pair[]): Promise<Motion[]> {
    if (!this.givesMotion) throw new Error("This RIFE file gives the frame, not the motion");
    const { data, padWidth, padHeight } = await this.run(items);
    if (!(data instanceof Float32Array)) throw new Error("RIFE's motion did not come as 32-bit numbers");
    const each = 5 * padWidth * padHeight;
    const { width, height } = items[0]!.a;
    return items.map((_, index) => ({ data: data.subarray(index * each, (index + 1) * each), width, height, padWidth, padHeight }));
  }

  /** Runs the network on pairs of pictures (padded to its step) and their moments; its answer as it comes (planes of the padded size, pair after pair). */
  private async run(items: readonly Pair[]): Promise<{ data: Float32Array | Uint16Array; padWidth: number; padHeight: number }> {
    const started = performance.now();
    const n = items.length;
    const { width: pictureWidth, height: pictureHeight } = items[0]!.a;
    if (items.some((item) => [item.a, item.b].some((picture) => picture.width !== pictureWidth || picture.height !== pictureHeight))) throw new Error("RIFE's pictures are not of one size");
    if (n > 1 && !this.batches) throw new Error("This RIFE file makes one moment a run");
    const [width, height] = [padded(pictureWidth, this.step), padded(pictureHeight, this.step)];
    const plane = width * height;
    const feeds: Record<string, Ort.Tensor> = {};
    const layout = this.layout;
    const moment = (which: Moment): Ort.Tensor => {
      if (which.shape === "plane") {
        const planes = new Float32Array(n * plane);
        items.forEach((item, index) => planes.fill(item.t, index * plane, (index + 1) * plane));
        return new this.ort.Tensor("float32", planes, [n, 1, height, width]);
      }
      if (which.shape === "one" && n > 1) throw new Error("This RIFE file takes one moment a run");
      return new this.ort.Tensor("float32", Float32Array.from(items, (item) => item.t), which.shape === "four" ? [n, 1, 1, 1] : [n]);
    };
    if (layout.kind === "seven" || layout.kind === "six") {
      const channels = layout.kind === "seven" ? 7 : 6;
      const planes = new Float32Array(n * channels * plane);
      items.forEach((item, index) => {
        writePlanes(item.a, planes, index * channels, width, height);
        writePlanes(item.b, planes, index * channels + 3, width, height);
        if (layout.kind === "seven") planes.fill(item.t, (index * channels + 6) * plane, (index * channels + 7) * plane);
      });
      if (layout.kind === "six") feeds[layout.moment.name] = moment(layout.moment);
      feeds[layout.input] = new this.ort.Tensor("float32", planes, [n, channels, height, width]);
    } else {
      const first = new Float32Array(n * 3 * plane);
      const second = new Float32Array(n * 3 * plane);
      items.forEach((item, index) => {
        writePlanes(item.a, first, index * 3, width, height);
        writePlanes(item.b, second, index * 3, width, height);
      });
      feeds[layout.first] = new this.ort.Tensor("float32", first, [n, 3, height, width]);
      feeds[layout.second] = new this.ort.Tensor("float32", second, [n, 3, height, width]);
      feeds[layout.moment.name] = moment(layout.moment);
    }
    const session = await this.sessionFor(width, height, n);
    const packed = performance.now();
    const results = await session.run(feeds);
    const ran = performance.now();
    const out = results[this.output]!;
    try {
      // (A fresh array of the page's, which stays when the tensor is let go: ONNX Runtime Web copies its answers out of its own memory.)
      const data = (await out.getData()) as Float32Array | Uint16Array;
      this.times = { pack: packed - started, run: ran - packed, download: performance.now() - ran, unpack: 0 };
      return { data, padWidth: width, padHeight: height };
    } finally {
      out.dispose();
      for (const tensor of Object.values(feeds)) tensor.dispose();
    }
  }

  dispose(): void {
    for (const session of this.sized.values()) void session.then((each) => each.release()).catch(() => undefined);
    this.sized.clear();
  }
}

/** The input shapes of an ONNX file: name and dimensions (a number, or a name for a size that varies). */
export type InputShape = { name: string; shape: readonly (number | string)[] };

/**
 * The layout of a network's inputs (see Layout). Only the layouts this page fills exactly: an export with more planes (left at 0) would give a plausible
 * wrong picture and no error, so anything else is refused.
 */
export function layoutOf(inputs: readonly InputShape[]): Layout {
  const describe = inputs.map((each) => `${each.name} [${each.shape.join(",")}]`).join(", ");
  const refuse = (): never => {
    throw new Error(`This RIFE file's inputs are not a layout the page knows: ${describe}`);
  };
  const isMoment = (each: InputShape) => /time|step|^t$/i.test(each.name);
  const momentOf = (each: InputShape): Moment => {
    const dims = each.shape;
    if (dims.length === 1 && (dims[0] === 1 || typeof dims[0] === "string")) return { name: each.name, shape: "one" };
    if (dims.length === 4 && dims[1] === 1 && dims[2] === 1 && dims[3] === 1) return { name: each.name, shape: "four" };
    if (dims.length === 4 && dims[1] === 1 && typeof dims[2] === "string" && typeof dims[3] === "string") return { name: each.name, shape: "plane" };
    return refuse();
  };
  const channels = (each: InputShape | undefined) => (each && each.shape.length === 4 ? each.shape[1] : undefined);
  if (inputs.length === 1 && channels(inputs[0]) === 7) return { kind: "seven", input: inputs[0]!.name };
  const moment = inputs.find(isMoment);
  const pictures = inputs.filter((each) => each !== moment);
  if (inputs.length === 2 && moment && channels(pictures[0]) === 6) return { kind: "six", input: pictures[0]!.name, moment: momentOf(moment) };
  if (inputs.length === 3 && moment && channels(pictures[0]) === 3 && channels(pictures[1]) === 3) {
    return { kind: "three", first: pictures[0]!.name, second: pictures[1]!.name, moment: momentOf(moment) };
  }
  return refuse();
}

const inputShapes = (session: Ort.InferenceSession): InputShape[] =>
  session.inputNames.map((name, index) => {
    const meta = session.inputMetadata[index];
    return { name, shape: meta && meta.isTensor ? meta.shape : [] };
  });

/** A 16-bit float (as its bits) as a number. */
export function halfToFloat(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 31) return fraction ? Number.NaN : sign * Number.POSITIVE_INFINITY;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}
