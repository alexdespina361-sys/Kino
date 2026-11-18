import type { EnhanceMode, EnhanceTier } from "../../shared";

export interface Size {
  width: number;
  height: number;
}

export type EnhanceOffer = Exclude<EnhanceMode, "off">;

export const isTwoK = (size: Size): boolean => size.width >= 2500 || size.height >= 1300;

export function twoKSize(size: Size): Size {
  const scale = Math.min(2560 / size.width, 1440 / size.height);
  return { width: Math.round((size.width * scale) / 2) * 2, height: Math.round((size.height * scale) / 2) * 2 };
}

export interface Can {
  upscale: boolean;
}

export function enhanceOffers(best: Size | undefined, can: Can): EnhanceOffer[] {
  if (!best || !(best.width > 0) || !(best.height > 0)) return [];
  return can.upscale && !isTwoK(best) ? ["2k"] : [];
}

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

export const sizeClass = (height: number): "sd" | "hd" | "fhd" => (height <= 600 ? "sd" : height <= 820 ? "hd" : "fhd");

export const TIERS_KEY = "kino.enhance.tiers";
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

export const readChoice = (text: string | null): EnhanceOffer | "off" => (text === "2k" ? text : "off");

export function firstTier(remembered: Remembered, height: number, webgpu: boolean): EnhanceTier | "slow" {
  const kept = remembered[sizeClass(height)];
  if (kept === "anime" && !webgpu) return "sharp";
  return kept ?? (webgpu ? "anime" : "sharp");
}
