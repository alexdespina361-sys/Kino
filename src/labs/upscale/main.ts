import "./style.css";
import { GlUpscaler, type GlMode } from "./glUpscaler";
import { GpuUpscaler, webgpuAdapter, type AnimeMode } from "./gpuUpscaler";
import { frameRate, ms, summarize, targetSize, verdict, type Timing, type Verdict } from "./measure";

/**
 * The upscaler test page (labs/upscale/index.html): plays a video file picked on this computer, draws it bigger with one of four modes, and times each.
 * Nothing leaves the computer: the file is played from a blob: address, and the page asks the server for nothing but its own code.
 */

type Mode = GlMode | AnimeMode;

const MODES: readonly { mode: Mode; name: string; about: string }[] = [
  { mode: "off", name: "Off", about: "Plain scaling, the way the browser draws a video now." },
  { mode: "sharp", name: "Sharp (FSR 1)", about: "AMD FSR 1: finds the edges and keeps them crisp, then sharpens. Any video, most graphics chips." },
  { mode: "anime-fast", name: "Anime (fast)", about: "Anime4K CNNx2M: a small neural network made for drawn pictures (cartoons, anime). Needs WebGPU." },
  { mode: "anime-quality", name: "Anime (quality)", about: "Anime4K CNNx2VL: a bigger network, cleaner lines, a lot more work. Needs WebGPU." },
];
const nameOf = (mode: Mode): string => MODES.find((entry) => entry.mode === mode)?.name ?? mode;
const isAnime = (mode: Mode): mode is AnimeMode => mode === "anime-fast" || mode === "anime-quality";

/** Frames drawn and waited for in a speed test (the first ones only warm up). */
const WARM_UP = 5;
const TIMED = 40;
/** How long a speed test plays the video for (`?seconds=2` makes it shorter, for the page's own tests). */
const PLAY_SECONDS = Math.min(30, Math.max(1, Number(new URLSearchParams(location.search).get("seconds")) || 8));

const element = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`The page has no #${id}`);
  return found as T;
};
const video = element<HTMLVideoElement>("video");
const glCanvas = element<HTMLCanvasElement>("gl-canvas");
const gpuCanvas = element<HTMLCanvasElement>("gpu-canvas");
const stage = element<HTMLDivElement>("stage");
const status = element<HTMLParagraphElement>("status");
const playButton = element<HTMLButtonElement>("play");
const seek = element<HTMLInputElement>("seek");
const targetSelect = element<HTMLSelectElement>("target");
const viewSelect = element<HTMLSelectElement>("view");
const testOne = element<HTMLButtonElement>("test-one");
const testAll = element<HTMLButtonElement>("test-all");
const testStop = element<HTMLButtonElement>("test-stop");

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

/** Whether `wanted` can draw here now; why not, if it cannot. */
async function ready(wanted: Mode): Promise<string> {
  if (!isAnime(wanted)) return gl ? "" : glProblem || "WebGL 2 is not available";
  if (!adapter) return gpuProblem || "WebGPU is not available";
  return (await startGpu()) ? "" : gpuProblem;
}

function drawModes(): void {
  const box = element("modes");
  box.replaceChildren(
    ...MODES.map(({ mode: each, name, about }) => {
      const why = isAnime(each) ? (adapter ? "" : gpuProblem) : gl ? "" : glProblem;
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

/** The frames counted while a speed test plays the video (by the loop below). */
const counted = { on: false, drawn: 0, firstPresented: -1, lastPresented: -1, mediaTimes: [] as number[] };

function onVideoFrame(_now: number, frame: VideoFrameCallbackMetadata): void {
  render();
  if (counted.on && !timing) {
    if (counted.firstPresented < 0) counted.firstPresented = frame.presentedFrames;
    else counted.drawn++;
    counted.lastPresented = frame.presentedFrames;
    counted.mediaTimes.push(frame.mediaTime);
  }
  video.requestVideoFrameCallback(onVideoFrame);
}

/** (For a browser without requestVideoFrameCallback: draws on every animation frame while the video plays.) */
let lastTime = -1;
function onAnimationFrame(): void {
  if (!video.paused && video.currentTime !== lastTime) {
    lastTime = video.currentTime;
    render();
    if (counted.on && !timing) counted.drawn++;
  }
  requestAnimationFrame(onAnimationFrame);
}
const frameCallbacks = typeof video.requestVideoFrameCallback === "function";

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
  if (isAnime(mode)) parts.push(`Anime makes it ${video.videoWidth * 2} × ${video.videoHeight * 2} first, then fits that to ${out.width} × ${out.height}.`);
  element("size-info").textContent = parts.join(" ");
  fitStage();
}

function fitStage(): void {
  const out = outSize();
  if (!(out.width > 0)) return;
  stage.style.aspectRatio = `${out.width} / ${out.height}`;
  const view = viewSelect.value;
  const pixels = out.width / (window.devicePixelRatio || 1);
  stage.style.width = view === "actual" ? `${pixels}px` : view === "zoom" ? `${pixels * 2}px` : "100%";
  stage.classList.toggle("pixelated", view === "zoom");
}

function open(file: File | undefined): void {
  if (!file) return;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);
  element("file-name").textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB, on this computer)`;
  element("viewer").hidden = false;
  element("tests").hidden = false;
  say("Opening...");
  video.src = objectUrl;
  video.load();
}

video.addEventListener("loadedmetadata", () => {
  describeSize();
  say("");
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
element<HTMLInputElement>("compare").addEventListener("input", (event) => {
  stage.style.setProperty("--split", `${(event.target as HTMLInputElement).value}%`);
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
}
interface Result {
  mode: Mode;
  timing?: Timing;
  played?: Played;
  verdict?: Verdict;
  problem?: string;
}

const results = new Map<Mode, Result>();

/** Plays the video for a few seconds and counts the frames the mode drew of those the video showed (and the browser dropped). */
async function playThrough(): Promise<Played | undefined> {
  const before = video.getVideoPlaybackQuality?.();
  Object.assign(counted, { on: true, drawn: 0, firstPresented: -1, lastPresented: -1, mediaTimes: [] });
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
  // (A browser that showed the page no frames at all, as one does for a page it is not drawing, gives nothing to count: not "none kept up".)
  if (counted.mediaTimes.length < 3 && counted.drawn < 3) return undefined;
  const shown = frameCallbacks ? Math.max(0, counted.lastPresented - counted.firstPresented) : Math.round(PLAY_SECONDS * frameRate(counted.mediaTimes));
  return { drawn: counted.drawn, expected: Math.max(1, shown + dropped), dropped, fps: frameRate(counted.mediaTimes) };
}

/** Whether the page went to the background during a test: it then draws slower and shows no frames, so what was measured says nothing. */
let wentAway = false;
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && testing) wentAway = true;
});
const AWAY = "The page was in the background during the test, which slows it down: test again with this page in front.";

async function speedTest(tested: Mode): Promise<Result> {
  const why = await ready(tested);
  if (why) return { mode: tested, problem: why };
  video.pause();
  showCanvasFor(tested);
  const samples: number[] = [];
  timing = true;
  try {
    for (let index = 0; index < WARM_UP + TIMED && !stopAsked; index++) {
      const start = performance.now();
      drawNow(tested);
      await finishNow(tested);
      const took = performance.now() - start;
      if (index >= WARM_UP) samples.push(took);
      say(`${nameOf(tested)}: frame ${index + 1} of ${WARM_UP + TIMED} took ${ms(took)}`);
      if (took > 2000) break; // (it would take minutes: this is enough to tell)
      await nextFrame();
    }
  } catch (error) {
    return { mode: tested, problem: problemText(error) };
  } finally {
    timing = false;
  }
  const measured = summarize(samples);
  if (stopAsked) return { mode: tested, problem: "Stopped" };
  let played: Played | undefined;
  if (measured.samples > 0 && measured.median < 1000) {
    const was = mode;
    mode = tested; // (the playing loop draws with the mode under test)
    say(`${nameOf(tested)}: playing for ${PLAY_SECONDS} seconds and counting the frames...`);
    played = await playThrough();
    mode = was;
    showCanvasFor(mode);
    render();
  }
  if (wentAway) return { mode: tested, problem: AWAY };
  const fps = played?.fps ?? 30;
  return { mode: tested, timing: measured, played, verdict: verdict(measured, fps, played ? played.drawn / played.expected : undefined) };
}

const VERDICT_WORDS: Record<Verdict, string> = { smooth: "Smooth", tight: "Tight", slow: "Too slow" };

function showResults(): void {
  const body = element("results-body");
  body.replaceChildren(
    ...MODES.filter(({ mode: each }) => results.has(each)).map(({ mode: each, name }) => {
      const result = results.get(each)!;
      const row = document.createElement("tr");
      row.dataset.testid = `upscale-result-${each}`;
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
      cell(`${ms(time.median)} (9 in 10 under ${ms(time.p90)})`);
      cell(
        played
          ? `${Math.min(played.drawn, played.expected)} of ${played.expected} frames drawn${played.dropped ? `, ${played.dropped} dropped` : ""}, at ${played.fps.toFixed(played.fps % 1 ? 2 : 0)} fps (${ms(1000 / played.fps)} a frame)`
          : time.median >= 1000
            ? "not played: too slow to try"
            : "not counted: the browser showed no frames (judged on the time alone)",
      );
      const word = cell(VERDICT_WORDS[result.verdict!], `verdict ${result.verdict!}`);
      word.dataset.testid = `upscale-verdict-${each}`;
      return row;
    }),
  );
  element("results").hidden = results.size === 0;
  // The best mode that keeps up: the order of MODES is the order of quality.
  const tested = MODES.map(({ mode: each }) => results.get(each)).filter((result): result is Result => Boolean(result?.verdict));
  const best = (wanted: Verdict): Result | undefined => [...tested].reverse().find((result) => result.verdict === wanted && result.mode !== "off");
  const smooth = best("smooth");
  const tight = best("tight");
  const height = `${Number(targetSelect.value)}p`;
  element("summary").textContent =
    tested.length < 2
      ? ""
      : smooth
        ? `On this computer, ${nameOf(smooth.mode)} draws this video at ${height} with room to spare.${tight && MODES.findIndex((entry) => entry.mode === tight.mode) > MODES.findIndex((entry) => entry.mode === smooth.mode) ? ` ${nameOf(tight.mode)} keeps up too, barely.` : ""}`
        : tight
          ? `On this computer, ${nameOf(tight.mode)} keeps up at ${height}, barely: a busier scene or a 60 fps video could stutter.`
          : `On this computer, none of the modes keeps up at ${height}: it is best left Off here${height === "1080p" ? " (720p may do)" : ""}.`;
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
      results.set(each, await speedTest(each));
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
  const here = MODES.map(({ mode: each }) => each).filter((each) => (isAnime(each) ? Boolean(adapter) : Boolean(gl)));
  void runTests(here);
});
testStop.addEventListener("click", () => {
  stopAsked = true;
});

// ---------------------------------------------------------------- start

startWebGl();
drawModes();
void findWebGpu();
if (frameCallbacks) video.requestVideoFrameCallback(onVideoFrame);
else requestAnimationFrame(onAnimationFrame);

/**
 * For the page's own tests (e2e/upscale-lab.spec.ts) and for a look by hand: draws the frame shown now with `probed` and compares what was drawn with the
 * browser's own drawing of the same frame at the same size. A picture that is right differs little from it (sharper edges only); one upside down, too
 * dark or garbled differs a lot.
 */
async function probe(
  probed: Mode = mode,
): Promise<{ mode: Mode; width: number; height: number; difference: number; brightness: number; detail: number; checksum: number } | { problem: string }> {
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
  showCanvasFor(mode);
  render();
  return {
    mode: probed,
    width: out.width,
    height: out.height,
    difference: difference / count,
    brightness: brightness / count,
    detail: edges / Math.max(1, referenceEdges),
    checksum,
  };
}

(window as Window & { kinoUpscaleLab?: unknown }).kinoUpscaleLab = { probe, results };
