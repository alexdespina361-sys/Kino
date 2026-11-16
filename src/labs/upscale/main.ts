import "./style.css";
import { FILM_FROM, GlUpscaler, isFilm, type FilmMode, type GlMode } from "./glUpscaler";
import { GpuUpscaler, webgpuAdapter, type AnimeMode } from "./gpuUpscaler";
import { animeSteps, frameRate, ms, summarize, targetSize, verdict, type Timing, type Verdict } from "./measure";
import { Cadence, HELD_FRAMES, RIFE_LEAD, SteadyGrid, VideoClock, boostDelay, boostPhase, gridJobs, gridMoment, refreshRate, type HeldFrame, type Phase } from "./boostTiming";
import type { BoostHow, FrameBoost, Size } from "./frameBoost";
import { Rife, padded, type Motion, type Picture } from "./rife";

/**
 * The upscaler test page (labs/upscale/index.html): plays a video file picked on this computer, draws it bigger with one of several modes, and times
 * each. Nothing leaves the computer: the file is played from a blob: address, and the page asks the server for nothing but its own code.
 */

type Mode = GlMode | AnimeMode;

/** What a mode is for: any video (films, shows), or drawn pictures (cartoons, anime). In each group, the lightest first. */
type Group = "off" | "any" | "drawn";

const MODES: readonly { mode: Mode; name: string; about: string; group: Group }[] = [
  { mode: "off", name: "Off", about: "Plain scaling, the way the browser draws a video now.", group: "off" },
  { mode: "sharp", name: "Sharp (FSR 1)", about: "AMD FSR 1: finds the edges and keeps them crisp, then sharpens. Any video, most graphics chips.", group: "any" },
  {
    mode: "film",
    name: "Film (FSRCNNX)",
    about: "FSRCNNX 8-0-4-1: a small neural network trained on photographs that redraws the picture's detail at twice the size. For films and shows; WebGL 2 is enough.",
    group: "any",
  },
  { mode: "film-quality", name: "Film (FSRCNNX, bigger)", about: "FSRCNNX 16-0-4-1: twice the network, a little more detail, about three times the work.", group: "any" },
  { mode: "anime-fast", name: "Anime (fast)", about: "Anime4K CNNx2M: a small neural network made for drawn pictures (cartoons, anime). Needs WebGPU, as all the Anime modes.", group: "drawn" },
  { mode: "anime-quality", name: "Anime (quality)", about: "Anime4K CNNx2VL: a bigger network, cleaner lines.", group: "drawn" },
  {
    mode: "anime-restore",
    name: "Anime (restore)",
    about: "Anime4K's Mode A: a network first takes the blur away, then the picture is upscaled. Lines come out much crisper: for soft, blurry videos.",
    group: "drawn",
  },
  {
    mode: "anime-clean",
    name: "Anime (clean up)",
    about: "Anime4K's Mode C: upscales and takes the noise and the blocks of compression away at once. For noisy 480p (old DVDs, small streams).",
    group: "drawn",
  },
  { mode: "anime-best", name: "Anime (best 2x)", about: "Anime4K CNNx2UL: the biggest of its 2x networks, the cleanest lines, a lot more work.", group: "drawn" },
  {
    mode: "anime-gan",
    name: "Anime (GAN)",
    about: "Anime4K GANx3L (GANx4UUL for 4K): a GAN network that draws in fine detail of its own. The strongest look, and the most work.",
    group: "drawn",
  },
];
const nameOf = (mode: Mode): string => MODES.find((entry) => entry.mode === mode)?.name ?? mode;
const isAnime = (mode: Mode): mode is AnimeMode => mode.startsWith("anime-");

/** Frames drawn and waited for in a speed test (the first ones only warm up). */
const WARM_UP = 5;
const TIMED = 40;
/** How long a speed test plays the video for (`?seconds=2` makes it shorter, for the page's own tests; up to 10 minutes, for a long run by hand). */
const PLAY_SECONDS = Math.min(600, Math.max(1, Number(new URLSearchParams(location.search).get("seconds")) || 8));

const element = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`The page has no #${id}`);
  return found as T;
};
const video = element<HTMLVideoElement>("video");
const glCanvas = element<HTMLCanvasElement>("gl-canvas");
const gpuCanvas = element<HTMLCanvasElement>("gpu-canvas");
const stage = element<HTMLDivElement>("stage");
const stageScroll = element<HTMLDivElement>("stage-scroll");
const compare = element<HTMLInputElement>("compare");
const status = element<HTMLParagraphElement>("status");
const playButton = element<HTMLButtonElement>("play");
const seek = element<HTMLInputElement>("seek");
const targetSelect = element<HTMLSelectElement>("target");
const viewSelect = element<HTMLSelectElement>("view");
const testOne = element<HTMLButtonElement>("test-one");
const testAll = element<HTMLButtonElement>("test-all");
const testStop = element<HTMLButtonElement>("test-stop");
const boostSelect = element<HTMLSelectElement>("boost");
const boostHowSelect = element<HTMLSelectElement>("boost-how");
const motionSelect = element<HTMLSelectElement>("rife-size");
/** The left side's copies of the frames the boost holds (one each, by the boost's number for the frame). */
const heldCanvases = Array.from({ length: HELD_FRAMES }, (_, index) => element<HTMLCanvasElement>(`held-${index}`));

let mode: Mode = "sharp";
let gl: GlUpscaler | undefined;
let glProblem = "";
let adapter: GPUAdapter | undefined;
let gpuProblem = "";
let gpu: GpuUpscaler | undefined;
let gpuStarting: Promise<GpuUpscaler | undefined> | undefined;
let objectUrl = "";
/** A speed test is drawing the frames itself: the playing loop leaves them alone. */
let timing = false;
let testing = false;
let stopAsked = false;

const say = (text: string): void => {
  status.textContent = text;
};
const problemText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const hasFrame = (): boolean => video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0;
const outSize = (): { width: number; height: number } => targetSize(video.videoWidth, video.videoHeight, Number(targetSelect.value));
const nextFrame = (): Promise<void> => new Promise((done) => {
  const timer = setTimeout(done, 100); // (a page in the background gets no animation frames)
  requestAnimationFrame(() => {
    clearTimeout(timer);
    done();
  });
});
const sleep = (millis: number): Promise<void> => new Promise((done) => setTimeout(done, millis));

// ---------------------------------------------------------------- what this computer has

function startWebGl(): void {
  try {
    gl = new GlUpscaler(glCanvas);
    element("device-gl").textContent = `Yes: ${gl.gpuName() || "a graphics chip the browser does not name"}`;
  } catch (error) {
    glProblem = problemText(error);
    element("device-gl").textContent = `No. ${glProblem}`;
  }
}

async function findWebGpu(): Promise<void> {
  const found = await webgpuAdapter();
  adapter = found.adapter;
  gpuProblem = found.problem ?? "";
  element("device-gpu").textContent = adapter ? `Yes: ${found.name || "a graphics chip WebGPU does not name"}` : `No. ${gpuProblem}`;
  drawModes();
}

/** The Anime modes' engine, started the first time one is chosen (it loads about 3.5 MB of Anime4K then, and only then). */
function startGpu(): Promise<GpuUpscaler | undefined> {
  if (gpu && !gpu.lost) return Promise.resolve(gpu);
  if (!adapter) return Promise.resolve(undefined);
  gpuStarting ??= (async () => {
    say("Loading Anime4K (about 3.5 MB, once)...");
    try {
      gpu = await GpuUpscaler.create(adapter!, gpuCanvas);
      say("");
      return gpu;
    } catch (error) {
      gpuProblem = `Anime4K did not start: ${problemText(error)}`;
      say(gpuProblem);
      return undefined;
    } finally {
      gpuStarting = undefined;
    }
  })();
  return gpuStarting;
}

/** The FSRCNNX shader files (public/labs/upscale/fsrcnnx/, LGPL 3.0, served unchanged: see the README there). */
const FILM_FILES: Record<FilmMode, string> = { film: "FSRCNNX_x2_8-0-4-1.glsl", "film-quality": "FSRCNNX_x2_16-0-4-1.glsl" };
const filmProblems = new Map<FilmMode, string>();
const filmLoading = new Map<FilmMode, Promise<void>>();

/** Fetches and compiles a Film network, the first time it is chosen (70 KB or 250 KB of shader text). */
function loadFilm(wanted: FilmMode): Promise<void> {
  const loading =
    filmLoading.get(wanted) ??
    (async () => {
      say(`Loading ${nameOf(wanted)}...`);
      try {
        const answer = await fetch(`/labs/upscale/fsrcnnx/${FILM_FILES[wanted]}`);
        if (!answer.ok) throw new Error(`the site answered ${answer.status}`);
        gl!.loadFilm(wanted, await answer.text());
        say("");
      } catch (error) {
        filmProblems.set(wanted, `The network did not load: ${problemText(error)}`);
        say(filmProblems.get(wanted)!);
      } finally {
        filmLoading.delete(wanted);
      }
    })();
  filmLoading.set(wanted, loading);
  return loading;
}

/** Whether `wanted` can draw here now; why not, if it cannot. */
async function ready(wanted: Mode): Promise<string> {
  if (isFilm(wanted)) {
    if (!gl) return glProblem || "WebGL 2 is not available";
    const why = gl.filmProblem() || filmProblems.get(wanted);
    if (why) return why;
    if (!gl.hasFilm(wanted)) await loadFilm(wanted);
    return filmProblems.get(wanted) ?? "";
  }
  if (!isAnime(wanted)) return gl ? "" : glProblem || "WebGL 2 is not available";
  if (!adapter) return gpuProblem || "WebGPU is not available";
  return (await startGpu()) ? "" : gpuProblem;
}

function drawModes(): void {
  const box = element("modes");
  box.replaceChildren(
    ...MODES.map(({ mode: each, name, about }) => {
      const why = isAnime(each) ? (adapter ? "" : gpuProblem) : !gl ? glProblem : isFilm(each) ? gl.filmProblem() || filmProblems.get(each) || "" : "";
      const label = document.createElement("label");
      label.className = "mode";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "mode";
      input.value = each;
      input.checked = each === mode;
      input.disabled = Boolean(why) || testing;
      input.dataset.testid = `upscale-mode-${each}`;
      input.addEventListener("change", () => void choose(each));
      const title = document.createElement("strong");
      title.textContent = name;
      const text = document.createElement("span");
      text.textContent = why ? `${about} Not here: ${why}` : about;
      label.append(input, title, text);
      return label;
    }),
  );
}

// ---------------------------------------------------------------- drawing

function showCanvasFor(drawn: Mode): void {
  glCanvas.hidden = isAnime(drawn);
  gpuCanvas.hidden = !isAnime(drawn);
}

/** Draws the frame the video shows now, with `drawn`. Throws what went wrong. */
function drawNow(drawn: Mode): void {
  const out = outSize();
  if (isAnime(drawn)) {
    if (!gpu) throw new Error("The Anime engine is not started");
    gpu.draw(video, drawn, out);
  } else {
    if (!gl) throw new Error(glProblem || "WebGL 2 is not available");
    gl.draw(video, drawn, out);
  }
}

/** Waits until the graphics chip has drawn it all, so that the time around it is the real one. */
async function finishNow(drawn: Mode): Promise<void> {
  if (isAnime(drawn)) await gpu?.finish();
  else gl?.finish();
}

function render(): void {
  if (timing || !hasFrame()) return;
  try {
    if (boostOn()) {
      // (The boost draws on the screen's own rhythm, below: it is only asked to draw again, with the video's frame of now if it holds none.)
      if (held.length === 0 && rifeFrames.length === 0) takeFrame(performance.now(), video.currentTime);
      lastDrawn = "";
      return;
    }
    drawNow(mode);
  } catch (error) {
    say(`${nameOf(mode)} could not draw: ${problemText(error)}. Back to Off.`);
    mode = "off";
    showCanvasFor(mode);
    drawModes();
  }
}

async function choose(wanted: Mode): Promise<void> {
  const why = await ready(wanted);
  if (why) {
    say(`${nameOf(wanted)} cannot run here: ${why}`);
    drawModes();
    return;
  }
  mode = wanted;
  showCanvasFor(mode);
  drawModes();
  describeSize();
  render();
}

/** The mode of the key pressed: 1 for the first of MODES, 0 for the tenth. */
const modeOfKey = (key: string): Mode | undefined => (/^[0-9]$/.test(key) ? MODES[(Number(key) + 9) % 10]?.mode : undefined);

/** The frames counted while a speed test plays the video (by the loop below, and with the frame boost by its own loop: the frames it showed). */
const counted = { on: false, drawn: 0, firstPresented: -1, lastPresented: -1, mediaTimes: [] as number[], boostFrames: 0, boostOnTime: 0, boostFirst: -1, boostLast: -1 };
/**
 * Why the boost's frames of a speed test were not in time (for a look by hand: `kinoUpscaleLab.boost().misses`): the chip had not finished the frame
 * before; RIFE had not made the moment (`held`: the video's own frame shown, `late`: an earlier one of RIFE's); moments RIFE left out as too late to make.
 */
const misses = { chip: 0, held: 0, late: 0, skipped: 0 };
/** What drawRife drew last: "own", "made", "late" or "held". */
let rifeKind = "";

const engineOf = (drawn: Mode): { caughtUp(): boolean; mark(): void } | undefined => (isAnime(drawn) ? gpu : gl);

function onVideoFrame(now: number, frame: VideoFrameCallbackMetadata): void {
  if (boostOn()) {
    if (!timing) takeFrame(now, frame.mediaTime);
    if (counted.on && !timing) counted.mediaTimes.push(frame.mediaTime);
    video.requestVideoFrameCallback(onVideoFrame);
    return;
  }
  const counting = counted.on && !timing;
  // (A frame counts as drawn only if the chip had finished the one before when this one arrived: work that is merely queued has not been seen.)
  const onTime = counting ? (engineOf(mode)?.caughtUp() ?? false) : true;
  render();
  if (counting) {
    engineOf(mode)?.mark();
    if (counted.firstPresented < 0) counted.firstPresented = frame.presentedFrames;
    else if (onTime) counted.drawn++;
    counted.lastPresented = frame.presentedFrames;
    counted.mediaTimes.push(frame.mediaTime);
  }
  video.requestVideoFrameCallback(onVideoFrame);
}

/** (For a browser without requestVideoFrameCallback: draws on every animation frame while the video plays.) */
let lastTime = -1;
function onAnimationFrame(): void {
  if (boostOn()) {
    if (video.currentTime !== lastTime && !timing) takeFrame(performance.now(), video.currentTime);
    lastTime = video.currentTime;
  } else if (!video.paused && video.currentTime !== lastTime) {
    lastTime = video.currentTime;
    render();
    if (counted.on && !timing) counted.drawn++;
  }
  requestAnimationFrame(onAnimationFrame);
}
const frameCallbacks = typeof video.requestVideoFrameCallback === "function";

// ---------------------------------------------------------------- the frame boost (frameBoost.ts, boostTiming.ts, rife.ts)

/** Frames a second the boost makes the video (0: off, the video as it is). */
const boostFps = (): number => Number(boostSelect.value) || 0;
const boostHow = (): BoostHow => (boostHowSelect.value === "blend" ? "blend" : "rife");
const boostOn = (): boolean => boostFps() > 0 && Boolean(gl);
const howName = (how: BoostHow): string => (how === "blend" ? "Blend" : "RIFE");
const boostName = (): string => `${boostFps()} fps (${howName(boostHow())})`;

const videoClock = new VideoClock();
const cadence = new Cadence();
/** The frames the boost holds, oldest first: their moments, and the boost's numbers for them (Blend). */
let held: { frame: HeldFrame; serial: number }[] = [];
/** What was drawn last (the two frames and where between them, or RIFE's moment): the same again is not drawn again. */
let lastDrawn = "";
/** The times between the screen's refreshes (ms), for its refresh rate. */
const refreshGaps: number[] = [];
let lastRefresh = Number.NaN;
/** New frames shown in the last second, for the line under the picture. */
const shownTimes: number[] = [];
let lastLine = 0;

const screenHz = (): number => refreshRate(refreshGaps);
/** What the boost worked out last (for a look by hand: `kinoUpscaleLab.boost()`). */
let lastPhase: object | undefined;

// RIFE's side. Each frame of the video is kept at its full size as a texture (the RIFE boost, frameBoost.ts) and, made smaller ("RIFE finds the motion
// at"), as pixels for RIFE (it takes them from the processor's memory). When a frame comes, the moments between it and the one before are asked of RIFE,
// one after another, ahead of the screen (RIFE_LEAD). RIFE gives how each part moves (rife.ts `motion`), and the screen's frame is warped from the two
// full-size frames by that (frameBoost.ts `warp`); if RIFE was not done in time, the video's own frame of before is shown (and that counts as a frame
// not shown in time).
interface RifeFrame {
  mediaTime: number;
  /** Its number in the RIFE boost, which holds it at its full size. */
  serial: number;
  /** The frame at the size RIFE finds the motion at, as pixels. */
  small: Picture;
  /** A copy for the left side ("as it is"), one of RIFE_FRAMES canvases taken in turn. */
  copy: HTMLCanvasElement;
}
/** The video's last frames, oldest first (enough for the moments RIFE_LEAD late). */
let rifeFrames: RifeFrame[] = [];
const RIFE_FRAMES = 12;
const leftCopies: HTMLCanvasElement[] = [];
/** The moments asked of RIFE and not made yet, oldest first. `key`: the grid's rate and number (see gridJobs). */
let rifeJobs: { key: string; moment: number; a: RifeFrame; b: RifeFrame; t: number }[] = [];
/** What RIFE made (the motion from the two frames to the moment), by key. */
const rifeMade = new Map<string, { moment: number; motion: Motion; a: RifeFrame; b: RifeFrame }>();
/**
 * How much smaller than the video RIFE finds the motion ("RIFE finds the motion at"): 1, 0.75, 0.5, 0.33 or 0.25, or "auto": the most that keeps RIFE's
 * pictures (padded) within AUTO_MOTION pixels for the boost chosen. On this PC's RTX 3090 at 60, RIFE kept up on pictures of 320 x 192 (padded) and
 * not on 448 x 256; at 30 it has twice the time a frame.
 */
const AUTO_MOTION = { 60: 320 * 192, 30: 448 * 256 } as const;
const motionScale = (): number => {
  const value = Number(motionSelect.value);
  if (value > 0 && value <= 1) return value;
  if (!hasFrame()) return 0.5;
  return autoMotionScale({ width: video.videoWidth, height: video.videoHeight }, boostFps() > 30 ? AUTO_MOTION[60] : AUTO_MOTION[30]);
};
/** The largest scale (in hundredths, up to 1) at which `size`, made smaller and padded to RIFE's step, has at most `pixels`. */
function autoMotionScale(size: Size, pixels: number): number {
  for (let hundredths = 100; hundredths > 5; hundredths--) {
    const scale = hundredths / 100;
    const area = padded(Math.round(size.width * scale), RIFE_STEP) * padded(Math.round(size.height * scale), RIFE_STEP);
    if (area <= pixels) return scale;
  }
  return 0.05;
}
/** The size RIFE finds the motion at for a video of `size`. */
const motionSize = (size: Size): Size => ({ width: Math.max(8, Math.round(size.width * motionScale())), height: Math.max(8, Math.round(size.height * motionScale())) });
let rifeBusy = false;
/** Counts the boost's restarts: what RIFE answers for a run before the last restart is dropped. */
let rifeRun = 0;
/** How long RIFE took for its last frames (ms, pictures in and out included). */
const rifeTimes: number[] = [];
/** The picture sizes RIFE has made a frame of (see pumpRife). */
const rifeSizes = new Set<string>();
/** A canvas for taking the video's pixels. */
const grab = document.createElement("canvas");
const gridKey = (rate: number, m: number): string => `${rate.toFixed(3)} ${m}`;
/** The grid RIFE's moments are on (see SteadyGrid: the measured refresh rate wobbles, the grid must not). */
const steadyGrid = new SteadyGrid();

/** The moment the screen shows at `now` (s of the video): a frame and a refresh late, and RIFE_LEAD more with RIFE. */
function boostShown(now: number): number {
  if (video.paused) return Number.POSITIVE_INFINITY;
  return videoClock.at(now, video.playbackRate || 1) - boostDelay(videoClock.frameTime(), screenHz()) - (boostHow() === "rife" ? RIFE_LEAD : 0);
}

/** Takes the video's frame of now (at `now`, its moment `mediaTime`) into the boost, and its copy for the left side. */
function takeFrame(now: number, mediaTime: number): void {
  if (!gl || !hasFrame()) return;
  const size = { width: video.videoWidth, height: video.videoHeight };
  try {
    const frame = { mediaTime, arrived: now };
    videoClock.add(frame, video.playbackRate || 1);
    if (boostHow() === "rife") {
      takeRifeFrame(mediaTime, size);
      return;
    }
    const boost = gl.frameBoost();
    const serial = boost.push(video, size);
    held.push({ frame, serial });
    held = held.filter((each) => boost.holds(each.serial)).slice(-HELD_FRAMES);
    const copy = heldCanvases[serial % HELD_FRAMES]!;
    if (copy.width !== size.width || copy.height !== size.height) {
      copy.width = size.width;
      copy.height = size.height;
    }
    copy.getContext("2d")?.drawImage(video, 0, 0, size.width, size.height);
  } catch (error) {
    stopBoost(`The frame boost stopped: ${problemText(error)}`);
  }
}

function takeRifeFrame(mediaTime: number, size: Size): void {
  const serial = gl!.rifeBoost(RIFE_FRAMES).push(video, size);
  const copy = (leftCopies[serial % RIFE_FRAMES] ??= document.createElement("canvas"));
  if (copy.width !== size.width || copy.height !== size.height) {
    copy.width = size.width;
    copy.height = size.height;
  }
  copy.getContext("2d")?.drawImage(video, 0, 0, size.width, size.height);
  const frame: RifeFrame = { mediaTime, serial, small: smallPicture(video, size), copy };
  const before = rifeFrames.at(-1);
  rifeFrames.push(frame);
  if (rifeFrames.length > RIFE_FRAMES) rifeFrames.shift();
  if (!before) return;
  const rate = steadyGrid.at(boostFps(), screenHz());
  for (const job of gridJobs(before.mediaTime, mediaTime, rate)) {
    const key = gridKey(rate, job.m);
    if (!rifeMade.has(key)) rifeJobs.push({ key, moment: job.m / rate, a: before, b: frame, t: job.t });
  }
  void pumpRife();
}

/** `source` (of `size`) at the size RIFE finds the motion at, as pixels. */
function smallPicture(source: CanvasImageSource, size: Size): Picture {
  return pictureAt(source, motionSize(size));
}

/** `source` drawn at `small` (made smaller with the browser's best filter), as pixels. */
function pictureAt(source: CanvasImageSource, small: Size): Picture {
  if (grab.width !== small.width || grab.height !== small.height) {
    grab.width = small.width;
    grab.height = small.height;
  }
  const context = grab.getContext("2d", { willReadFrequently: true })!;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, small.width, small.height);
  return { data: context.getImageData(0, 0, small.width, small.height).data, width: small.width, height: small.height };
}

/**
 * The most moments RIFE makes in one run for pictures of `size`: a few on small pictures, where a run of two or three takes little more than a run of
 * one (on this PC's RTX 3090, 448 x 192: 20 ms for one, 24 for two, 30 for three), one on big ones, where it saves nothing (640 x 384: 29 ms for one,
 * 54 for two, and three ran out of the card's quick memory).
 */
const RIFE_BATCH = 3;
const rifeBatch = (size: Size): number => Math.max(1, Math.min(RIFE_BATCH, Math.floor((448 * 256 * RIFE_BATCH) / (padded(size.width, RIFE_STEP) * padded(size.height, RIFE_STEP)))));
/** How long RIFE's last runs took (ms, a run of one or several moments), for knowing which moments it can still make in time. */
const rifeRunTimes: number[] = [];
/** How many moments RIFE made in its last run. */
let rifeLastBatch = 0;

/** Has RIFE make the moments asked, a few at a time, in the order the screen needs them, skipping those it can no longer make in time. */
async function pumpRife(): Promise<void> {
  if (rifeBusy) return;
  rifeBusy = true;
  const run = rifeRun;
  try {
    const network = await loadRifeMotion();
    while (rifeJobs.length > 0 && run === rifeRun) {
      const shown = boostShown(performance.now());
      // (Only the moments it can make before the screen gets to them: one it would finish late is skipped, so that a RIFE too slow for every moment
      // makes as many as it can in time, not all of them too late. The screen goes through the video's moments at its playing speed.)
      // (At most most of the lead: a RIFE slower than that still makes the moments furthest ahead, and so its time keeps being measured.)
      const takes = Math.min(median(rifeRunTimes) || 50, RIFE_LEAD * 1000 * 0.8) / 1000;
      const speed = video.playbackRate || 1;
      // (Both frames at the size of now: one taken before "RIFE finds the motion at" changed is of another.)
      const size = motionSize({ width: video.videoWidth, height: video.videoHeight });
      const ofNow = (picture: Picture): boolean => picture.width === size.width && picture.height === size.height;
      const asked = rifeJobs.length;
      rifeJobs = rifeJobs.filter((job) => job.moment - shown > takes * speed && ofNow(job.a.small) && ofNow(job.b.small));
      if (counted.on) misses.skipped += asked - rifeJobs.length;
      const batch = rifeJobs.splice(0, network.batches ? rifeBatch(size) : 1);
      if (batch.length === 0) break;
      const started = performance.now();
      const motions = await network.motions(batch.map((job) => ({ a: job.a.small, b: job.b.small, t: job.t })));
      if (run !== rifeRun) break;
      // (Not the first run of a size and a batch: the browser builds RIFE's programs for it then, which takes a second once.)
      const sized = `${size.width}x${size.height}x${batch.length}`;
      if (rifeSizes.has(sized)) {
        const took = performance.now() - started;
        rifeRunTimes.push(took);
        if (rifeRunTimes.length > 30) rifeRunTimes.shift();
        rifeTimes.push(took / batch.length);
        if (rifeTimes.length > 30) rifeTimes.shift();
      } else rifeSizes.add(sized);
      rifeLastBatch = batch.length;
      batch.forEach((job, index) => rifeMade.set(job.key, { moment: job.moment, motion: motions[index]!, a: job.a, b: job.b }));
      for (const [key, made] of rifeMade) if (made.moment < shown - 0.5) rifeMade.delete(key);
    }
  } catch (error) {
    if (run === rifeRun) stopBoost(`RIFE stopped: ${problemText(error)}`);
  } finally {
    rifeBusy = false;
  }
  // (Moments asked while the last one was being made, after a restart.)
  if (run !== rifeRun && rifeJobs.length > 0) void pumpRife();
}

/** The middle of `values`, 0 for none. */
const median = (values: readonly number[]): number => (values.length === 0 ? 0 : [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!);

/** How long RIFE takes for a frame here (ms, the middle of its last ones; a run of several counted as its time shared), 0 before it made any. */
const rifeMs = (): number => median(rifeTimes);

/** How many frames a second RIFE has to make for the boost chosen (the moments that are not the video's own frames). */
function rifeNeeds(own: number): number {
  if (!(own > 0)) return 0;
  const rate = steadyGrid.at(boostFps(), screenHz());
  let count = 0;
  for (let index = 0; index < Math.round(own); index++) count += gridJobs(index / own, (index + 1) / own, rate).length;
  return count;
}

/** Draws a picture of the boost (a texture of the video's size) with `drawn`, at the target. */
function drawPicture(picture: { texture: WebGLTexture; size: { width: number; height: number } }, drawn: Mode): void {
  const out = outSize();
  if (isAnime(drawn)) {
    if (!gpu) throw new Error("The Anime engine is not started");
    // (WebGPU cannot read WebGL's textures: the picture is drawn plainly on the WebGL canvas, hidden in an Anime mode, and taken from there at once.)
    gl!.drawFrom(picture.texture, picture.size, "off", picture.size);
    gpu.draw(glCanvas, drawn, out, picture.size);
  } else {
    gl!.drawFrom(picture.texture, picture.size, drawn, out);
  }
}

/** Shows, on the left, the video's own frame number `serial` (the frame of the moment the boost shows). */
function showHeld(serial: number): void {
  heldCanvases.forEach((canvas, index) => {
    canvas.hidden = index !== serial % HELD_FRAMES;
  });
  stage.classList.add("boosted");
}

/** Shows, on the left, the video's own frame `frame` (RIFE: its copy). */
let leftFrame: RifeFrame | undefined;
function showRifeLeft(frame: RifeFrame): void {
  stage.classList.add("boosted");
  const canvas = heldCanvases[0]!;
  heldCanvases.forEach((each, index) => (each.hidden = index !== 0));
  if (leftFrame === frame) return;
  leftFrame = frame;
  if (canvas.width !== frame.copy.width || canvas.height !== frame.copy.height) {
    canvas.width = frame.copy.width;
    canvas.height = frame.copy.height;
  }
  canvas.getContext("2d")?.drawImage(frame.copy, 0, 0);
}

/**
 * Draws what the boost shows at the refresh of `now`, if it is a new frame. Returns whether it drew, and whether what it drew was the frame it should
 * be (RIFE not done in time: the video's own frame of before is shown, and that is not in time).
 */
function drawBoost(now: number): { drew: boolean; right: boolean } {
  if (boostHow() === "rife") return drawRife(now);
  const hz = screenHz();
  const fps = boostFps();
  const shown = boostShown(now);
  const phase: Phase = boostPhase(
    held.map((each) => each.frame),
    shown,
    fps,
  );
  lastPhase = { ...phase, shown, frames: held.map((each) => each.frame.mediaTime) };
  if (phase.between && !cadence.tick(now, fps, hz)) return { drew: false, right: true };
  const from = held[phase.from]!;
  const to = held[phase.to]!;
  const key = `${from.serial} ${to.serial} ${phase.t.toFixed(4)} ${mode} ${outSize().width}`;
  if (key === lastDrawn) return { drew: false, right: true };
  lastDrawn = key;
  drawPicture(gl!.frameBoost().draw(from.serial, to.serial, phase.t), mode);
  showHeld(phase.t >= 1 ? to.serial : from.serial);
  return { drew: true, right: true };
}

function drawRife(now: number): { drew: boolean; right: boolean } {
  if (rifeFrames.length === 0) return { drew: false, right: true };
  const shown = boostShown(now);
  const rate = steadyGrid.at(boostFps(), screenHz());
  const m = Number.isFinite(shown) ? gridMoment(shown, rate) : Number.NaN;
  const moment = m / rate;
  // The video's own frame at the moment (or the last before it), and RIFE's for the moment.
  const own = Number.isFinite(moment) ? (rifeFrames.filter((frame) => frame.mediaTime <= moment + 0.25 / rate).at(-1) ?? rifeFrames[0]!) : rifeFrames.at(-1)!;
  const step = videoClock.frameTime() || 1 / 24;
  const exact = !Number.isFinite(moment) || Math.abs(own.mediaTime - moment) <= 0.02 * step;
  let made = exact ? undefined : rifeMade.get(gridKey(rate, m));
  let kind = exact ? "own" : made ? "made" : "held";
  let pictureMoment = exact ? own.mediaTime : moment;
  if (kind === "held") {
    // RIFE was not done in time for this moment: the newest picture there is of before it, the video's own or one RIFE made (a frame shown late, which
    // is not in time, but moves on; without it, a computer RIFE is too slow on would show the video's own frames only).
    pictureMoment = own.mediaTime;
    for (const each of rifeMade.values()) {
      if (each.moment <= moment && each.moment > pictureMoment) {
        pictureMoment = each.moment;
        made = each;
      }
    }
  }
  const boost = gl!.rifeBoost(RIFE_FRAMES);
  // (RIFE's frames are warped from the two frames it was asked about: one the boost no longer holds is not drawn, the video's own is.)
  if (made && !(boost.holds(made.a.serial) && boost.holds(made.b.serial))) {
    made = undefined;
    kind = "held";
    pictureMoment = own.mediaTime;
  }
  lastPhase = { shown, rate, m, kind, own: own.mediaTime, picture: pictureMoment, jobs: rifeJobs.length, made: rifeMade.size, motion: made ? `${made.motion.width}x${made.motion.height}` : undefined };
  const key = `${pictureMoment.toFixed(5)} ${mode} ${outSize().width}`;
  if (key === lastDrawn) return { drew: false, right: true };
  lastDrawn = key;
  if (kind === "held" && made) kind = "late";
  rifeKind = kind;
  drawPicture(made ? boost.warp(made.a.serial, made.b.serial, made.motion) : boost.draw(own.serial, own.serial, 0), mode);
  showRifeLeft(own);
  return { drew: true, right: kind === "own" || kind === "made" };
}

function onBoostRefresh(now: number): void {
  requestAnimationFrame(onBoostRefresh);
  if (Number.isFinite(lastRefresh)) {
    refreshGaps.push(now - lastRefresh);
    if (refreshGaps.length > 120) refreshGaps.shift();
  }
  lastRefresh = now;
  if (!boostOn() || timing || (held.length === 0 && rifeFrames.length === 0)) return;
  // (A frame counts as drawn in time only if the chip had finished the one before when this one is drawn, as for the video's own frames above.)
  const counting = counted.on;
  const caughtUp = counting ? (engineOf(mode)?.caughtUp() ?? false) : true;
  let result = { drew: false, right: true };
  try {
    result = drawBoost(now);
  } catch (error) {
    stopBoost(`The frame boost stopped: ${problemText(error)}`);
    return;
  }
  if (!result.drew) return;
  if (counting) {
    engineOf(mode)?.mark();
    counted.boostFrames++;
    if (caughtUp && result.right) counted.boostOnTime++;
    if (!caughtUp) misses.chip++;
    if (!result.right && (rifeKind === "held" || rifeKind === "late")) misses[rifeKind]++;
    if (counted.boostFirst < 0) counted.boostFirst = now;
    counted.boostLast = now;
  }
  shownTimes.push(now);
  while (shownTimes.length && shownTimes[0]! < now - 1000) shownTimes.shift();
  if (now - lastLine > 500) {
    lastLine = now;
    describeBoost();
  }
}

/** Starts the boost again from the frame of now (a new setting, a new video, or after a speed test). */
function restartBoost(): void {
  held = [];
  rifeFrames = [];
  rifeJobs = [];
  rifeMade.clear();
  rifeRun++;
  steadyGrid.reset();
  leftFrame = undefined;
  videoClock.reset();
  cadence.reset();
  lastDrawn = "";
  shownTimes.length = 0;
  if (!boostOn()) {
    stage.classList.remove("boosted");
    for (const canvas of heldCanvases) canvas.hidden = true;
  }
  describeBoost();
  render();
}

function stopBoost(why: string): void {
  say(why);
  boostSelect.value = "0";
  restartBoost();
}

function describeBoost(): void {
  const line = element("boost-info");
  const fps = boostFps();
  line.hidden = fps === 0;
  if (fps === 0) return;
  if (!gl) {
    line.textContent = `The frame boost needs WebGL 2: ${glProblem || "not available here"}.`;
    return;
  }
  const rife = boostHow() === "rife";
  const how = rife ? "RIFE (a neural network that finds how each part moves)" : "Blend (two frames mixed)";
  const frameTime = videoClock.frameTime();
  const own = frameTime > 0 ? 1 / frameTime : 0;
  const hz = screenHz();
  const parts: string[] = [];
  if (own > 0 && own >= fps * 0.99) parts.push(`This video has ${own.toFixed(own % 1 > 0.05 ? 2 : 0)} frames a second already: the boost adds none.`);
  else {
    parts.push(
      `Frame boost: ${own > 0 ? `the video's ${own.toFixed(Math.abs(own - Math.round(own)) > 0.01 ? 3 : 0)}` : "the video's"} frames a second made into ${fps}, by ${how}.`,
    );
    if (frameTime > 0) {
      const late = boostDelay(frameTime, hz) + (rife ? RIFE_LEAD : 0);
      parts.push(`It is shown ${Math.round(late * 1000)} ms late (${rife ? "RIFE makes its frames ahead" : "it needs the next frame to make the ones before it"}); the left side is the video's own frame of the same moment.`);
    }
    if (rife && hasFrame()) {
      const small = motionSize({ width: video.videoWidth, height: video.videoHeight });
      parts.push(`RIFE finds the motion on pictures of ${small.width} x ${small.height}${motionScale() < 1 ? ", and the frame is warped at the video's full size by it" : ""}.`);
    }
    if (rife && rifeMs() > 0 && own > 0) {
      const needs = rifeNeeds(own);
      const keeps = rifeMs() <= (1000 / Math.max(1, needs)) * 0.9;
      parts.push(`RIFE makes a frame in ${Math.round(rifeMs())} ms here${rifeLastBatch > 1 ? ` (${rifeLastBatch} at a time)` : ""}; ${needs} a second are needed (${Math.round(1000 / Math.max(1, needs))} ms each)${keeps ? "" : ": too slow, so some moments show the video's own frame again"}.`);
    }
  }
  if (hz > 0) parts.push(`This screen refreshes ${Math.round(hz)} times a second${hz < fps * 0.95 ? `, so it shows ${Math.round(hz)} at most` : ""}.`);
  if (!video.paused && shownTimes.length > 1) parts.push(`Now: ${shownTimes.length} new frames a second.`);
  line.textContent = parts.join(" ");
}

boostSelect.addEventListener("change", restartBoost);
boostHowSelect.addEventListener("change", restartBoost);
motionSelect.addEventListener("change", restartBoost);

// ---------------------------------------------------------------- the video and its controls

const clock = (seconds: number): string => {
  if (!Number.isFinite(seconds)) return "0:00";
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
};

function describeSize(): void {
  if (!(video.videoWidth > 0)) return;
  const out = outSize();
  const factor = out.width / video.videoWidth;
  const parts = [`The video is ${video.videoWidth} × ${video.videoHeight}; it is drawn at ${out.width} × ${out.height}`];
  parts[0] += factor > 1.001 ? ` (${factor.toFixed(2).replace(/\.?0+$/, "")} times as big).` : ": it is that big already, so the modes only sharpen it.";
  if (isFilm(mode)) {
    parts.push(
      factor >= FILM_FROM
        ? `FSRCNNX redraws its brightness at ${video.videoWidth * 2} × ${video.videoHeight * 2}, then that is fitted to ${out.width} × ${out.height} (bicubic); the colour is the video's.`
        : `FSRCNNX only works on a picture drawn at least ${FILM_FROM} times as big: this one is drawn plainly.`,
    );
  }
  if (isAnime(mode)) {
    const steps = animeSteps(mode, { width: video.videoWidth, height: video.videoHeight }, out).map(
      ({ network, size }) => `${network === "Downscale" ? "shrinks it" : network} to ${size.width} × ${size.height}`,
    );
    const last = animeSteps(mode, { width: video.videoWidth, height: video.videoHeight }, out).at(-1)?.size;
    const fitted = last && (last.width !== out.width || last.height !== out.height) ? `; that is fitted to ${out.width} × ${out.height}` : "";
    parts.push(`Anime4K ${steps.join(", then ")}${fitted}.`);
  }
  element("size-info").textContent = parts.join(" ");
  element("split-mode").textContent = mode === "off" ? "Off" : nameOf(mode);
  fitStage();
}

const isFullScreen = (): boolean => document.fullscreenElement === stageScroll;

function fitStage(): void {
  const out = outSize();
  if (!(out.width > 0)) return;
  stage.style.aspectRatio = `${out.width} / ${out.height}`;
  stage.style.setProperty("--aspect", String(out.width / out.height));
  const view = viewSelect.value;
  const pixels = out.width / (window.devicePixelRatio || 1);
  // (Full screen, "to fit" is the screen: see .stage-scroll:fullscreen in style.css.)
  stage.style.width = view === "actual" ? `${pixels}px` : view === "zoom" ? `${pixels * 2}px` : isFullScreen() ? "" : "100%";
  stage.classList.toggle("pixelated", view === "zoom");
  stage.classList.toggle("fit", view === "fit");
  requestAnimationFrame(describeShown);
}

/**
 * How big the picture is on the screen now, in the screen's own pixels: a 1440p picture shown in the page's column is shrunk back to about 1000 pixels
 * wide, and what the modes added is mostly lost with it.
 */
function describeShown(): void {
  const out = outSize();
  const shown = Math.round(stage.getBoundingClientRect().width * (window.devicePixelRatio || 1));
  if (!(out.width > 0 && shown > 0)) return;
  const height = Math.round((shown * out.height) / out.width);
  element("shown-info").textContent =
    shown < out.width * 0.95
      ? `Shown at ${shown} × ${height} screen pixels now: smaller than it is drawn, so the difference is shrunk away too. Press Full screen, or choose Pixel for pixel, to see all of it.`
      : `Shown at ${shown} × ${height} screen pixels: every pixel drawn is on the screen.`;
}

/** Moves the line between "as it is" (left) and the mode (right) to `percent` of the picture's width. */
function setSplit(percent: number): void {
  const at = Math.min(100, Math.max(0, percent));
  stage.style.setProperty("--split", `${at}%`);
  compare.value = String(Math.round(at));
}

async function toggleFullScreen(): Promise<void> {
  try {
    if (isFullScreen()) await document.exitFullscreen();
    else await stageScroll.requestFullscreen();
  } catch (error) {
    say(`Full screen did not start: ${problemText(error)}`);
  }
}

/** Plays `video` (a file from this computer, or a free clip of the page brought whole first: a test must not wait on the network). */
function open(file: Blob | undefined, name = file instanceof File ? file.name : "video", from = "on this computer"): void {
  if (!file) return;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);
  element("file-name").textContent = `${name} (${(file.size / 1024 / 1024).toFixed(1)} MB, ${from})`;
  element("viewer").hidden = false;
  element("tests").hidden = false;
  say("Opening...");
  video.src = objectUrl;
  video.load();
  element("viewer").scrollIntoView({ behavior: "smooth", block: "start" });
}

/** One of the page's free clips (public/labs/upscale/clips/, CC BY: see CREDITS.txt there). */
async function openSample(name: string): Promise<void> {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>("[data-sample]")];
  for (const button of buttons) button.disabled = true;
  element("viewer").hidden = false;
  say(`Bringing the clip ${name}...`);
  try {
    const answer = await fetch(`/labs/upscale/clips/${encodeURIComponent(name)}`);
    if (!answer.ok) throw new Error(`the site answered ${answer.status}`);
    open(await answer.blob(), name, "a free clip of this page");
  } catch (error) {
    say(`The clip did not come: ${problemText(error)}. Try again, or choose a file of your own.`);
  } finally {
    for (const button of buttons) button.disabled = false;
  }
}
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-sample]")) {
  button.addEventListener("click", () => void openSample(button.dataset.sample!));
}

video.addEventListener("loadedmetadata", () => {
  describeSize();
  say("");
  restartBoost();
});
video.addEventListener("loadeddata", render);
video.addEventListener("seeked", render);
video.addEventListener("error", () => {
  say("This browser cannot play this file. An MP4 (H.264) or a WebM plays everywhere; an MKV or an HEVC file often does not.");
});
video.addEventListener("play", () => (playButton.textContent = "Pause"));
video.addEventListener("pause", () => (playButton.textContent = "Play"));
video.addEventListener("timeupdate", () => {
  if (video.duration > 0) seek.value = String(Math.round((video.currentTime / video.duration) * 1000));
  element("time").textContent = `${clock(video.currentTime)} / ${clock(video.duration)}`;
});

playButton.addEventListener("click", () => {
  if (video.paused) void video.play().catch((error: unknown) => say(`It did not play: ${problemText(error)}`));
  else video.pause();
});
seek.addEventListener("input", () => {
  if (video.duration > 0) video.currentTime = (Number(seek.value) / 1000) * video.duration;
});
targetSelect.addEventListener("change", () => {
  describeSize();
  render();
});
viewSelect.addEventListener("change", fitStage);
compare.addEventListener("input", () => setSplit(Number(compare.value)));
// The line follows the mouse over the picture (a finger moves it by dragging), for a quick look at any part of it.
stage.addEventListener("pointermove", (event) => {
  if (event.pointerType !== "mouse" && event.buttons === 0) return;
  const box = stage.getBoundingClientRect();
  if (box.width > 0) setSplit(((event.clientX - box.left) / box.width) * 100);
});
stage.addEventListener("pointerdown", (event) => {
  const box = stage.getBoundingClientRect();
  if (box.width > 0) setSplit(((event.clientX - box.left) / box.width) * 100);
});
stage.addEventListener("dblclick", () => void toggleFullScreen());
element<HTMLButtonElement>("fullscreen").addEventListener("click", () => void toggleFullScreen());
document.addEventListener("fullscreenchange", fitStage);
// Keys: F full screen, 1 to 8 the modes, Space play or pause (but not while a field or a button of the page has the keyboard: it is theirs then).
document.addEventListener("keydown", (event) => {
  if (event.ctrlKey || event.altKey || event.metaKey || element("viewer").hidden) return;
  const focused = document.activeElement;
  const typing = focused instanceof HTMLInputElement || focused instanceof HTMLSelectElement || focused instanceof HTMLTextAreaElement;
  if (event.key === "f" || event.key === "F") {
    event.preventDefault();
    void toggleFullScreen();
    return;
  }
  const wanted = typing ? undefined : modeOfKey(event.key);
  if (wanted && !testing) {
    event.preventDefault();
    void choose(wanted);
    return;
  }
  if (event.key === " " && !typing && !(focused instanceof HTMLButtonElement)) {
    event.preventDefault();
    playButton.click();
  }
});
element<HTMLInputElement>("file").addEventListener("change", (event) => open((event.target as HTMLInputElement).files?.[0]));
const drop = element("drop");
drop.addEventListener("dragover", (event) => {
  event.preventDefault();
  drop.classList.add("over");
});
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (event) => {
  event.preventDefault();
  drop.classList.remove("over");
  open(event.dataTransfer?.files[0]);
});
window.addEventListener("resize", fitStage);

// ---------------------------------------------------------------- the speed test

interface Played {
  drawn: number;
  expected: number;
  dropped: number;
  fps: number;
  /** With the frame boost: the screen's refresh rate (the frames it showed are counted, not the video's). */
  screenHz?: number;
}
interface Result {
  mode: Mode;
  /** The frame boost it was tested with (none: the video's own frames); with RIFE, how much smaller it found the motion (motionScale). */
  boost?: { fps: number; how: BoostHow; motion?: number };
  /** With RIFE: how long it took for a frame while the video played (ms, the middle), and how many a second were needed. */
  rife?: { ms: number; needs: number };
  timing?: Timing;
  /** The longest of the first frames, drawn before the timed ones: building and compiling the mode's networks, once. */
  gettingReady?: number;
  played?: Played;
  verdict?: Verdict;
  problem?: string;
}

/** What the tests found, by mode, and by mode and frame boost (`resultKey`). */
const results = new Map<string, Result>();
/** The frame boost chosen now, as a result names it. */
const boostNow = (): Result["boost"] => (boostOn() ? { fps: boostFps(), how: boostHow(), ...(boostHow() === "rife" ? { motion: motionScale() } : {}) } : undefined);
const boostKey = (boost: NonNullable<Result["boost"]>): string => `${boost.fps} ${boost.how}${boost.motion ? ` ${boost.motion}` : ""}`;
const resultKey = (tested: Mode): string => {
  const now = boostNow();
  return now ? `${tested} ${boostKey(now)}` : tested;
};

/** The frames a second the screen should get with the boost on: the boost's, or the video's own if it has more, and never more than the screen shows. */
function boostTarget(): number {
  const own = counted.mediaTimes.length > 2 ? frameRate(counted.mediaTimes) : videoClock.frameTime() > 0 ? 1 / videoClock.frameTime() : 0;
  const wanted = Math.max(own, boostFps());
  const hz = screenHz();
  return hz > 0 ? Math.min(wanted, hz) : wanted;
}

/**
 * Draws one frame for a speed test, as the playing video would be drawn: with the boost on, a frame between two (Blend), or a frame handed in (RIFE's: its
 * own time is not in this, it is measured while the video plays, as RIFE works beside the drawing).
 */
let timedSerial = 0;
function drawTimed(tested: Mode): void {
  if (!boostOn()) {
    drawNow(tested);
    return;
  }
  const size = { width: video.videoWidth, height: video.videoHeight };
  if (boostHow() === "rife") {
    // (RIFE's frame as the screen gets it: the frame warped at its full size by a motion of the size RIFE finds it at, here one of no motion.)
    const rife = gl!.rifeBoost(RIFE_FRAMES);
    if (!rife.holds(timedSerial)) timedSerial = rife.push(video, size);
    const serial = rife.push(video, size);
    drawPicture(rife.warp(timedSerial, serial, stillMotion(size)), tested);
    timedSerial = serial;
    return;
  }
  const boost = gl!.frameBoost();
  if (!boost.holds(timedSerial)) timedSerial = boost.push(video, size);
  // (The video stands still during the timing: the same frame twice costs the boost what two frames do.)
  const serial = boost.push(video, size);
  drawPicture(boost.draw(timedSerial, serial, 0.5), tested);
  timedSerial = serial;
}

/** A motion of none (RIFE's answer for a picture that stands still) at the size RIFE finds the motion at for a video of `size`: for the speed test. */
let still: Motion | undefined;
function stillMotion(size: Size): Motion {
  const small = motionSize(size);
  const [padWidth, padHeight] = [padded(small.width, RIFE_STEP), padded(small.height, RIFE_STEP)];
  if (!still || still.width !== small.width || still.height !== small.height) {
    const data = new Float32Array(5 * padWidth * padHeight);
    data.fill(0.5, 4 * padWidth * padHeight); // (the mask: half of each)
    still = { data, width: small.width, height: small.height, padWidth, padHeight };
  }
  return still;
}

/**
 * Plays the video for a few seconds and counts the frames the mode drew in time of those the video showed (and the browser dropped). "unseen": the
 * video played but the browser showed the page none of its frames, as it does for a page it is not drawing (hidden, or behind other windows).
 */
async function playThrough(): Promise<Played | "unseen" | undefined> {
  const before = video.getVideoPlaybackQuality?.();
  Object.assign(counted, { on: true, drawn: 0, firstPresented: -1, lastPresented: -1, mediaTimes: [], boostFrames: 0, boostOnTime: 0, boostFirst: -1, boostLast: -1 });
  Object.assign(misses, { chip: 0, held: 0, late: 0, skipped: 0 });
  const looped = video.loop;
  video.loop = true;
  try {
    await video.play();
    for (let left = PLAY_SECONDS * 10; left > 0 && !stopAsked; left--) await sleep(100);
  } catch (error) {
    say(`The video did not play: ${problemText(error)}`);
    return undefined;
  } finally {
    video.pause();
    video.loop = looped;
    counted.on = false;
  }
  const after = video.getVideoPlaybackQuality?.();
  const dropped = before && after ? Math.max(0, after.droppedVideoFrames - before.droppedVideoFrames) : 0;
  if (boostOn()) {
    // The frames the screen got from the boost, against what it should have got in that time.
    if (counted.boostFrames < 3) return "unseen";
    const seconds = (counted.boostLast - counted.boostFirst) / 1000;
    const fps = seconds > 0 ? (counted.boostFrames - 1) / seconds : 0;
    return { drawn: counted.boostOnTime, expected: Math.max(1, Math.round(seconds * boostTarget()) + 1), dropped, fps, screenHz: screenHz() };
  }
  // (A browser that showed the page no frames at all gives nothing to count: not "none kept up", and its times are a throttled page's.)
  if (frameCallbacks ? counted.mediaTimes.length < 3 : counted.drawn < 3) return "unseen";
  const shown = frameCallbacks ? Math.max(0, counted.lastPresented - counted.firstPresented) : Math.round(PLAY_SECONDS * frameRate(counted.mediaTimes));
  return { drawn: counted.drawn, expected: Math.max(1, shown + dropped), dropped, fps: frameRate(counted.mediaTimes) };
}

/** Whether the page went to the background during a test: it then draws slower and shows no frames, so what was measured says nothing. */
let wentAway = false;
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && testing) wentAway = true;
});
const AWAY = "The page was not on screen during the test (another tab, minimised, or behind other windows), which slows it down and shows no frames: test again with this page in front.";

async function speedTest(tested: Mode): Promise<Result> {
  const why = await ready(tested);
  if (why) return { mode: tested, problem: why };
  video.pause();
  showCanvasFor(tested);
  const samples: number[] = [];
  let gettingReady = 0;
  const boost = boostNow();
  timing = true;
  try {
    for (let index = 0; index < WARM_UP + TIMED && !stopAsked; index++) {
      const start = performance.now();
      drawTimed(tested);
      await finishNow(tested);
      const took = performance.now() - start;
      if (index >= WARM_UP) samples.push(took);
      else gettingReady = Math.max(gettingReady, took);
      say(index < WARM_UP ? `${nameOf(tested)}: getting ready (${ms(took)})...` : `${nameOf(tested)}: frame ${index + 1 - WARM_UP} of ${TIMED} took ${ms(took)}`);
      // (The first frames of a network take long once, while the browser compiles it: about 2 s for the biggest here, more on a slower computer. Only
      // a timed frame that long says the mode is too slow; it would take minutes to time them all.)
      if (index >= WARM_UP ? took > 2000 : took > 30_000) break;
      await nextFrame();
    }
  } catch (error) {
    return { mode: tested, boost, problem: problemText(error) };
  } finally {
    timing = false;
    // (The timing pushed the same frame again and again: the boost starts again from the video's next frame.)
    if (boost) restartBoost();
  }
  const measured = summarize(samples);
  if (stopAsked) return { mode: tested, boost, problem: "Stopped" };
  if (measured.samples === 0) return { mode: tested, boost, problem: `It took ${ms(gettingReady)} to get ready, and no frame was timed: far too slow here.` };
  let played: Played | undefined;
  let rife: Result["rife"];
  if (measured.samples > 0 && measured.median < 1000) {
    const was = mode;
    mode = tested; // (the playing loop draws with the mode under test)
    if (boost?.how === "rife") {
      // (RIFE gets ready first, once: its network loaded and its first frame made, which takes a second or two.)
      say(`${nameOf(tested)}: RIFE getting ready...`);
      try {
        await warmRife();
      } catch (error) {
        mode = was;
        return { mode: tested, boost, problem: `RIFE did not start: ${problemText(error)}` };
      }
      rifeTimes.length = 0;
      rifeRunTimes.length = 0;
    }
    say(`${nameOf(tested)}: playing for ${PLAY_SECONDS} seconds and counting the frames...`);
    const seen = await playThrough();
    if (boost?.how === "rife") rife = { ms: rifeMs(), needs: rifeNeeds(counted.mediaTimes.length > 2 ? frameRate(counted.mediaTimes) : 24) };
    mode = was;
    showCanvasFor(mode);
    render();
    if (seen === "unseen") wentAway = true;
    else played = seen;
  }
  if (wentAway) return { mode: tested, boost, problem: AWAY };
  // (With the boost, a frame has the time the boost's frames have: at 60 fps, 16.7 ms, whatever the video's own rate.)
  const fps = boost ? boostTarget() || boost.fps : (played?.fps ?? 30);
  return { mode: tested, boost, rife, timing: measured, gettingReady, played, verdict: verdict(measured, fps, played ? played.drawn / played.expected : undefined) };
}

const VERDICT_WORDS: Record<Verdict, string> = { smooth: "Smooth", tight: "Tight", slow: "Too slow" };

function showResults(): void {
  const body = element("results-body");
  const order = (result: Result): number => MODES.findIndex((entry) => entry.mode === result.mode) * 1000 + (result.boost?.fps ?? 0) + (result.boost?.how === "blend" ? 1 : 0);
  const motionText = (scale: number | undefined): string =>
    scale === undefined || scale >= 1 ? "" : `, motion at ${({ 0.75: "3/4", 0.5: "1/2", 0.33: "1/3", 0.25: "1/4" } as Record<number, string>)[scale] ?? `${Math.round(scale * 100)}%`}`;
  const boostText = (result: Result): string => (result.boost ? ` + ${result.boost.fps} fps (${howName(result.boost.how)}${motionText(result.boost.motion)})` : "");
  body.replaceChildren(
    ...[...results.values()].sort((a, b) => order(a) - order(b)).map((result) => {
      const each = result.mode;
      const name = `${nameOf(each)}${boostText(result)}`;
      const row = document.createElement("tr");
      const boostId = result.boost ? `-${result.boost.fps}-${result.boost.how}${result.boost.motion ? `-${result.boost.motion}` : ""}` : "";
      row.dataset.testid = `upscale-result-${each}${boostId}`;
      const cell = (text: string, className = ""): HTMLTableCellElement => {
        const td = document.createElement("td");
        td.textContent = text;
        if (className) td.className = className;
        row.append(td);
        return td;
      };
      const head = document.createElement("th");
      head.scope = "row";
      head.textContent = name;
      row.append(head);
      if (result.problem) {
        cell(result.problem, "problem").colSpan = 3;
        return row;
      }
      const time = result.timing!;
      const played = result.played;
      const ready = result.gettingReady ?? 0;
      cell(`${ms(time.median)} (9 in 10 under ${ms(time.p90)})${ready >= 250 ? `; ${(ready / 1000).toFixed(1)} s to get ready, once` : ""}`);
      cell(
        played
          ? played.screenHz !== undefined
            ? `${Math.min(played.drawn, played.expected)} of ${played.expected} frames shown in time, at ${played.fps.toFixed(1)} new frames a second (screen: ${Math.round(played.screenHz)} Hz)${played.dropped ? `; the browser dropped ${played.dropped} of the video's own` : ""}${result.rife && result.rife.ms > 0 ? `; RIFE: ${ms(result.rife.ms)} a frame, ${result.rife.needs} a second needed (${ms(1000 / Math.max(1, result.rife.needs))} each)` : ""}`
            : `${Math.min(played.drawn, played.expected)} of ${played.expected} frames drawn${played.dropped ? `, ${played.dropped} dropped` : ""}, at ${played.fps.toFixed(played.fps % 1 ? 2 : 0)} fps (${ms(1000 / played.fps)} a frame)`
          : time.median >= 1000
            ? "not played: too slow to try"
            : "not played (the video did not start)",
      );
      const word = cell(VERDICT_WORDS[result.verdict!], `verdict ${result.verdict!}`);
      word.dataset.testid = `upscale-verdict-${each}${boostId}`;
      return row;
    }),
  );
  element("results").hidden = results.size === 0;
  // (The summary is for the frame boost chosen now: the modes tested with it, or without one.)
  const now = boostNow();
  const tested = MODES.map(({ mode: each }) => results.get(now ? `${each} ${boostKey(now)}` : each)).filter((result): result is Result => Boolean(result?.verdict));
  const height = `${Number(targetSelect.value)}p${now ? ` with ${boostName()}` : ""}`;
  // For each group, the heaviest mode that keeps up with room to spare (each group's modes are listed lightest first), and a heavier one that keeps
  // up barely.
  const line = (group: Group, label: string): string => {
    const ran = tested.filter((result) => MODES.find((entry) => entry.mode === result.mode)?.group === group);
    if (ran.length === 0) return "";
    const order = (result: Result): number => MODES.findIndex((entry) => entry.mode === result.mode);
    const smooth = ran.filter((result) => result.verdict === "smooth").at(-1);
    const tight = ran.filter((result) => result.verdict === "tight" && (!smooth || order(result) > order(smooth))).at(-1);
    if (smooth) return `${label}, ${nameOf(smooth.mode)} runs with room to spare${tight ? ` (${nameOf(tight.mode)} keeps up, barely)` : ""}`;
    if (tight) return `${label}, ${nameOf(tight.mode)} keeps up, barely: a busier scene or a 60 fps video could stutter`;
    return `${label}, none of the modes keeps up`;
  };
  const lines = [line("any", "for any video"), line("drawn", "for cartoons and anime")].filter(Boolean);
  element("summary").textContent = tested.length < 2 || lines.length === 0 ? "" : `On this computer at ${height}: ${lines.join("; ")}.`;
}

async function runTests(modes: readonly Mode[]): Promise<void> {
  if (testing || !hasFrame()) return;
  testing = true;
  stopAsked = false;
  wentAway = document.visibilityState === "hidden";
  testOne.disabled = testAll.disabled = true;
  testStop.hidden = false;
  drawModes();
  const at = video.currentTime;
  try {
    for (const each of modes) {
      if (stopAsked) break;
      results.set(resultKey(each), await speedTest(each));
      showResults();
      video.currentTime = at; // (every mode is tested on the same frames)
      await new Promise((done) => video.addEventListener("seeked", done, { once: true }));
    }
    say(stopAsked ? "Stopped." : wentAway ? AWAY : "Done.");
  } finally {
    testing = false;
    testOne.disabled = testAll.disabled = false;
    testStop.hidden = true;
    showCanvasFor(mode);
    drawModes();
    render();
  }
}

testOne.addEventListener("click", () => void runTests([mode]));
testAll.addEventListener("click", () => {
  const here = MODES.map(({ mode: each }) => each).filter((each) => (isAnime(each) ? Boolean(adapter) : isFilm(each) ? Boolean(gl) && !gl!.filmProblem() : Boolean(gl)));
  void runTests(here);
});
testStop.addEventListener("click", () => {
  stopAsked = true;
});

// ---------------------------------------------------------------- start

startWebGl();
drawModes();
const webGpuFound = findWebGpu();
{
  const ratio = window.devicePixelRatio || 1;
  element("device-screen").textContent = `${Math.round(screen.width * ratio)} × ${Math.round(screen.height * ratio)} pixels (a picture drawn bigger than this is shrunk to fit it)`;
}
if (frameCallbacks) video.requestVideoFrameCallback(onVideoFrame);
else requestAnimationFrame(onAnimationFrame);
requestAnimationFrame(onBoostRefresh);
if (!gl) boostSelect.disabled = true;
// (RIFE runs on WebGPU: on the processor it takes seconds a frame. Blend runs on any WebGL 2.)
void webGpuFound.then(() => {
  if (adapter) return;
  const rifeOption = boostHowSelect.querySelector<HTMLOptionElement>('option[value="rife"]')!;
  rifeOption.disabled = true;
  rifeOption.textContent += ` (not here: ${gpuProblem || "WebGPU is not available"})`;
  if (boostHowSelect.value === "rife") {
    boostHowSelect.value = "blend";
    restartBoost();
  }
});

/**
 * For the page's own tests (e2e/upscale-lab.spec.ts) and for a look by hand: draws the frame shown now with `probed` and compares what was drawn with the
 * browser's own drawing of the same frame at the same size. A picture that is right differs little from it (sharper edges only); one upside down, too
 * dark or garbled differs a lot.
 */
async function probe(
  probed: Mode = mode,
): Promise<
  { mode: Mode; network?: { width: number; height: number }; width: number; height: number; difference: number; brightness: number; detail: number; checksum: number } | { problem: string }
> {
  const why = await ready(probed);
  if (why) return { problem: why };
  if (!hasFrame()) return { problem: "No frame to draw yet" };
  const out = outSize();
  const canvas = document.createElement("canvas");
  canvas.width = out.width;
  canvas.height = out.height;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(video, 0, 0, out.width, out.height);
  const reference = context.getImageData(0, 0, out.width, out.height).data;
  timing = true;
  try {
    drawNow(probed);
    context.drawImage(isAnime(probed) ? gpuCanvas : glCanvas, 0, 0); // (in the same task as the drawing: the canvas still holds it)
  } finally {
    timing = false;
  }
  const drawn = context.getImageData(0, 0, out.width, out.height).data;
  let difference = 0;
  let brightness = 0;
  let count = 0;
  // Detail: how much each pixel differs from the one on its right, against the same in the browser's drawing (above 1 = crisper than it).
  let edges = 0;
  let referenceEdges = 0;
  let checksum = 0;
  const step = 4 * 7; // (every 7th pixel is plenty)
  for (let index = 0; index + 4 < drawn.length; index += step) {
    for (let channel = 0; channel < 3; channel++) {
      difference += Math.abs(drawn[index + channel]! - reference[index + channel]!);
      brightness += drawn[index + channel]!;
      edges += Math.abs(drawn[index + channel]! - drawn[index + 4 + channel]!);
      referenceEdges += Math.abs(reference[index + channel]! - reference[index + 4 + channel]!);
      checksum = (checksum * 31 + drawn[index + channel]!) % 1_000_000_007;
    }
    count += 3;
  }
  const network = isAnime(probed) ? gpu?.networkSize() : undefined;
  showCanvasFor(mode);
  render();
  return {
    mode: probed,
    ...(network ? { network } : {}),
    width: out.width,
    height: out.height,
    difference: difference / count,
    brightness: brightness / count,
    detail: edges / Math.max(1, referenceEdges),
    checksum,
  };
}

/** For a look by hand: a part of the frame shown now as `shot` draws it, as a PNG (data: address), pixel for pixel. */
async function snapshot(shot: Mode = mode, region?: { x: number; y: number; width: number; height: number }): Promise<string> {
  const why = await ready(shot);
  if (why) return why;
  const out = outSize();
  const part = region ?? { x: 0, y: 0, ...out };
  const canvas = document.createElement("canvas");
  canvas.width = part.width;
  canvas.height = part.height;
  timing = true;
  try {
    drawNow(shot);
    canvas.getContext("2d")!.drawImage(isAnime(shot) ? gpuCanvas : glCanvas, part.x, part.y, part.width, part.height, 0, 0, part.width, part.height);
  } finally {
    timing = false;
  }
  showCanvasFor(mode);
  render();
  return canvas.toDataURL("image/png");
}

/**
 * For the page's own tests and the known-answer check by hand: the frame the boost makes `t` of the way from picture `first` to picture `second`
 * (addresses of two pictures of one size), by `how`, as a PNG (data: address). Uses a boost of its own: the playing video's is left alone.
 */
async function interpolate(first: string, second: string, t: number, how: BoostHow = "rife", motion?: number): Promise<string> {
  if (!gl) return glProblem || "WebGL 2 is not available";
  const pictures = await Promise.all(
    [first, second].map(async (address) => createImageBitmap(await (await fetch(address)).blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" })),
  );
  const size = { width: pictures[0]!.width, height: pictures[0]!.height };
  if (pictures[1]!.width !== size.width || pictures[1]!.height !== size.height) return "The two pictures are not of one size";
  const spare = gl.spareBoost();
  timing = true;
  try {
    const made = await madeFrame(spare, pictures, size, t, how, motion);
    gl.drawFrom(made().texture, size, "off", size);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    canvas.getContext("2d")!.drawImage(glCanvas, 0, 0); // (in the same task as the drawing: the canvas still holds it)
    return canvas.toDataURL("image/png");
  } catch (error) {
    return problemText(error);
  } finally {
    timing = false;
    spare.dispose();
    for (const picture of pictures) picture.close();
    render();
  }
}

// ---------------------------------------------------------------- RIFE (rife.ts): an existing network that makes the frame between two

/** The network file, served by the site (public/labs/upscale/rife/, with its licence, source and sha256 in the README there). */
const RIFE_FILE = "/labs/upscale/rife/rife-v4.25-lite.onnx";
let rifeNetwork: Promise<Rife> | undefined;
const loadRife = (): Promise<Rife> => {
  rifeNetwork ??= Rife.load(RIFE_FILE).catch((error: unknown) => {
    rifeNetwork = undefined;
    throw error;
  });
  return rifeNetwork;
};

/**
 * RIFE cut before its last step (the same network and weights, its answer the motion and the mask: see the README there), for the live boost: its frames
 * are warped here at the full size (frameBoost.ts `warp`), so the motion can be found on smaller pictures.
 */
const RIFE_MOTION_FILE = "/labs/upscale/rife/rife-v4.25-lite-motion.onnx";
/** The size RIFE's sizes must divide by. */
const RIFE_STEP = 64;
let rifeMotionNetwork: Promise<Rife> | undefined;
const loadRifeMotion = (): Promise<Rife> => {
  rifeMotionNetwork ??= Rife.load(RIFE_MOTION_FILE, RIFE_STEP)
    .then((network) => {
      if (!network.givesMotion) throw new Error("The motion file is not RIFE's motion");
      return network;
    })
    .catch((error: unknown) => {
      rifeMotionNetwork = undefined;
      throw error;
    });
  return rifeMotionNetwork;
};

/** RIFE ready for the video playing: its network loaded and a first frame of the size it finds the motion at made (the browser builds its programs then, once). */
async function warmRife(): Promise<void> {
  const network = await loadRifeMotion();
  if (!hasFrame()) return;
  const picture = smallPicture(video, { width: video.videoWidth, height: video.videoHeight });
  // (A run of each number of moments it makes at a time: each is a program of its own.)
  for (let batch = 1; batch <= (network.batches ? rifeBatch(picture) : 1); batch++) {
    await network.motions(Array.from({ length: batch }, () => ({ a: picture, b: picture, t: 0.5 })));
    rifeSizes.add(`${picture.width}x${picture.height}x${batch}`);
  }
}

/** A picture's RGBA bytes (through a 2D canvas). */
function pixelsOf(picture: ImageBitmap): Picture {
  const canvas = document.createElement("canvas");
  canvas.width = picture.width;
  canvas.height = picture.height;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(picture, 0, 0);
  return { data: context.getImageData(0, 0, picture.width, picture.height).data, width: picture.width, height: picture.height };
}

/**
 * Makes the frame `t` of the way from picture 0 to picture 1 by `how` in `spare`. Gives a function that draws it there (call it in the task that uses it).
 * With `motion` (RIFE only): as the live boost makes it, the motion found by the cut network on pictures that much smaller and the frame warped here
 * (1: at the full size, which must give the stock network's own frame).
 */
async function madeFrame(spare: FrameBoost, pictures: ImageBitmap[], size: Size, t: number, how: BoostHow, motion?: number): Promise<() => { texture: WebGLTexture; size: Size }> {
  if (how === "blend") {
    const a = spare.push(pictures[0]!, size);
    const b = spare.push(pictures[1]!, size);
    return () => spare.draw(a, b, t);
  }
  if (motion !== undefined) {
    const network = await loadRifeMotion();
    const a = spare.push(pictures[0]!, size);
    const b = spare.push(pictures[1]!, size);
    if (t <= 0 || t >= 1) return () => spare.draw(a, b, t);
    const small = { width: Math.max(8, Math.round(size.width * motion)), height: Math.max(8, Math.round(size.height * motion)) };
    const started = performance.now();
    const found = await network.motion(pictureAt(pictures[0]!, small), pictureAt(pictures[1]!, small), t);
    lastRifeMs = performance.now() - started;
    lastRifeTimes = { ...network.times };
    return () => spare.warp(a, b, found);
  }
  const network = await loadRife();
  const started = performance.now();
  const made = t <= 0 ? pixelsOf(pictures[0]!).data : t >= 1 ? pixelsOf(pictures[1]!).data : await network.make(pixelsOf(pictures[0]!), pixelsOf(pictures[1]!), t);
  lastRifeMs = performance.now() - started;
  lastRifeTimes = { ...network.times };
  return () => spare.upload(new ImageData(made, size.width, size.height), size);
}
/** How long RIFE took for the last frame it made by hand (ms, its pictures in and out included), and where the time went. */
let lastRifeMs = 0;
let lastRifeTimes = {};

/**
 * For making a boosted video by hand (frame by frame, nothing dropped): as `interpolate`, then drawn by `shot` at the target (the size the loaded video gets),
 * as a PNG (data: address). The two pictures must be of the loaded video's size.
 */
async function boosted(first: string, second: string, t: number, how: BoostHow = "rife", shot: Mode = mode): Promise<string> {
  if (!gl) return glProblem || "WebGL 2 is not available";
  const why = await ready(shot);
  if (why) return why;
  const pictures = await Promise.all(
    [first, second].map(async (address) => createImageBitmap(await (await fetch(address)).blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" })),
  );
  const size = { width: pictures[0]!.width, height: pictures[0]!.height };
  const spare = gl.spareBoost();
  const out = outSize();
  timing = true;
  try {
    const made = await madeFrame(spare, pictures, size, t, how);
    drawPicture(made(), shot);
    const canvas = document.createElement("canvas");
    canvas.width = out.width;
    canvas.height = out.height;
    canvas.getContext("2d")!.drawImage(isAnime(shot) ? gpuCanvas : glCanvas, 0, 0, out.width, out.height, 0, 0, out.width, out.height); // (same task)
    return canvas.toDataURL("image/png");
  } catch (error) {
    return problemText(error);
  } finally {
    timing = false;
    spare.dispose();
    for (const picture of pictures) picture.close();
    render();
  }
}

/** The frame boost's state now, for a look by hand. */
const boost = (): object => ({
  on: boostOn(),
  fps: boostFps(),
  how: boostHow(),
  hz: screenHz(),
  frameTime: videoClock.frameTime(),
  shownLastSecond: shownTimes.length,
  lastPhase,
  rifeMs: rifeMs(),
  rifeJobs: rifeJobs.length,
  motionScale: motionScale(),
  rifeRunMs: median(rifeRunTimes),
  rifeLastBatch,
  misses: { ...misses },
  counted: { frames: counted.boostFrames, onTime: counted.boostOnTime },
  lastRifeMs,
  lastRifeTimes,
});

(window as Window & { kinoUpscaleLab?: unknown }).kinoUpscaleLab = { probe, snapshot, interpolate, boosted, boost, results };
