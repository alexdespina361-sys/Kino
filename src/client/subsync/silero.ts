/**
 * Silero VAD v5 (the 16 kHz branch) in plain JavaScript, so the subtitle aligner needs no 14 MB onnxruntime download
 * and no SIMD: the network is one windowed-DFT layer, four small 1-D convolutions and a single LSTM step,
 * about 680 thousand multiply-adds per 32 ms of audio.
 *
 * `silero-vad-16k.bin` holds the model's own weights as little-endian float32 in the order of `LAYOUT` (extracted
 * from silero_vad.onnx, MIT licence); tests compare this port with onnxruntime's output on real speech.
 */

/** Audio samples consumed per step (32 ms at 16 kHz). */
export const SILERO_STEP = 512;

const CONTEXT = 64; // samples carried over from the previous step
const PAD = 64; // reflect padding added after the step
const WINDOW = 256; // DFT length
const HOP = 128;
const BINS = WINDOW / 2 + 1; // 129
const FRAMES = (CONTEXT + SILERO_STEP + PAD - WINDOW) / HOP + 1; // 4
const HIDDEN = 128;

/** Name, element count of every tensor in the weights file, in file order. */
const LAYOUT = [
  ["basis", 2 * BINS * WINDOW],
  ["conv0w", 128 * BINS * 3],
  ["conv0b", 128],
  ["conv1w", 64 * 128 * 3],
  ["conv1b", 64],
  ["conv2w", 64 * 64 * 3],
  ["conv2b", 64],
  ["conv3w", 128 * 64 * 3],
  ["conv3b", 128],
  ["lstmIh", 4 * HIDDEN * HIDDEN],
  ["lstmHh", 4 * HIDDEN * HIDDEN],
  ["lstmBi", 4 * HIDDEN],
  ["lstmBh", 4 * HIDDEN],
  ["outW", HIDDEN],
  ["outB", 1],
] as const;

export const SILERO_WEIGHT_FLOATS = LAYOUT.reduce((sum, [, n]) => sum + n, 0);

type Weights = { [K in (typeof LAYOUT)[number][0]]: Float32Array };

function split(all: Float32Array): Weights {
  if (all.length !== SILERO_WEIGHT_FLOATS) throw new Error(`silero weights: ${all.length} floats, expected ${SILERO_WEIGHT_FLOATS}`);
  const out: Record<string, Float32Array> = {};
  let at = 0;
  for (const [name, n] of LAYOUT) {
    out[name] = all.subarray(at, at + n);
    at += n;
  }
  return out as Weights;
}

/** Convolution with kernel 3 and padding 1, then ReLU. Input is [inC][inT], output [outC][outT]. Returns outT. */
function conv3(input: Float32Array, inC: number, inT: number, w: Float32Array, b: Float32Array, outC: number, stride: number, out: Float32Array): number {
  const outT = Math.floor((inT + 2 - 3) / stride) + 1;
  for (let o = 0; o < outC; o++) {
    for (let t = 0; t < outT; t++) {
      const first = t * stride - 1; // input index under the kernel's first tap
      const kFrom = first < 0 ? -first : 0;
      const kTo = first + 3 > inT ? inT - first : 3;
      let sum = b[o] as number;
      for (let c = 0; c < inC; c++) {
        const wAt = (o * inC + c) * 3;
        const iAt = c * inT + first;
        for (let k = kFrom; k < kTo; k++) sum += (w[wAt + k] as number) * (input[iAt + k] as number);
      }
      out[o * outT + t] = sum > 0 ? sum : 0;
    }
  }
  return outT;
}

export class Silero {
  private readonly w: Weights;
  private readonly bias: Float32Array; // lstm input and recurrent biases, added once
  private readonly h = new Float32Array(HIDDEN);
  private readonly c = new Float32Array(HIDDEN);
  private readonly context = new Float32Array(CONTEXT);
  private readonly x = new Float32Array(CONTEXT + SILERO_STEP + PAD);
  private readonly mag = new Float32Array(BINS * FRAMES);
  private readonly a0 = new Float32Array(128 * FRAMES);
  private readonly a1 = new Float32Array(64 * 2);
  private readonly a2 = new Float32Array(64);
  private readonly a3 = new Float32Array(128);
  private readonly gates = new Float32Array(4 * HIDDEN);

  constructor(weights: Float32Array) {
    this.w = split(weights);
    this.bias = new Float32Array(4 * HIDDEN);
    for (let i = 0; i < this.bias.length; i++) this.bias[i] = (this.w.lstmBi[i] as number) + (this.w.lstmBh[i] as number);
  }

  /** Forget the previous audio (call between unrelated stretches). */
  reset(): void {
    this.h.fill(0);
    this.c.fill(0);
    this.context.fill(0);
  }

  /** The detector's memory, so that several stretches of audio can take turns. */
  save(): Float32Array {
    const out = new Float32Array(2 * HIDDEN + CONTEXT);
    out.set(this.h, 0);
    out.set(this.c, HIDDEN);
    out.set(this.context, 2 * HIDDEN);
    return out;
  }

  restore(memory: Float32Array): void {
    this.h.set(memory.subarray(0, HIDDEN));
    this.c.set(memory.subarray(HIDDEN, 2 * HIDDEN));
    this.context.set(memory.subarray(2 * HIDDEN, 2 * HIDDEN + CONTEXT));
  }

  /** Speech probability (0..1) for the next `SILERO_STEP` samples of a continuous stretch; a short last chunk is zero padded. */
  step(audio: Float32Array, from: number): number {
    const { x, w } = this;
    x.set(this.context, 0);
    const n = Math.max(0, Math.min(SILERO_STEP, audio.length - from));
    for (let i = 0; i < n; i++) x[CONTEXT + i] = audio[from + i] as number;
    for (let i = n; i < SILERO_STEP; i++) x[CONTEXT + i] = 0;
    this.context.set(x.subarray(SILERO_STEP, SILERO_STEP + CONTEXT));
    const end = CONTEXT + SILERO_STEP;
    for (let j = 0; j < PAD; j++) x[end + j] = x[end - 2 - j] as number; // reflect, edge sample not repeated

    // windowed DFT magnitude: mag[bin][frame]
    const basis = w.basis;
    for (let f = 0; f < FRAMES; f++) {
      const at = f * HOP;
      for (let bin = 0; bin < BINS; bin++) {
        const re = bin * WINDOW;
        const im = (BINS + bin) * WINDOW;
        let r = 0;
        let i = 0;
        for (let k = 0; k < WINDOW; k++) {
          const v = x[at + k] as number;
          r += (basis[re + k] as number) * v;
          i += (basis[im + k] as number) * v;
        }
        this.mag[bin * FRAMES + f] = Math.sqrt(r * r + i * i);
      }
    }

    // encoder
    let t = conv3(this.mag, BINS, FRAMES, w.conv0w, w.conv0b, 128, 1, this.a0);
    t = conv3(this.a0, 128, t, w.conv1w, w.conv1b, 64, 2, this.a1);
    t = conv3(this.a1, 64, t, w.conv2w, w.conv2b, 64, 2, this.a2);
    conv3(this.a2, 64, t, w.conv3w, w.conv3b, 128, 1, this.a3);

    // one LSTM step (gate rows: input, forget, cell, output)
    const { gates, a3, h, c, bias } = this;
    for (let g = 0; g < 4 * HIDDEN; g++) {
      const ih = g * HIDDEN;
      let sum = bias[g] as number;
      for (let k = 0; k < HIDDEN; k++) sum += (w.lstmIh[ih + k] as number) * (a3[k] as number) + (w.lstmHh[ih + k] as number) * (h[k] as number);
      gates[g] = sum;
    }
    for (let k = 0; k < HIDDEN; k++) {
      const i = 1 / (1 + Math.exp(-(gates[k] as number)));
      const fg = 1 / (1 + Math.exp(-(gates[HIDDEN + k] as number)));
      const cell = Math.tanh(gates[2 * HIDDEN + k] as number);
      const o = 1 / (1 + Math.exp(-(gates[3 * HIDDEN + k] as number)));
      const next = fg * (c[k] as number) + i * cell;
      c[k] = next;
      h[k] = o * Math.tanh(next);
    }

    let out = w.outB[0] as number;
    for (let k = 0; k < HIDDEN; k++) {
      const v = h[k] as number;
      if (v > 0) out += (w.outW[k] as number) * v;
    }
    return 1 / (1 + Math.exp(-out));
  }
}

/** Speech probability per 10 ms for a whole stretch of 16 kHz audio (32 ms steps, linearly resampled), as the aligner wants it. */
export function sileroProbability(vad: Silero, audio: Float32Array): Float32Array {
  vad.reset();
  const steps = Math.ceil(audio.length / SILERO_STEP);
  const values = new Float32Array(steps);
  for (let s = 0; s < steps; s++) values[s] = vad.step(audio, s * SILERO_STEP);
  return resampleProbability(values, Math.floor(audio.length / 160));
}

/** 32 ms values to 10 ms values: value i is centred at (i + 0.5) * 10 ms, step s at (s + 0.5) * 32 ms. */
export function resampleProbability(values: Float32Array, count: number): Float32Array {
  const out = new Float32Array(count);
  const last = values.length - 1;
  for (let i = 0; i < count; i++) {
    const x = (i * 0.01) / 0.032 - 0.5;
    const a = Math.max(0, Math.min(last, Math.floor(x)));
    const z = Math.min(last, a + 1);
    const f = Math.max(0, x - a);
    out[i] = (values[a] as number) * (1 - f) + (values[z] as number) * f;
  }
  return out;
}
