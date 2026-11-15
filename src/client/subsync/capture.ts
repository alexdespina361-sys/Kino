import type { Piece, SoundTap } from "./tap";

/** The aligner's rate (`SAMPLE_RATE` in signals.ts, which is not imported here: this file is in the player's own bundle, and that one brings the voice detector). */
export const SAMPLE_RATE = 16000;

/**
 * The sound of a film that the browser plays by itself (an MP4 file, not a stream through hls.js), for the aligner. There are no pieces
 * to copy on their way to the player here: the sound is taken as it comes out of the `<video>` (`captureStream`), so it arrives as the
 * film plays, never ahead of the picture, and the aligner is told so (`live`, see `session.ts`).
 *
 * The browser gives that sound only when it is allowed to read the film: a film from this site, or one whose host says anyone may read
 * it (the stream relay does; the player asks it so, see `engine.ts`). From anywhere else the sound would be silence, and the player does
 * not use this.
 */

/** Seconds of sound in a piece. */
const PIECE_SECONDS = 5;
/** A stretch cut off by a pause or a jump that is shorter than this is let go: too little to be of use. */
const MIN_STRETCH_SECONDS = 1;
/** When the count of samples and the picture's clock disagree by more than this, the stretch is ended and the next begins at the picture. */
const MAX_DRIFT = 0.25;
/**
 * How far behind the picture's clock the sound comes out of the capture, in seconds. It comes a little ahead: the picture's clock is
 * the time of the sound at the speakers, and the capture takes it before them. Measured in Chromium with a film that beeps at known
 * times (fixtures/beeps.mp4): 31 to 47 ms ahead. A device with slower speakers (a TV's sound bar) puts it further ahead, by a tenth of
 * a second or so; that is within what the aligner itself can tell.
 */
export const CAPTURE_DELAY = -0.04;
/** Samples the processor hands over at a time (85 ms at 48 kHz). */
const BLOCK = 4096;
/** Pieces kept for an aligner whose code is still on its way, at most (16 kHz float samples: 64 KB a second, so about two minutes). */
const MAX_KEPT_BYTES = 8 * 1024 * 1024;

/** The parts of a `<video>` this uses. */
export interface CaptureVideo extends EventTarget {
  readonly currentTime: number;
  readonly paused: boolean;
  readonly seeking: boolean;
  readonly playbackRate: number;
  readonly readyState: number;
  captureStream?(): MediaStream;
}

/** Whether this browser can take the sound of a playing `<video>`. (Firefox has only `mozCaptureStream`, which takes the sound away from the speakers; Safari has none.) */
export const canCapture = (video: CaptureVideo): boolean =>
  typeof video.captureStream === "function" &&
  typeof AudioContext !== "undefined" &&
  typeof OfflineAudioContext !== "undefined" &&
  typeof AudioContext.prototype.createScriptProcessor === "function" &&
  typeof AudioContext.prototype.createMediaStreamSource === "function";

/**
 * Turns the blocks of sound the processor hands over, one after the other, into stretches stamped with the film's time. A block is
 * the sound that has just come out, so its last sample is the picture's time (less the capture's delay). The picture's clock, read in
 * a callback, wobbles by tens of milliseconds: so where a stretch begins is the mean of what every block of its first piece says, and
 * from there each block follows the one before by its count of samples. The stretch is begun again from the picture only when the two
 * disagree by more than `MAX_DRIFT`.
 */
export class Stamper {
  private start = 0;
  private held: Float32Array[] = [];
  private frames = 0;
  private running = false;
  /** What the blocks so far said of where the stretch begins (until its first piece is given: then it is fixed). */
  private said = 0;
  private sayings = 0;
  private fixed = false;

  constructor(
    private readonly rate: number,
    private readonly emit: (start: number, samples: Float32Array) => void,
    private readonly delay = CAPTURE_DELAY,
  ) {}

  /** `samples` have just come out, and the picture is at `now`, playing at its own speed. */
  block(samples: Float32Array, now: number): void {
    const end = now - this.delay;
    if (!this.running) {
      // (The first block after a pause or a jump may hold some of what came before it: it only sets the clock, and the stretch begins after it.)
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

  /** The stretch is broken off (a pause, a jump, another speed, the film waiting for its next bytes): what is held goes if it is long enough, and the next block begins again. */
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

/** `samples` at `rate` as 16 kHz samples, by the browser's own resampler (an offline context: it does not open the sound device). */
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

/** A piece's bytes, as the aligner's pass-through decoder takes them back (`livePcm`). */
const asPiece = (start: number, pcm: Float32Array): Piece => ({
  start,
  end: start + pcm.length / SAMPLE_RATE,
  init: new Uint8Array(0),
  data: new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength),
});

/** The aligner's "decoder" for these pieces: they are 16 kHz samples already. */
export async function livePcm(bytes: Uint8Array): Promise<Float32Array> {
  const owned = bytes.byteOffset % 4 === 0 ? bytes : bytes.slice();
  return new Float32Array(owned.buffer, owned.byteOffset, Math.floor(owned.byteLength / 4)).slice();
}

/**
 * The tap for a film the browser plays by itself: the same promises as `AudioTap` (the player owns it, the aligner connects to it), but
 * there is nothing to keep before the aligner is there, and it listens only while the aligner takes the pieces and has a subtitle
 * track to time (`wanted`): an aligner that is off, or a film watched without subtitles, costs nothing, and opens no sound device.
 */
export class ElementTap implements SoundTap {
  private take: ((piece: Piece) => void) | undefined;
  private keeping = false;
  /** Whether the sound is of use now: the aligner says so while a subtitle track is on screen (`wanted`). Until then nothing runs. */
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
      // ("playback": larger buffers, the least work for the device; nothing here is heard.)
      const context = new AudioContext({ latencyHint: "playback" });
      this.context = context;
      const processor = context.createScriptProcessor(BLOCK, 2, 1);
      const mute = context.createGain();
      mute.gain.value = 0;
      processor.connect(mute);
      mute.connect(context.destination); // (a processor that goes nowhere is not run)
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

  /** Connects the film's sound track to the processor, now or when the film has one (the source is still loading, or has changed). */
  private attach(): void {
    const context = this.context;
    const processor = this.processor;
    if (!context || !processor) return;
    try {
      this.stream ??= this.video.captureStream!();
      this.stream.removeEventListener("addtrack", this.trackCame);
      const track = this.stream.getAudioTracks().find((one) => one.readyState === "live");
      if (!track) {
        this.stream.addEventListener("addtrack", this.trackCame);
        return;
      }
      this.source?.disconnect();
      this.source = context.createMediaStreamSource(new MediaStream([track]));
      this.source.connect(processor);
      track.addEventListener("ended", () => {
        this.stamper?.flush();
        this.stream?.addEventListener("addtrack", this.trackCame);
      }, { once: true });
    } catch {
      this.quiet();
    }
  }

  private heard(input: AudioBuffer): void {
    const stamper = this.stamper;
    if (!stamper || (!this.take && !this.keeping)) return;
    const video = this.video;
    // (Only sound that plays at its own speed with the picture: anything else ends the stretch.)
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
        if (!this.context) return; // (stopped meanwhile)
        const piece = asPiece(start, pcm);
        if (this.take) this.take(piece);
        else if (this.keeping && this.keptBytes + piece.data.length <= MAX_KEPT_BYTES) {
          this.kept.push(piece);
          this.keptBytes += piece.data.length;
        }
      })
      .catch(() => undefined);
  }

  /** Stops listening: the sound device is let go, and nothing runs. */
  private quiet(): void {
    for (const name of ["pause", "seeking", "ratechange", "waiting", "emptied", "ended"]) this.video.removeEventListener(name, this.breakOff);
    for (const name of ["play", "playing"]) this.video.removeEventListener(name, this.wake);
    this.stream?.removeEventListener("addtrack", this.trackCame);
    for (const track of this.stream?.getTracks() ?? []) track.stop(); // (the copy of the sound; the film plays on)
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
  }
}
