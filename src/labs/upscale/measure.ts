/**
 * The arithmetic of the upscaler test page (labs/upscale/index.html): how big the picture is drawn, what a speed test found, and whether a mode keeps
 * up with the video. Nothing here touches the page, so it is tested on its own (measure.test.ts).
 */

/** Milliseconds a frame took, over the frames of a speed test. */
export interface Timing {
  median: number;
  p90: number;
  samples: number;
}

/** The middle and the 90th percentile of what was measured (what is not a number is left out). */
export function summarize(samples: readonly number[]): Timing {
  const sorted = samples.filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  if (sorted.length === 0) return { median: Number.NaN, p90: Number.NaN, samples: 0 };
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]!;
  return { median: at(0.5), p90: at(0.9), samples: sorted.length };
}

/** "smooth": well inside the time one frame of the video has; "tight": inside it, barely; "slow": over it, or frames were missed while it played. */
export type Verdict = "smooth" | "tight" | "slow";

/**
 * Whether a mode keeps up: a frame has `1000 / fps` milliseconds. Smooth is under half of that for nine frames in ten, and (when it was played through) at
 * least 97% of the video's frames drawn; under the whole of it with 90% drawn is tight; anything else is too slow.
 */
export function verdict(timing: Timing, fps: number, drawnShare?: number): Verdict {
  const budget = 1000 / (fps > 0 ? fps : 30);
  if (!(timing.p90 < budget) || (drawnShare !== undefined && drawnShare < 0.9)) return "slow";
  if (timing.p90 < budget * 0.5 && (drawnShare === undefined || drawnShare >= 0.97)) return "smooth";
  return "tight";
}

/**
 * The size the picture is drawn at: "720p" is a 1280 x 720 box (16:9), and the video is made as big as fits in it, keeping its shape, never smaller than
 * it is, with even sides. (A wide film at 720p is 1280 x 544, not 1728 x 720.)
 */
export function targetSize(width: number, height: number, targetHeight: number): { width: number; height: number } {
  if (!(width > 0 && height > 0)) return { width: 0, height: 0 };
  const scale = Math.max(1, Math.min((targetHeight * 16) / 9 / width, targetHeight / height));
  const even = (value: number): number => Math.max(2, Math.round(value / 2) * 2);
  return scale === 1 ? { width, height } : { width: even(width * scale), height: even(height * scale) };
}

/**
 * The first constant of AMD's `FsrEasuCon` (ffx_fsr1.h): from a pixel of the output to a position in the input, `input / output` for each axis, and the
 * offset `0.5 * input / output - 0.5`. (The other three only place the gather taps, which the WebGL port reads one by one instead.)
 */
export function easuScale(inWidth: number, inHeight: number, outWidth: number, outHeight: number): [number, number, number, number] {
  const x = inWidth / outWidth;
  const y = inHeight / outHeight;
  return [x, y, 0.5 * x - 0.5, 0.5 * y - 0.5];
}

/** AMD's `FsrRcasCon`: sharpness in stops (0 = the most) to the amount the shader multiplies by. AMD's sample uses 0.2. */
export const rcasAmount = (stops: number): number => 2 ** -Math.max(0, stops);

/** The frame rate a video plays at, from the media times of frames shown one after another; 30 while there are too few to tell. */
export function frameRate(mediaTimes: readonly number[]): number {
  const steps: number[] = [];
  for (let index = 1; index < mediaTimes.length; index++) {
    const step = mediaTimes[index]! - mediaTimes[index - 1]!;
    if (step > 0.004 && step < 0.25) steps.push(step); // (a seek or a pause is not a frame's length)
  }
  if (steps.length < 3) return 30;
  steps.sort((a, b) => a - b);
  return Math.round(100 / steps[Math.floor(steps.length / 2)]!) / 100;
}

/** "12.3 ms" with one decimal under 100, none above. */
export const ms = (value: number): string => (Number.isFinite(value) ? `${value < 100 ? value.toFixed(1) : Math.round(value)} ms` : "-");

/** The Anime modes (Anime4K on WebGPU), lightest first. */
export type AnimeMode = "anime-fast" | "anime-quality" | "anime-restore" | "anime-clean" | "anime-best" | "anime-gan";

export interface Size {
  width: number;
  height: number;
}

/** One network of Anime4K that a mode runs, by its name in anime4k-webgpu, and the size of the picture it gives. */
export interface AnimeStep {
  network: "CNNx2M" | "CNNx2VL" | "CNNx2UL" | "GANx3L" | "GANx4UUL" | "CNNVL" | "DenoiseCNNx2VL" | "Downscale";
  size: Size;
}

/**
 * What Anime4K runs for `mode` on a video of `native` size to be drawn at `out`, and the size after each step; the last is fitted to `out` with bilinear
 * filtering. The 2x networks run twice for a picture more than 2.4 times as big (480p to 1440p or 4K); "restore" and "clean" are Anime4K's own Mode A
 * and Mode C, whose steps are written here as anime4k-webgpu 1.0.0 builds them (ModeA, ModeC), to be shown on the page.
 */
export function animeSteps(mode: AnimeMode, native: Size, out: Size): AnimeStep[] {
  const times = (size: Size, factor: number): Size => ({ width: size.width * factor, height: size.height * factor });
  const bigger = (than: Size, by: number): boolean => out.width > by * than.width && out.height > by * than.height;
  if (mode === "anime-gan") return [bigger(native, 3.2) ? { network: "GANx4UUL", size: times(native, 4) } : { network: "GANx3L", size: times(native, 3) }];
  if (mode === "anime-fast" || mode === "anime-quality" || mode === "anime-best") {
    const first: AnimeStep = { network: mode === "anime-fast" ? "CNNx2M" : mode === "anime-quality" ? "CNNx2VL" : "CNNx2UL", size: times(native, 2) };
    return bigger(native, 2.4) ? [first, { network: "CNNx2M", size: times(native, 4) }] : [first];
  }
  // Mode A (restore, then upscale) and Mode C (upscale and denoise), after anime4k-webgpu's presets (their ClampHighlights step keeps the size).
  const steps: AnimeStep[] = mode === "anime-restore" ? [{ network: "CNNVL", size: native }] : [];
  let size = native;
  if (bigger(size, 1.2)) {
    size = times(size, 2);
    steps.push({ network: mode === "anime-restore" ? "CNNx2VL" : "DenoiseCNNx2VL", size });
  }
  const below = (by: number): boolean => out.width < by * native.width && out.height < by * native.height;
  if (bigger(native, 1.2) && below(2)) {
    size = out;
    steps.push({ network: "Downscale", size });
  }
  if (bigger(native, 2.4) && below(4)) {
    size = { width: Math.ceil(out.width / 2), height: Math.ceil(out.height / 2) };
    steps.push({ network: "Downscale", size });
  }
  if (bigger(size, 1.2)) {
    size = times(size, 2);
    steps.push({ network: "CNNx2M", size });
  }
  return steps;
}
