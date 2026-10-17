import { SAMPLE_RATE } from "./signals";

type OfflineContext = OfflineAudioContext;

let context: OfflineContext | undefined;

const contextClass = (): (new (channels: number, length: number, sampleRate: number) => OfflineContext) | undefined => {
  const scope = globalThis as unknown as { OfflineAudioContext?: new (c: number, l: number, r: number) => OfflineContext; webkitOfflineAudioContext?: new (c: number, l: number, r: number) => OfflineContext };
  return scope.OfflineAudioContext ?? scope.webkitOfflineAudioContext;
};

/** Whether this browser can turn the film's sound into samples at all. */
export const canDecode = (): boolean => contextClass() !== undefined;

/**
 * The bytes of an MP4 audio piece (init segment first) as 16 kHz mono samples. An offline context decodes without opening the sound
 * device (a TV's would be kept busy by a running one), and always at the rate it is given; a browser that gives another rate anyway
 * is resampled here, so the times stay right.
 */
export async function decodeToMono16k(bytes: Uint8Array): Promise<Float32Array> {
  const Context = contextClass();
  if (!Context) throw new Error("No audio decoding");
  context ??= new Context(1, 1, SAMPLE_RATE);
  const owned = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const decoder = context;
  // (Older Safari has the callback form only.)
  const buffer = await new Promise<AudioBuffer>((resolve, reject) => {
    const result = decoder.decodeAudioData(owned as ArrayBuffer, resolve, reject) as Promise<AudioBuffer> | undefined;
    if (result && typeof result.then === "function") result.then(resolve, reject);
  });
  return resample(mix(buffer), buffer.sampleRate);
}

function mix(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice();
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const channel = buffer.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i]! += (channel[i] as number) / buffer.numberOfChannels;
  }
  return out;
}

function resample(samples: Float32Array, rate: number): Float32Array {
  if (rate === SAMPLE_RATE) return samples;
  const out = new Float32Array(Math.floor((samples.length * SAMPLE_RATE) / rate));
  for (let i = 0; i < out.length; i++) {
    const at = (i * rate) / SAMPLE_RATE;
    const k = Math.floor(at);
    const a = samples[k] as number;
    const b = samples[Math.min(samples.length - 1, k + 1)] as number;
    out[i] = a + (b - a) * (at - k);
  }
  return out;
}
