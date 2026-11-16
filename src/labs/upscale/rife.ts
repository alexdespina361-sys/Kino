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

  /** The session for pictures of `width` x `height` (padded): the sizes that vary in the file (one, then the height and width of each picture) fixed. */
  private sessionFor(width: number, height: number): Promise<Ort.InferenceSession> {
    const key = `${width}x${height}`;
    let session = this.sized.get(key);
    if (!session) {
      const overrides: Record<string, number> = {};
      if (wanted.get("rifeFixed") !== "0") {
        for (const input of this.inputs) {
          input.shape.forEach((dim, index) => {
            if (typeof dim === "string") overrides[dim] = index === 0 ? 1 : index === 2 ? height : index === 3 ? width : 1;
          });
        }
      }
      session = this.ort.InferenceSession.create(this.model, Rife.options(overrides));
      this.sized.set(key, session);
    }
    return session;
  }

  /** Where the last `make` spent its time (ms): packing the pictures, the network, bringing its answer back, unpacking it. */
  times = { pack: 0, run: 0, download: 0, unpack: 0 };

  async make(a: Picture, b: Picture, t: number): Promise<Uint8ClampedArray<ArrayBuffer>> {
    const started = performance.now();
    const [width, height] = [padded(a.width, this.step), padded(a.height, this.step)];
    const plane = width * height;
    const feeds: Record<string, Ort.Tensor> = {};
    const layout = this.layout;
    const moment = (which: Moment): Ort.Tensor =>
      which.shape === "plane"
        ? new this.ort.Tensor("float32", new Float32Array(plane).fill(t), [1, 1, height, width])
        : new this.ort.Tensor("float32", new Float32Array([t]), which.shape === "four" ? [1, 1, 1, 1] : [1]);
    if (layout.kind === "seven" || layout.kind === "six") {
      const channels = layout.kind === "seven" ? 7 : 6;
      const planes = new Float32Array(channels * plane);
      writePlanes(a, planes, 0, width, height);
      writePlanes(b, planes, 3, width, height);
      if (layout.kind === "seven") planes.fill(t, 6 * plane, 7 * plane);
      else feeds[layout.moment.name] = moment(layout.moment);
      feeds[layout.input] = new this.ort.Tensor("float32", planes, [1, channels, height, width]);
    } else {
      const first = new Float32Array(3 * plane);
      const second = new Float32Array(3 * plane);
      writePlanes(a, first, 0, width, height);
      writePlanes(b, second, 0, width, height);
      feeds[layout.first] = new this.ort.Tensor("float32", first, [1, 3, height, width]);
      feeds[layout.second] = new this.ort.Tensor("float32", second, [1, 3, height, width]);
      feeds[layout.moment.name] = moment(layout.moment);
    }
    const session = await this.sessionFor(width, height);
    const packed = performance.now();
    const results = await session.run(feeds);
    const ran = performance.now();
    const out = results[this.output]!;
    try {
      const data = (await out.getData()) as Float32Array | Uint16Array;
      const read = performance.now();
      const picture = readPlanes(data, a.width, a.height, width, height);
      this.times = { pack: packed - started, run: ran - packed, download: read - ran, unpack: performance.now() - read };
      return picture;
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
