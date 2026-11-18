import type { SyncStarter } from "../tv/engine";
import { assetUrl } from "./assets";
import { WorkerBackend } from "./backend";
import { livePcm } from "./capture";
import { CrashGuard, type Kept } from "./guard";
import { SyncSession, type HlsLike, type VideoLike } from "./session";
import { httpShared } from "./share";
import { startWhistle, Unsupported, type Recogniser } from "./whistle";
import { SAMPLE_RATE } from "./signals";

type OfflineContext = OfflineAudioContext;
let context: OfflineContext | undefined;
const contextClass = (): (new (channels: number, length: number, sampleRate: number) => OfflineContext) | undefined => {
  const scope = globalThis as unknown as { OfflineAudioContext?: new (c: number, l: number, r: number) => OfflineContext; webkitOfflineAudioContext?: new (c: number, l: number, r: number) => OfflineContext };
  return scope.OfflineAudioContext ?? scope.webkitOfflineAudioContext;
};
const canDecode = (): boolean => contextClass() !== undefined;
async function decodeToMono16k(bytes: Uint8Array): Promise<Float32Array> {
  const Context = contextClass();
  if (!Context) throw new Error("No audio decoding");
  context ??= new Context(1, 1, SAMPLE_RATE);
  const owned = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const decoder = context;
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

const kept: Kept = {
  get: (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
    }
  },
  remove: (key) => {
    try {
      localStorage.removeItem(key);
    } catch {
    }
  },
};

const STILL: HlsLike = { on: () => undefined, off: () => undefined };

export const startSync: SyncStarter = (film) => {
  if (!canDecode() || typeof Worker === "undefined") return undefined;
  const guard = new CrashGuard(kept);
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;

  const session = new SyncSession({
    video: film.video as unknown as VideoLike,
    hls: (film.hls ?? STILL) as unknown as HlsLike,
    events: film.events ?? { audioSwitching: "none" },
    tap: film.tap,
    ...(film.live ? { live: true } : {}),
    show: film.show,
    report: film.report,
    ...(film.delay ? { delay: film.delay } : {}),
    backend: () => WorkerBackend.start(assetUrl("silero-vad-16k.bin")),
    decode: film.live ? livePcm : decodeToMono16k,
    shared: httpShared(),
    ...(film.offer ? { offer: film.offer } : {}),
    cores: navigator.hardwareConcurrency || 4,
    ...(film.light ? { light: film.light } : {}),
    log: (message) => console.debug("[Kino subtitle sync]", message),
    recogniser: async (): Promise<Recogniser> => {
      if (memory !== undefined && memory < 2) throw new Unsupported("Not enough memory for the recogniser");
      if (!guard.begin()) throw new Unsupported("The recogniser has taken this page down before");
      let recogniser: Recogniser;
      try {
        recogniser = await startWhistle();
      } catch (error) {
        guard.interrupted();
        throw error;
      }
      let proved = false;
      return {
        async hear(pcm) {
          const words = await recogniser.hear(pcm);
          if (!proved) {
            proved = true;
            guard.proved();
          }
          return words;
        },
        close: () => recogniser.close(),
      };
    },
  });
  const leaving = () => {
    session.flush();
    guard.interrupted();
  };
  addEventListener("pagehide", leaving);
  session.start();
  return {
    close(restore) {
      removeEventListener("pagehide", leaving);
      session.close(restore);
      guard.interrupted();
    },
  };
};
