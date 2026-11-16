/**
 * The "✦" choice of the Quality list: the picture redrawn by the screen's own graphics chip, at 2K (2560 x 1440). These are the rules of which film gets it
 * (pure, for the tests); enhancer.ts draws it, and is loaded only when it is picked. (Frames between, at 60 a second, were built and never offered: the owner
 * dropped them on 16 Nov 2026, "we no longer add frame rate booster, we only keep the 2k". The Labs test page still has its trial of them.)
 */

import type { EnhanceMode, EnhanceTier } from "../../shared";

export interface Size {
  width: number;
  height: number;
}

/** A ✦ choice (not "off"). */
export type EnhanceOffer = Exclude<EnhanceMode, "off">;

/** 2K or more already: what `formatQualityLabel` (tv/engine.ts) calls 2K (a film's own shape counts: 2500 wide, or 1300 tall). */
export const isTwoK = (size: Size): boolean => size.width >= 2500 || size.height >= 1300;

/** The size ✦ 2K draws a picture of `size` at: its own shape, as big as fits in 2560 x 1440 (a wide film 2560 x 1072), in even numbers. */
export function twoKSize(size: Size): Size {
  const scale = Math.min(2560 / size.width, 1440 / size.height);
  return { width: Math.round((size.width * scale) / 2) * 2, height: Math.round((size.height * scale) / 2) * 2 };
}

/** What this screen can do: redraw the picture bigger (WebGL 2, frames it may read). */
export interface Can {
  upscale: boolean;
}

/** The ✦ choices for a film whose biggest picture is `best` (the biggest of its qualities, or its one file's size): 2K for a film below 2K, where the screen can redraw it. */
export function enhanceOffers(best: Size | undefined, can: Can): EnhanceOffer[] {
  if (!best || !(best.width > 0) || !(best.height > 0)) return [];
  return can.upscale && !isTwoK(best) ? ["2k"] : [];
}

/** The biggest of a film's qualities that says its size (or none). A quality that says only its height (a file called "1440p") is taken as 16:9. */
export function biggest(levels: readonly { width?: number | undefined; height?: number | undefined }[]): Size | undefined {
  let best: Size | undefined;
  for (const level of levels) {
    const height = level.height ?? 0;
    const size = { width: level.width ?? Math.round((height * 16) / 9), height };
    if (!(size.width > 0 && size.height > 0)) continue;
    if (!best || size.width * size.height > best.width * best.height) best = size;
  }
  return best;
}

/**
 * Whether a device draws a picture in time: the frames it was still busy with when the video's next frame came, over the last `window` frames (the
 * first `warmup` not counted: the graphics chip builds its programs then). More than `limit` of them late: too slow (`note` says "slow" once).
 * `held`: frames drawn since the warm-up without being too slow, for remembering that this device keeps up.
 */
export class Watch {
  private readonly recent: boolean[] = [];
  private seen = 0;
  private said = false;

  constructor(
    private readonly warmup = 12,
    private readonly window = 48,
    private readonly limit = 0.2,
  ) {}

  note(late: boolean): "ok" | "slow" {
    this.seen += 1;
    if (this.seen <= this.warmup || this.said) return "ok";
    this.recent.push(late);
    if (this.recent.length > this.window) this.recent.shift();
    if (this.recent.length < this.window) return "ok";
    if (this.recent.filter(Boolean).length / this.recent.length > this.limit) {
      this.said = true;
      return "slow";
    }
    return "ok";
  }

  get held(): number {
    return this.said ? 0 : Math.max(0, this.seen - this.warmup);
  }
}

/** The size class a device's way of drawing is remembered for: what a picture of this height costs it (a 1080p picture is twice a 720p one's work). */
export const sizeClass = (height: number): "sd" | "hd" | "fhd" => (height <= 600 ? "sd" : height <= 820 ? "hd" : "fhd");

/** Where this device keeps the way of drawing that kept up, per size class (`sizeClass`): Anime4K, FSR 1, or neither ("slow"). */
export const TIERS_KEY = "kino.enhance.tiers";
/** The ✦ choice this device keeps on from film to film (absent: off). */
export const CHOICE_KEY = "kino.enhance";

export type Remembered = Partial<Record<ReturnType<typeof sizeClass>, EnhanceTier | "slow">>;

export function readTiers(text: string | null): Remembered {
  try {
    const parsed: unknown = text ? JSON.parse(text) : {};
    if (!parsed || typeof parsed !== "object") return {};
    const out: Remembered = {};
    for (const key of ["sd", "hd", "fhd"] as const) {
      const value = (parsed as Record<string, unknown>)[key];
      if (value === "anime" || value === "sharp" || value === "slow") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/** The ✦ choice kept, read back (anything else is off). */
export const readChoice = (text: string | null): EnhanceOffer | "off" => (text === "2k" ? text : "off");

/** The way to start with on this device for a picture of `height`: what kept up before, else Anime4K where there is WebGPU, else FSR 1. */
export function firstTier(remembered: Remembered, height: number, webgpu: boolean): EnhanceTier | "slow" {
  const kept = remembered[sizeClass(height)];
  if (kept === "anime" && !webgpu) return "sharp";
  return kept ?? (webgpu ? "anime" : "sharp");
}
