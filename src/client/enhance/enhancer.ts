/**
 * ✦ 2K in the player: the picture the <video> shows, redrawn at 2K (see `twoKSize`) by the screen's own graphics chip, on a canvas laid over the video.
 * Loaded only when a ✦ choice is on (offers.ts says which a film gets).
 *
 * - The stronger chips (WebGPU) draw it with Anime4K's biggest 2x network ("Anime (best 2x)" of the upscaler test page, the owner's pick); the others,
 *   and any that cannot keep up with it, with AMD FSR 1 (EASU + RCAS on WebGL 2, "Sharp" on the test page). What kept up is remembered on the device
 *   for each size of picture (offers.ts `firstTier`).
 * - The <video> stays where it is and plays as always (its sound, its time, what downloads): the canvas is only drawn over it, takes no taps, and
 *   shows nothing until its first frame is drawn. Should anything fail, the canvas goes and the video is there as it was.
 * - A device that is too slow (`Watch`): Anime4K gives way to FSR 1, and FSR 1 to the plain picture, said on screen.
 */

import type { EnhanceProblem, EnhanceTier } from "../../shared";
import { firstTier, readTiers, sizeClass, TIERS_KEY, twoKSize, Watch, type Size } from "./offers";
import { GlUpscaler, GpuUpscaler, webgpuAdapter } from "./upscalers";

export interface EnhanceStatus {
  /** How it is drawn now; absent once it has ended. */
  tier?: EnhanceTier | undefined;
  /** Its first frame is on the screen. */
  drawing: boolean;
  /** Why it ended, or why it went from Anime4K to FSR 1 ("slow" with a tier). */
  problem?: EnhanceProblem | undefined;
  /** It did not start at all, without a word: a choice kept from an earlier film, for a size of picture this device was too slow for before. */
  quiet?: boolean;
}

interface Drawer {
  tier: EnhanceTier;
  canvas: HTMLCanvasElement;
  draw(video: HTMLVideoElement, out: Size): void;
  caughtUp(): boolean;
  mark(): void;
  lost(): boolean;
  dispose(): void;
}

/** Frames drawn in time before this device's way of drawing is remembered for the size (about ten seconds of a film). */
const HELD_TO_REMEMBER = 240;

function remember(height: number, tier: EnhanceTier | "slow"): void {
  try {
    const kept = readTiers(localStorage.getItem(TIERS_KEY));
    kept[sizeClass(height)] = tier;
    localStorage.setItem(TIERS_KEY, JSON.stringify(kept));
  } catch {
    // (a browser that keeps nothing starts from the top each time)
  }
}

function remembered(): ReturnType<typeof readTiers> {
  try {
    return readTiers(localStorage.getItem(TIERS_KEY));
  } catch {
    return {};
  }
}

/** A frame the page may not read (a film from a site that did not allow it): WebGL and WebGPU both say so with a SecurityError. */
const refused = (error: unknown): boolean => error instanceof DOMException && error.name === "SecurityError";

export class Enhancer {
  private drawer: Drawer | undefined;
  private request = 0;
  private stopped = false;
  private watch = new Watch();
  private kept = false;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly host: HTMLElement,
    private readonly report: (status: EnhanceStatus) => void,
  ) {}

  /**
   * `picked`: someone chose it just now (not a choice kept from an earlier film). It then starts from the top again (Anime4K where there is WebGPU),
   * whatever this device fell back to before: one slow moment once (a film starting while the computer was busy) does not keep a strong device on
   * FSR 1 for good, and the watch says within seconds if it still cannot keep up. A kept choice starts with what kept up before for this size of
   * picture, and is left off, without a word, for a size this device was too slow for.
   */
  async start(picked: boolean): Promise<void> {
    const webgpu = typeof navigator !== "undefined" && "gpu" in navigator && Boolean(navigator.gpu);
    // (What kept up is remembered by the size of the picture: a film just starting says its size first.)
    if (this.video.readyState < 1) await new Promise((resolve) => this.video.addEventListener("loadedmetadata", resolve, { once: true }));
    if (this.stopped) return;
    const first = picked ? firstTier({}, 0, webgpu) : firstTier(remembered(), this.video.videoHeight || 720, webgpu);
    if (first === "slow") {
      this.stop();
      return this.report({ drawing: false, problem: "slow", quiet: true });
    }
    await this.use(first);
    if (this.stopped || !this.drawer) return;
    const step = () => {
      if (this.stopped) return;
      this.frame();
      if (!this.stopped) this.request = this.video.requestVideoFrameCallback(step);
    };
    this.request = this.video.requestVideoFrameCallback(step);
    if (this.video.readyState >= 2) this.frame(); // (the frame on screen now: a paused film is redrawn at once, not at its next frame)
  }

  /** Takes the canvas away and gives back what it held: the video shows as it was. */
  stop(): void {
    this.stopped = true;
    this.video.cancelVideoFrameCallback?.(this.request);
    this.drop();
  }

  private drop(): void {
    const drawer = this.drawer;
    this.drawer = undefined;
    if (!drawer) return;
    drawer.canvas.remove();
    try {
      drawer.dispose();
    } catch {
      // (a context already lost has nothing to give back)
    }
  }

  private async use(tier: EnhanceTier): Promise<void> {
    this.drop();
    this.watch = new Watch();
    this.kept = false;
    const canvas = document.createElement("canvas");
    canvas.className = "tv-enhance";
    canvas.setAttribute("data-testid", "tv-enhance");
    canvas.setAttribute("data-tier", tier);
    canvas.setAttribute("aria-hidden", "true");
    let drawer: Drawer;
    if (tier === "anime") {
      const { adapter, problem } = await webgpuAdapter();
      if (this.stopped) return;
      if (!adapter) {
        console.warn(`✦ 2K: Anime4K cannot start here, FSR 1 draws instead (${problem ?? "no graphics chip"})`);
        return this.use("sharp");
      }
      let gpu: GpuUpscaler;
      try {
        gpu = await GpuUpscaler.create(adapter, canvas);
      } catch (error) {
        console.warn("✦ 2K: Anime4K did not start, FSR 1 draws instead:", error);
        return this.use("sharp");
      }
      if (this.stopped) return void gpu.dispose();
      drawer = { tier, canvas, draw: (video, out) => gpu.draw(video, out), caughtUp: () => gpu.caughtUp(), mark: () => gpu.mark(), lost: () => gpu.lost, dispose: () => gpu.dispose() };
    } else {
      let gl: GlUpscaler;
      try {
        gl = new GlUpscaler(canvas);
      } catch {
        return this.end("failed");
      }
      drawer = { tier, canvas, draw: (video, out) => gl.draw(video, out), caughtUp: () => gl.caughtUp(), mark: () => gl.mark(), lost: () => gl.lost(), dispose: () => gl.dispose() };
    }
    this.drawer = drawer;
    this.host.appendChild(canvas);
  }

  private frame(): void {
    const drawer = this.drawer;
    if (!drawer) return; // (between two ways of drawing)
    const size = { width: this.video.videoWidth, height: this.video.videoHeight };
    if (!(size.width > 0 && size.height > 0)) return;
    if (drawer.lost()) return void this.stepDown("failed");
    let late = false;
    if (!drawer.caughtUp()) late = true; // (still busy with the last frame: this one is left to the video underneath)
    else {
      try {
        drawer.draw(this.video, twoKSize(size));
        drawer.mark();
      } catch (error) {
        return void (refused(error) ? this.end("unreadable") : this.stepDown("failed"));
      }
      if (!drawer.canvas.hasAttribute("data-drawn")) {
        drawer.canvas.setAttribute("data-drawn", "true");
        this.report({ tier: drawer.tier, drawing: true });
      }
    }
    if (this.watch.note(late) === "slow") return void this.stepDown("slow");
    if (!this.kept && this.watch.held >= HELD_TO_REMEMBER) {
      this.kept = true;
      remember(size.height, drawer.tier);
    }
  }

  /** Anime4K could not go on: FSR 1 goes on in its place (and is what this device starts with next time). FSR 1 could not: the end. */
  private stepDown(problem: EnhanceProblem): void {
    const height = this.video.videoHeight;
    if (this.drawer?.tier === "anime") {
      remember(height, "sharp");
      this.report({ tier: "sharp", drawing: false, problem });
      void this.use("sharp");
      return;
    }
    if (problem === "slow") remember(height, "slow");
    this.end(problem);
  }

  private end(problem: EnhanceProblem): void {
    this.stop();
    this.report({ drawing: false, problem });
  }
}
