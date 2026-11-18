import type { Piece, SoundTap } from "./tap";

export const SAMPLE_RATE = 16000;

const PIECE_SECONDS = 5;
const MIN_STRETCH_SECONDS = 1;
const MAX_DRIFT = 0.25;
export const CAPTURE_DELAY = -0.04;
const BLOCK = 4096;
const MAX_KEPT_BYTES = 8 * 1024 * 1024;

export interface CaptureVideo extends EventTarget {
  readonly currentTime: number;
  readonly paused: boolean;
  readonly seeking: boolean;
  readonly playbackRate: number;
  readonly readyState: number;
  captureStream?(): MediaStream;
}

export const canCapture = (video: CaptureVideo): boolean =>
  typeof video.captureStream === "function" &&
  typeof AudioContext !== "undefined" &&
  typeof OfflineAudioContext !== "undefined" &&
  typeof AudioContext.prototype.createScriptProcessor === "function" &&
  typeof AudioContext.prototype.createMediaStreamSource === "function";

export class Stamper {
  private start = 0;
  private held: Float32Array[] = [];
  private frames = 0;
  private running = false;
  private said = 0;
  private sayings = 0;
  private fixed = false;

  constructor(
    private readonly rate: number,
    private readonly emit: (start: number, samples: Float32Array) => void,
    private readonly delay = CAPTURE_DELAY,
  ) {}

  block(samples: Float32Array, now: number): void {
    const end = now - this.delay;
    if (!this.running) {
      this.begin(end);
      return;
    }
    const says = end - (this.frames + samples.length) / this.rate;
    if (Math.abs(says - this.start) > MAX_DRIFT) {
      this.flush();
      this.begin(end);
      return;
    }
    if (!this.fixed) {
      this.said += says;
      this.sayings += 1;
      this.start = this.said / this.sayings;
    }
    this.held.push(samples.slice());
    this.frames += samples.length;
    if (this.frames >= PIECE_SECONDS * this.rate) this.give();
  }

  flush(): void {
    if (this.frames >= MIN_STRETCH_SECONDS * this.rate) this.give();
    this.held = [];
    this.frames = 0;
    this.running = false;
  }

  private begin(at: number): void {
    this.running = true;
    this.start = at;
    this.said = at;
    this.sayings = 1;
    this.fixed = false;
    this.held = [];
    this.frames = 0;
  }

  private give(): void {
    const out = new Float32Array(this.frames);
    let at = 0;
    for (const part of this.held) {
      out.set(part, at);
      at += part.length;
    }
    const start = this.start;
    this.fixed = true;
    this.start += this.frames / this.rate;
    this.held = [];
    this.frames = 0;
    this.emit(start, out);
  }
}

async function to16k(samples: Float32Array, rate: number): Promise<Float32Array> {
  if (rate === SAMPLE_RATE) return samples;
  const length = Math.max(1, Math.round((samples.length * SAMPLE_RATE) / rate));
  const offline = new OfflineAudioContext(1, length, SAMPLE_RATE);
  const buffer = offline.createBuffer(1, samples.length, rate);
  buffer.getChannelData(0).set(samples);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice();
}

const asPiece = (start: number, pcm: Float32Array): Piece => ({
  start,
  end: start + pcm.length / SAMPLE_RATE,
  init: new Uint8Array(0),
  data: new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength),
});

export async function livePcm(bytes: Uint8Array): Promise<Float32Array> {
  const owned = bytes.byteOffset % 4 === 0 ? bytes : bytes.slice();
  return new Float32Array(owned.buffer, owned.byteOffset, Math.floor(owned.byteLength / 4)).slice();
}

export class ElementTap implements SoundTap {
  private take: ((piece: Piece) => void) | undefined;
  private keeping = false;
  private useful = false;
  private kept: Piece[] = [];
  private keptBytes = 0;
  private context: AudioContext | undefined;
  private stream: MediaStream | undefined;
  private source: MediaStreamAudioSourceNode | undefined;
  private processor: ScriptProcessorNode | undefined;
  private mute: GainNode | undefined;
  private stamper: Stamper | undefined;
  private readonly breakOff = (): void => this.stamper?.flush();
  private readonly wake = (): void => {
    void this.context?.resume().catch(() => undefined);
  };
  private readonly trackCame = (): void => this.attach();
  private track: MediaStreamTrack | undefined;

  constructor(private readonly video: CaptureVideo) {}

  connect(take: (piece: Piece) => void): void {
    const waiting = this.kept;
    this.kept = [];
    this.keptBytes = 0;
    this.keeping = false;
    this.take = take;
    for (const piece of waiting) take(piece);
    this.listen();
  }

  disconnect(): void {
    this.take = undefined;
    if (!this.keeping) this.quiet();
  }

  wanted(on: boolean): void {
    this.useful = on;
    if (on) this.listen();
    else this.quiet();
  }

  keep(on: boolean): void {
    this.keeping = on;
    if (on) this.listen();
    else {
      this.kept = [];
      this.keptBytes = 0;
      if (!this.take) this.quiet();
    }
  }

  stop(): void {
    this.take = undefined;
    this.keep(false);
    this.quiet();
  }

  private listen(): void {
    if (this.context || !this.useful || (!this.take && !this.keeping) || !canCapture(this.video)) return;
    try {
      const context = new AudioContext({ latencyHint: "playback" });
      this.context = context;
      const processor = context.createScriptProcessor(BLOCK, 2, 1);
      const mute = context.createGain();
      mute.gain.value = 0;
      processor.connect(mute);
      mute.connect(context.destination);
      this.processor = processor;
      this.mute = mute;
      const stamper = new Stamper(context.sampleRate, (start, samples) => this.made(start, samples, context.sampleRate));
      this.stamper = stamper;
      processor.onaudioprocess = (event) => this.heard(event.inputBuffer);
      for (const name of ["pause", "seeking", "ratechange", "waiting", "emptied", "ended"]) this.video.addEventListener(name, this.breakOff);
      for (const name of ["play", "playing"]) this.video.addEventListener(name, this.wake);
      this.attach();
      this.wake();
    } catch {
      this.quiet();
    }
  }

  private attach(): void {
    const context = this.context;
    const processor = this.processor;
    if (!context || !processor) return;
    try {
      if (!this.stream) {
        this.stream = this.video.captureStream!();
        this.stream.addEventListener("addtrack", this.trackCame);
      }
      for (const picture of this.stream.getVideoTracks()) picture.stop();
      if (this.track?.readyState === "live") return;
      const track = this.stream.getAudioTracks().find((one) => one.readyState === "live");
      if (!track) return;
      this.source?.disconnect();
      this.source = context.createMediaStreamSource(new MediaStream([track]));
      this.source.connect(processor);
      this.track = track;
      track.addEventListener("ended", () => this.stamper?.flush(), { once: true });
    } catch {
      this.quiet();
    }
  }

  private heard(input: AudioBuffer): void {
    const stamper = this.stamper;
    if (!stamper || (!this.take && !this.keeping)) return;
    const video = this.video;
    if (video.paused || video.seeking || video.playbackRate !== 1 || video.readyState < 3) {
      stamper.flush();
      return;
    }
    const channels = input.numberOfChannels;
    const mono = new Float32Array(input.length);
    for (let c = 0; c < channels; c++) {
      const data = input.getChannelData(c);
      for (let i = 0; i < mono.length; i++) mono[i]! += (data[i] as number) / channels;
    }
    stamper.block(mono, video.currentTime);
  }

  private made(start: number, samples: Float32Array, rate: number): void {
    void to16k(samples, rate)
      .then((pcm) => {
        if (!this.context) return;
        const piece = asPiece(start, pcm);
        if (this.take) this.take(piece);
        else if (this.keeping && this.keptBytes + piece.data.length <= MAX_KEPT_BYTES) {
          this.kept.push(piece);
          this.keptBytes += piece.data.length;
        }
      })
      .catch(() => undefined);
  }

  private quiet(): void {
    for (const name of ["pause", "seeking", "ratechange", "waiting", "emptied", "ended"]) this.video.removeEventListener(name, this.breakOff);
    for (const name of ["play", "playing"]) this.video.removeEventListener(name, this.wake);
    this.stream?.removeEventListener("addtrack", this.trackCame);
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    if (this.processor) this.processor.onaudioprocess = null;
    this.source?.disconnect();
    this.processor?.disconnect();
    this.mute?.disconnect();
    void this.context?.close().catch(() => undefined);
    this.context = undefined;
    this.source = undefined;
    this.processor = undefined;
    this.mute = undefined;
    this.stamper = undefined;
    this.stream = undefined;
    this.track = undefined;
  }
}
