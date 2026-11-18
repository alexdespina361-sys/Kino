import type { EnhanceProblem, EnhanceTier } from "../../shared";
import { firstTier, readTiers, sizeClass, TIERS_KEY, twoKSize, Watch, type Size } from "./offers";
import { GlUpscaler, GpuUpscaler, webgpuAdapter } from "./upscalers";

export interface EnhanceStatus {
  tier?: EnhanceTier | undefined;
  drawing: boolean;
  problem?: EnhanceProblem | undefined;
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

const HELD_TO_REMEMBER = 240;

function remember(height: number, tier: EnhanceTier | "slow"): void {
  try {
    const kept = readTiers(localStorage.getItem(TIERS_KEY));
    kept[sizeClass(height)] = tier;
    localStorage.setItem(TIERS_KEY, JSON.stringify(kept));
  } catch {
  }
}

function remembered(): ReturnType<typeof readTiers> {
  try {
    return readTiers(localStorage.getItem(TIERS_KEY));
  } catch {
    return {};
  }
}

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

  async start(picked: boolean): Promise<void> {
    const webgpu = typeof navigator !== "undefined" && "gpu" in navigator && Boolean(navigator.gpu);
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
    if (this.video.readyState >= 2) this.frame();
  }

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
    if (!drawer) return;
    const size = { width: this.video.videoWidth, height: this.video.videoHeight };
    if (!(size.width > 0 && size.height > 0)) return;
    if (drawer.lost()) return void this.stepDown("failed");
    let late = false;
    if (!drawer.caughtUp()) late = true;
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
