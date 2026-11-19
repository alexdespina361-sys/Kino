import type Hls from "hls.js";
import {
  IDLE_STATE,
  type OfficialOfferLine,
  type PlayerQualityLevel,
  type PlayerState,
  type PlayerTrack,
  type StreamType,
  type SubtitleSyncMode,
  type SubtitleTrack,
  reachedEnd,
  trackLabel, OFFICIAL_PATH
} from "../../shared";
import { reloadForScript, scriptIsMissing } from "../shared/scriptRescue";
import { thisTier, type Tier } from "../role";
import { isHeld, markNoLanguage, release } from "../subsync/hold";
import type { SyncStatus } from "../subsync/session";
import { canCapture, ElementTap } from "../subsync/capture";
import { AudioTap, type HlsEvents, type SoundTap } from "../subsync/tap";

const KEEPALIVE_MAX = 60_000;
function offerOfficial(video: HTMLVideoElement, id: number, offer: { duration: number; lines: OfficialOfferLine[] }, last: boolean): void {
  const textTrack = video.textTracks[id];
  const element = textTrack ? Array.from(video.querySelectorAll("track")).find((each) => each.track === textTrack) : undefined;
  if (!element?.src) return;
  let track: string;
  try {
    const url = new URL(element.src);
    if (url.origin !== location.origin) return;
    track = url.pathname + url.search;
  } catch {
    return;
  }
  if (track.startsWith(OFFICIAL_PATH)) return;
  const body = JSON.stringify({ v: 1, track, duration: offer.duration, lines: offer.lines });
  void fetch("/api/official/offer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: last && body.length <= KEEPALIVE_MAX,
  }).catch(() => undefined);
}

export interface SyncFilm {
  hls?: Hls;
  video: HTMLVideoElement;
  events?: { audioSwitching: string };
  tap: SoundTap;
  live?: boolean;
  show(id: number): void;
  report(status: SyncStatus, moved?: number): void;
  delay?: () => number;
  light?: () => boolean;
  offer?: (id: number, offer: { duration: number; lines: OfficialOfferLine[] }, last: boolean) => void;
}
export interface SyncHandle {
  close(restore?: boolean): void;
}
export type SyncStarter = (film: SyncFilm) => SyncHandle | undefined;

export const PlayerError = {
  NotDirectlyPlayable: "SOURCE_NOT_DIRECTLY_PLAYABLE",
  HlsUnsupported: "HLS_UNSUPPORTED",
  Blocked: "PLAYBACK_BLOCKED",
  ConnectionLost: "CONNECTION_LOST",
  SourceUnavailable: "SOURCE_UNAVAILABLE",
} as const;

export function lostTheConnection(data: { type?: string; details?: string; response?: { code?: number } }): boolean {
  if (data.type !== "networkError") return false;
  if (data.details?.endsWith("TimeOut")) return true;
  const code = data.response?.code;
  return code === undefined || code < 100;
}

export function sourceSaidNo(data: { type?: string; details?: string; response?: { code?: number } }): boolean {
  return data.type === "networkError" && (data.response?.code ?? 0) >= 400 && !lostTheConnection(data);
}

function whereIs(raw: string | undefined): string {
  if (!raw) return "";
  const file = (address: URL) => address.pathname.split("/").filter(Boolean).pop() ?? "";
  try {
    const address = new URL(raw, typeof location === "undefined" ? undefined : location.href);
    const behind = address.searchParams.get("url");
    let real: URL | undefined;
    if (behind) {
      try {
        real = new URL(behind);
      } catch {
      }
    }
    return real ? `${address.host} → ${real.host} ${file(real)}`.trim() : `${address.host} ${file(address)}`.trim();
  } catch {
    return "";
  }
}

export function describeHlsError(data: { type?: string; details?: string; fatal?: boolean; url?: string; response?: { code?: number } }): string {
  const code = data.response?.code;
  const answer = code ? `HTTP ${code}` : data.type === "networkError" ? "no answer" : "";
  const where = whereIs(data.url);
  return `[HLS] ${data.details ?? data.type ?? "error"}${data.fatal ? " (fatal)" : ""}${answer || where ? ":" : ""}${answer ? ` ${answer}` : ""}${where ? ` from ${where}` : ""}`;
}

export const PARTY_BUFFER_AHEAD_S = 40;
export const PARTY_BUFFER_BYTES = 32 * 1024 * 1024;
export const LONE_PROXY_BUFFER_AHEAD_S = 90;
export const LONE_PROXY_BUFFER_BYTES = 48 * 1024 * 1024;

export const LITE_BUFFER = { maxBufferLength: 30, maxMaxBufferLength: 60, maxBufferSize: 32 * 1024 * 1024 } as const;
export const BACK_BUFFER_S: Record<Tier, number> = { full: 90, lite: 30 };

export const DELAY_REACH_S = 12;

export function bufferPolicy(inParty: boolean, isProxied = false, tier: Tier = "full", subtitleDelay = 0): { maxBufferLength: number; maxMaxBufferLength: number; maxBufferSize: number; backBufferLength: number } {
  const base = inParty
    ? { maxBufferLength: 10, maxMaxBufferLength: PARTY_BUFFER_AHEAD_S, maxBufferSize: PARTY_BUFFER_BYTES }
    : isProxied
      ? { maxBufferLength: 30, maxMaxBufferLength: LONE_PROXY_BUFFER_AHEAD_S, maxBufferSize: LONE_PROXY_BUFFER_BYTES }
      : { maxBufferLength: 120, maxMaxBufferLength: 600, maxBufferSize: 128 * 1024 * 1024 };
  const capped =
    tier === "lite"
      ? { maxBufferLength: Math.min(base.maxBufferLength, LITE_BUFFER.maxBufferLength), maxMaxBufferLength: Math.min(base.maxMaxBufferLength, LITE_BUFFER.maxMaxBufferLength), maxBufferSize: Math.min(base.maxBufferSize, LITE_BUFFER.maxBufferSize) }
      : base;
  const reach = Math.abs(subtitleDelay) + DELAY_REACH_S;
  return {
    ...capped,
    ...(subtitleDelay < 0 ? { maxBufferLength: Math.max(capped.maxBufferLength, reach), maxMaxBufferLength: Math.max(capped.maxMaxBufferLength, reach) } : {}),
    backBufferLength: subtitleDelay > 0 ? Math.max(BACK_BUFFER_S[tier], reach) : BACK_BUFFER_S[tier],
  };
}

let warmed = false;
export function warmPlayer(): void {
  if (warmed || (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
  warmed = true;
  const fetchIt = () => void import("hls.js").catch(() => (warmed = false));
  if (typeof requestIdleCallback === "function") requestIdleCallback(fetchIt, { timeout: 3000 });
  else setTimeout(fetchIt, 1500);
}

export const DIRECT_START_MS = 12_000;

export const LOW_FIRST_MAX_S = 6;
export const LOW_FIRST_SLACK_S = 0.3;
export const LOW_FIRST_LABEL = "480p";

export function lowFirstLevel(
  levels: ReadonlyArray<{ width?: number; height?: number; bitrate?: number; codecSet?: string; videoRange?: string }>,
  highest: number,
): number {
  const top = levels[highest];
  const topLabel = top ? formatQualityLabel(top.width, top.height) : "";
  if (!top || !(topLabel === "720p" || isHighDefinition(top.width, top.height))) return -1;
  let low = -1;
  levels.forEach((level, index) => {
    if (formatQualityLabel(level.width, level.height) !== LOW_FIRST_LABEL) return;
    if (level.codecSet !== top.codecSet || level.videoRange !== top.videoRange) return;
    const best = low === -1 ? undefined : levels[low]!;
    if (!best || (level.height ?? 0) > (best.height ?? 0) || ((level.height ?? 0) === (best.height ?? 0) && (level.bitrate ?? 0) > (best.bitrate ?? 0))) low = index;
  });
  return low;
}

const LEAVE_THIS_QUALITY = 2;

export const QUALITY_GIVE_UPS = 3;

const isHighDefinition = (width = 0, height = 0): boolean => width >= 1800 || height >= 800;

export function readableFrom(src: string, here = location.href): "same-origin" | "cors" | undefined {
  try {
    const url = new URL(src, here);
    if (url.origin === new URL(here).origin) return "same-origin";
    return url.pathname === "/api/proxy" && url.searchParams.has("url") && url.searchParams.has("sig") ? "cors" : undefined;
  } catch {
    return undefined;
  }
}

function throughOurProxy(src: string): boolean {
  try {
    return new URL(src, location.href).pathname === "/api/proxy";
  } catch {
    return false;
  }
}

function usesWebsiteProxy(src: string): boolean {
  const url = new URL(src, location.href);
  return url.origin === new URL(location.href).origin && url.pathname === "/api/proxy";
}

export function proxiedQualityCap(levels: ReadonlyArray<{ width?: number; height?: number }>): number {
  if (levels.length <= 1) return -1;
  let cap = -1;
  levels.forEach((level, index) => {
    if (!isHighDefinition(level.width, level.height)) cap = index;
  });
  if (cap === -1) return 0;
  return cap === levels.length - 1 ? -1 : cap;
}

export function formatQualityLabel(width?: number, height?: number, name?: string): string {
  const w = width || 0;
  const h = height || 0;
  if (w >= 3800 || h >= 1600) return "4K (2160p)";
  if (w >= 2500 || h >= 1300) return "2K (1440p)";
  if (w >= 1800 || h >= 800) return "1080p";
  if (w >= 1200 || h >= 530) return "720p";
  if (w >= 800 || h >= 400) return "480p";
  if (w >= 600 || h >= 300) return "360p";
  if (h > 0) return `${h}p`;
  if (name) return name;
  return "SD";
}

export interface StartupNote {
  resumed?: boolean;
  manifestMs?: number;
  pieceMs?: number;
  pieceS?: number;
  pieceKB?: number;
  height?: number;
  metadataMs?: number;
}

export class PlayerEngine {
  private hls: Hls | null = null;
  private hasSource = false;
  private loading = false;
  private pendingPlay = false;
  private errorCode: string | undefined;
  private errorDetail: string | undefined;
  private startAt: number | undefined;
  private hlsStartAt: number | undefined;
  private requestedStart: number | undefined;
  private generation = 0;
  private boostedFrom: number | null = null;
  private inParty = false;
  private adaptive = true;
  private lastEmitted = "";
  private nativeFallbackSrc?: string;
  private directTimer?: ReturnType<typeof setTimeout>;
  private readonly ticker: ReturnType<typeof setInterval>;
  private syncLoader: (() => Promise<SyncStarter>) | undefined;
  private syncDelay: (() => number) | undefined;
  private syncOn = true;
  private syncMode: SubtitleSyncMode = "full";
  private syncHandle: SyncHandle | undefined;
  private syncStatus: SyncStatus = "ready";
  private syncMoved: number | undefined;
  private tap: SoundTap | undefined;
  private audioSwitching: string | undefined;
  private corsTrial = false;
  private quietUntil = 0;
  private lowStart: { low: number; highest: number; down: boolean } | null = null;
  private startupNote: StartupNote = {};
  private loadBegan = 0;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly onChange: (state: PlayerState) => void,
    private readonly onEnded?: () => void,
  ) {
    video.setAttribute?.("referrerpolicy", "no-referrer");
    video.addEventListener("loadedmetadata", () => {
      if (this.hasSource) this.startupNote.metadataMs ??= this.sinceLoad();
      clearTimeout(this.directTimer);
      this.corsTrial = false;
      this.loading = false;
      const pastTheEnd = (at: number) => Number.isFinite(video.duration) && reachedEnd({ currentTime: at, duration: video.duration });
      if (this.startAt !== undefined) {
        const duration = Number.isFinite(video.duration) ? video.duration : this.startAt;
        video.currentTime = pastTheEnd(this.startAt) ? 0 : Math.max(0, Math.min(this.startAt, duration - 1));
        this.startAt = undefined;
      }
      if (this.hlsStartAt !== undefined) {
        if (pastTheEnd(this.hlsStartAt)) video.currentTime = 0;
        this.hlsStartAt = undefined;
      }
      if (this.pendingPlay) {
        this.pendingPlay = false;
        this.play();
      }
      this.emit();
    });
    for (const name of ["durationchange", "play", "playing", "pause", "seeking", "seeked", "waiting", "canplay", "ratechange"]) {
      video.addEventListener(name, () => this.emit());
    }
    video.addEventListener("ended", () => {
      this.emit();
      this.onEnded?.();
    });
    if (video.textTracks) {
      video.textTracks.addEventListener("change", () => this.emit());
      video.textTracks.addEventListener("addtrack", () => this.emit());
    }
    video.addEventListener("error", () => {
      if (this.hasSource) {
        if (this.useFallbackSource() || this.withoutCors()) return;
        const { code, message } = video.error ?? {};
        const refused = code === 4 && this.loading && throughOurProxy(video.currentSrc || video.src);
        this.fail(code === 2 ? PlayerError.ConnectionLost : refused ? PlayerError.SourceUnavailable : PlayerError.NotDirectlyPlayable, `MEDIA_ERR ${code ?? "?"}${message ? `: ${message}` : ""}`);
      }
    });
    this.ticker = setInterval(() => this.hasSource && this.emit(), 1000);
  }

  startup(): StartupNote {
    return { ...this.startupNote };
  }

  private sinceLoad(): number {
    return Math.max(0, Math.round(performance.now() - this.loadBegan));
  }

  async load(url: string, type: StreamType, subtitles?: SubtitleTrack[], startAt?: number, directUrl?: string): Promise<void> {
    this.teardown();
    this.loadBegan = performance.now();
    this.startupNote = startAt && startAt > 0 ? { resumed: true } : {};
    const generation = this.generation;
    this.hasSource = true;
    this.loading = true;
    this.startAt = startAt && startAt > 0 ? startAt : undefined;
    this.requestedStart = this.startAt;
    this.emit();

    const src = new URL(url, location.href).href;

    if (subtitles?.length) {
      for (const sub of subtitles) {
        const track = document.createElement("track");
        track.kind = "subtitles";
        track.label = sub.label;
        track.srclang = sub.lang || "en";
        if (!sub.lang && track.track) markNoLanguage(track.track);
        track.src = new URL(sub.url, location.href).href;
        this.video.appendChild(track);
      }
    }

    if (type === "mp4") {
      this.playFile(src, directUrl, generation);
      return;
    }

    let HlsLib: typeof Hls;
    try {
      HlsLib = (await import("hls.js")).default;
    } catch (error) {
      if (generation !== this.generation) return;
      console.warn("[hls.js]", error instanceof Error ? error.message : "could not be fetched");
      if (!(scriptIsMissing(error) && reloadForScript())) this.fail(PlayerError.ConnectionLost);
      return;
    }
    if (generation !== this.generation) return;

    if (HlsLib.isSupported()) {
      const resumeAt = this.startAt;
      this.startAt = undefined;
      this.hlsStartAt = resumeAt;
      const adaptive = this.adaptive;
      const hls = new HlsLib({
        startPosition: resumeAt ?? -1,
        capLevelToPlayerSize: false,
        ...bufferPolicy(this.inParty, usesWebsiteProxy(src), thisTier(), this.syncDelay?.() ?? 0),
        lowLatencyMode: false,
        preserveManualLevelOnError: true,
        ...(adaptive ? { startLevel: 0 } : {}),
      });
      this.hls = hls;
      hls.subtitleDisplay = false;
      let mediaRecoverAttempts = 0;
      let qualityGiveUps = 0;
      hls.on(HlsLib.Events.FRAG_LOADED, (_event, data) => {
        qualityGiveUps = 0;
        const frag = data?.frag;
        if (this.lowStart && frag?.type === "main") {
          if (this.lowStart.down && frag.level === this.lowStart.low) hls.loadLevel = this.lowStart.highest;
          this.lowStart = null;
        }
        if (this.startupNote.pieceMs === undefined && frag?.type === "main") {
          this.startupNote.pieceMs = this.sinceLoad();
          if (Number.isFinite(frag.duration)) this.startupNote.pieceS = Math.round(frag.duration * 10) / 10;
          if (frag.stats?.loaded) this.startupNote.pieceKB = Math.round(frag.stats.loaded / 1024);
          const height = hls.levels?.[frag.level]?.height;
          if (height) this.startupNote.height = height;
        }
      });
      hls.on(HlsLib.Events.ERROR, (_event, data) => {
        console.warn(describeHlsError(data), {
          type: data.type,
          details: data.details,
          fatal: data.fatal,
          url: data.url,
          response: data.response ? { code: data.response.code, text: data.response.text } : undefined,
        });
        const pictureLevel = data.frag ? (data.frag.type === "main" ? data.frag.level : undefined) : data.context?.type === "level" ? data.context.level : undefined;
        if (this.lowStart?.down && !data.fatal && pictureLevel === this.lowStart.low) {
          hls.loadLevel = this.lowStart.highest;
          this.lowStart = null;
          qualityGiveUps = 0;
          return;
        }
        if (!data.fatal && hls.manualLevel !== -1 && data.errorAction?.action === LEAVE_THIS_QUALITY && (qualityGiveUps += 1) >= QUALITY_GIVE_UPS) {
          qualityGiveUps = 0;
          this.lowStart = null;
          hls.loadLevel = -1;
          this.emit();
        }
        if (data.fatal) {
          if (data.type === HlsLib.ErrorTypes.MEDIA_ERROR && mediaRecoverAttempts < 2) {
            mediaRecoverAttempts++;
            console.log("[HLS] Recovering from media error, attempt:", mediaRecoverAttempts);
            hls.recoverMediaError();
            return;
          }

          const where = whereIs(data.url);
          console.error("[HLS FATAL ERROR]", data.type, data.details, ...(data.response?.code ? [`HTTP ${data.response.code}`] : []), ...(where ? [`from ${where}`] : []));
          this.fail(
            lostTheConnection(data) ? PlayerError.ConnectionLost : sourceSaidNo(data) ? PlayerError.SourceUnavailable : PlayerError.NotDirectlyPlayable,
            describeHlsError(data).replace(/^\[HLS\] /, ""),
          );
        }
      });

      hls.on(HlsLib.Events.LEVEL_UPDATED, (_event, data) => {
        if (!this.lowStart || this.lowStart.down || data?.level !== this.lowStart.highest) return;
        const fragments = data.details?.fragments ?? [];
        const at = resumeAt ?? 0;
        const first = fragments.find((fragment) => fragment.start + fragment.duration > at) ?? fragments[0];
        if (first && first.duration <= LOW_FIRST_MAX_S + LOW_FIRST_SLACK_S) {
          this.lowStart.down = true;
          hls.loadLevel = this.lowStart.low;
        } else this.lowStart = null;
      });

      hls.on(HlsLib.Events.MANIFEST_PARSED, (_event, data) => {
        this.startupNote.manifestMs ??= this.sinceLoad();
        if (!adaptive && data?.levels && data.levels.length > 0) {
          let highestIdx = 0;
          let maxMetric = 0;
          data.levels.forEach((lvl, idx) => {
            const metric = (lvl.height || 0) * 10000 + (lvl.bitrate || 0);
            if (metric > maxMetric) {
              maxMetric = metric;
              highestIdx = idx;
            }
          });
          hls.currentLevel = highestIdx;
          const low = lowFirstLevel(data.levels, highestIdx);
          if (low >= 0) this.lowStart = { low, highest: highestIdx, down: false };
        } else if (data?.levels && usesWebsiteProxy(hls.url ?? src)) {
          hls.autoLevelCapping = proxiedQualityCap(data.levels);
        }
        if (this.pendingPlay) {
          this.pendingPlay = false;
          this.play();
        }
        this.emit();
      });
      hls.on(HlsLib.Events.LEVEL_SWITCHED, () => this.emit());
      hls.on(HlsLib.Events.LEVEL_LOADED, () => this.emit());
      hls.on(HlsLib.Events.SUBTITLE_TRACK_SWITCH, () => this.emit());
      hls.on(HlsLib.Events.SUBTITLE_TRACKS_UPDATED, () => this.emit());
      hls.on(HlsLib.Events.AUDIO_TRACK_SWITCHED, () => this.emit());
      let audioChosen = false;
      const prefersRomanian = (): boolean => {
        if (typeof document !== "undefined" && document.documentElement.lang === "ro") return true;
        try {
          return localStorage.getItem("preferred_audio") === "ro";
        } catch {
          return false;
        }
      };
      hls.on(HlsLib.Events.AUDIO_TRACKS_UPDATED, () => {
        if (!audioChosen && hls.audioTracks && hls.audioTracks.length > 1) {
          audioChosen = true;
          const roIdx = hls.audioTracks.findIndex(
            (t) => t.lang === "ro" || t.lang === "ron" || /romanian|română|romana/i.test(t.name),
          );
          if (roIdx > 0 && hls.audioTrack <= 0 && prefersRomanian()) {
            hls.audioTrack = roIdx;
          }
        }
        this.emit();
      });

      if (this.syncLoader) {
        this.tap = new AudioTap(hls as unknown as HlsEvents, HlsLib.Events.BUFFER_APPENDING);
        this.audioSwitching = HlsLib.Events.AUDIO_TRACK_SWITCHING;
        this.attachSync(hls, generation);
      }
      hls.loadSource(src);
      hls.attachMedia(this.video);
    } else if (this.video.canPlayType("application/vnd.apple.mpegurl")) {
      this.syncStatus = "unavailable";
      this.playNatively(src, directUrl, generation);
    } else {
      this.fail(PlayerError.HlsUnsupported);
    }
  }

  private playFile(src: string, directUrl: string | undefined, generation: number): void {
    const directFirst = !!directUrl && directUrl !== src && usesWebsiteProxy(src);
    const reading = this.syncLoader && !directFirst && canCapture(this.video) ? readableFrom(src) : undefined;
    if (reading === "cors") {
      this.video.crossOrigin = "anonymous";
      this.corsTrial = true;
    }
    this.playNatively(src, directUrl, generation);
    if (!reading) {
      this.syncStatus = "unavailable";
      return;
    }
    this.tap = new ElementTap(this.video);
    this.attachSync(undefined, generation);
  }

  private withoutCors(): boolean {
    if (!this.corsTrial || this.video.readyState >= 1) return false;
    this.corsTrial = false;
    const src = this.video.src;
    this.syncHandle?.close();
    this.syncHandle = undefined;
    this.tap?.stop();
    this.tap = undefined;
    this.syncStatus = "unavailable";
    this.video.removeAttribute("crossorigin");
    console.warn("[Kino subtitle sync] The film did not start when asked for so that its sound can be read; asked for again as before, without the aligner");
    this.video.src = src;
    this.emit();
    return true;
  }

  private playNatively(src: string, directUrl: string | undefined, generation: number): void {
    if (directUrl && directUrl !== src && usesWebsiteProxy(src)) {
      this.nativeFallbackSrc = src;
      this.video.src = directUrl;
      this.watchDirectStart(generation);
    } else {
      this.video.src = src;
    }
  }

  private watchDirectStart(generation: number): void {
    clearTimeout(this.directTimer);
    this.directTimer = setTimeout(() => {
      if (generation === this.generation && this.video.readyState < 1) this.useFallbackSource();
    }, DIRECT_START_MS);
  }

  private useFallbackSource(): boolean {
    clearTimeout(this.directTimer);
    const fallback = this.nativeFallbackSrc;
    if (!fallback || this.video.src === fallback) return false;
    this.nativeFallbackSrc = undefined;
    this.video.src = fallback;
    return true;
  }

  setInParty(inParty: boolean): void {
    this.inParty = inParty;
    this.applyBuffers();
  }

  subtitleDelayChanged(): void {
    this.applyBuffers();
  }

  private applyBuffers(): void {
    if (!this.hls) return;
    const isProxied = usesWebsiteProxy(this.hls.url || this.video.src || location.href);
    Object.assign(this.hls.config, bufferPolicy(this.inParty, isProxied, thisTier(), this.syncDelay?.() ?? 0));
  }

  setAdaptive(adaptive: boolean): void {
    this.adaptive = adaptive;
  }

  useSubtitleSync(loader: () => Promise<SyncStarter>, delay?: () => number): void {
    this.syncLoader = loader;
    this.syncDelay = delay;
  }

  setSubtitleSyncMode(mode: SubtitleSyncMode): void {
    if (mode === this.syncMode) return;
    this.syncMode = mode;
    this.emit();
  }

  setSubtitleSync(on: boolean): void {
    if (on === this.syncOn) return;
    this.syncOn = on;
    if (!on) {
      this.syncHandle?.close(true);
      this.syncHandle = undefined;
      this.tap?.keep(false);
    } else if (this.tap && this.hasSource) {
      this.attachSync(this.hls ?? undefined, this.generation);
    }
    this.emit();
  }

  quiet(): boolean {
    return Date.now() < this.quietUntil;
  }

  private attachSync(hls: Hls | undefined, generation: number): void {
    const { syncLoader: loader, tap, audioSwitching } = this;
    if (!loader || !this.syncOn || !tap || (hls && !audioSwitching) || this.syncHandle) return;
    this.syncStatus = "ready";
    tap.keep(true);
    void Promise.resolve()
      .then(() => loader())
      .catch(() => undefined)
      .then((starter) => {
        if (generation !== this.generation || this.hls !== (hls ?? null) || this.tap !== tap || !this.syncOn || this.syncHandle) return;
        const handle = starter?.({
          ...(hls && audioSwitching ? { hls, events: { audioSwitching } } : { live: true }),
          video: this.video,
          tap,
          show: (id) => {
            if (generation !== this.generation) return;
            this.quietUntil = Date.now() + 2500;
            this.setSubtitle(id);
          },
          report: (status, moved) => {
            if (generation !== this.generation || !this.syncOn) return;
            this.syncStatus = status;
            this.syncMoved = moved;
            this.emit();
          },
          ...(this.syncDelay ? { delay: this.syncDelay } : {}),
          light: () => this.syncMode === "light",
          offer: (id, offer, last) => {
            if (generation === this.generation) offerOfficial(this.video, id, offer, last);
          },
        });
        this.syncHandle = handle;
        this.syncStatus = handle ? "ready" : "unavailable";
        if (!handle) tap.keep(false);
        this.emit();
      });
  }

  play(): void {
    if (!this.hasSource) return;
    if (this.loading) {
      this.pendingPlay = true;
      return;
    }
    if (this.errorCode === PlayerError.Blocked) {
      this.errorCode = undefined;
      this.emit();
    }
    this.video.play().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "NotAllowedError") this.fail(PlayerError.Blocked);
    });
  }

  pause(): void {
    this.pendingPlay = false;
    this.video.pause();
  }

  resumePoint(): number {
    const at = this.video.currentTime || 0;
    return at > 0 ? at : (this.requestedStart ?? 0);
  }

  wantsPlay(): boolean {
    return this.pendingPlay || (this.hasSource && !this.video.paused);
  }

  seek(time: number): void {
    if (!this.hasSource) return;
    const max = Number.isFinite(this.video.duration) ? this.video.duration : time;
    this.video.currentTime = Math.max(0, Math.min(time, max));
  }

  skip(seconds: number): void {
    this.seek(this.video.currentTime + seconds);
  }

  pictureReadable(): boolean {
    if (this.hls) return true;
    const src = this.video.currentSrc || this.video.src;
    if (!src) return false;
    return readableFrom(src) === "same-origin" || (this.video.crossOrigin === "anonymous" && !this.corsTrial);
  }

  setQuality(level: number): void {
    if (!this.hls) return;
    this.lowStart = null;
    this.hls.nextLevel = level;
    this.emit();
  }

  setSubtitle(trackIndex: number): void {
    if (this.hls && this.hls.subtitleTracks?.length) {
      this.hls.subtitleTrack = trackIndex;
    }
    if (this.video.textTracks && this.video.textTracks.length > 0) {
      for (let i = 0; i < this.video.textTracks.length; i++) {
        const t = this.video.textTracks[i]!;
        release(t);
        t.mode = i === trackIndex ? "hidden" : "disabled";
      }
    }
    this.emit();
  }

  setPlaybackRate(rate: number): void {
    const chosen = Math.max(0.25, Math.min(rate, 4));
    if (this.boostedFrom !== null) this.boostedFrom = chosen;
    else this.video.playbackRate = chosen;
    this.emit();
  }

  boost(rate: number): void {
    if (this.boostedFrom !== null || !this.hasSource) return;
    this.boostedFrom = this.video.playbackRate || 1;
    this.video.playbackRate = rate;
  }

  unboost(): void {
    if (this.boostedFrom === null) return;
    const chosen = this.boostedFrom;
    this.boostedFrom = null;
    this.video.playbackRate = chosen;
  }

  setAudio(trackIndex: number): void {
    if (!this.hls || !this.hls.audioTracks?.length) return;
    this.hls.audioTrack = trackIndex;
    this.emit();
  }

  stop(): void {
    this.teardown();
    this.emit();
  }

  getState(): PlayerState {
    if (!this.hasSource) return IDLE_STATE;
    const currentTime = this.video.currentTime || 0;
    const duration = Number.isFinite(this.video.duration) ? this.video.duration : 0;
    if (this.errorCode) return { state: "error", currentTime, duration, error: this.errorCode, ...(this.errorDetail && { detail: this.errorDetail }) };
    if (this.loading) return { state: "loading", currentTime, duration };

    return {
      state: this.video.paused ? "paused" : "playing",
      currentTime,
      duration,
      buffering: this.video.seeking || (!this.video.paused && this.video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA),
      bufferedEnd: this.getBufferedEnd(),
      playbackRate: this.boostedFrom ?? (this.video.playbackRate || 1),
      quality: this.getQualityState(),
      subtitles: this.getSubtitleState(),
      audio: this.getAudioState(),
      ...(this.syncLoader ? { subtitleSync: this.syncOn ? this.syncStatus : ("off" as const), subtitleSyncMode: this.syncMode } : {}),
      ...(this.syncLoader && this.syncOn && this.syncStatus === "synced" && this.syncMoved !== undefined ? { subtitleShift: this.syncMoved } : {}),
    };
  }

  private getBufferedEnd(): number {
    const { buffered, currentTime } = this.video;
    for (let i = 0; i < buffered.length; i++) {
      if (buffered.start(i) <= currentTime + 0.5 && buffered.end(i) >= currentTime) return buffered.end(i);
    }
    return currentTime || 0;
  }

  hasBuffered(time: number, seconds = 3): boolean {
    if (!this.hasSource) return false;
    const { buffered, duration } = this.video;
    const to = Number.isFinite(duration) ? Math.min(time + seconds, duration - 0.1) : time + seconds;
    for (let i = 0; i < buffered.length; i++) {
      if (buffered.start(i) <= time + 0.25 && buffered.end(i) >= to) return true;
    }
    return false;
  }

  private getQualityState(): { levels: PlayerQualityLevel[]; current: number; active?: number } | undefined {
    if (!this.hls?.levels || this.hls.levels.length <= 1) return undefined;
    const levels: PlayerQualityLevel[] = this.hls.levels.map((lvl, index) => {
      return {
        id: index,
        label: formatQualityLabel(lvl.width, lvl.height, lvl.name),
        height: lvl.height,
        ...(lvl.width ? { width: lvl.width } : {}),
        bitrate: lvl.bitrate,
      };
    });
    const playing = this.hls.currentLevel;
    return {
      levels,
      current: this.lowStart?.highest ?? this.hls.manualLevel,
      ...(playing >= 0 ? { active: playing } : {}),
    };
  }

  private getSubtitleState(): { tracks: PlayerTrack[]; current: number } | undefined {
    const tracks: PlayerTrack[] = [];
    if (this.hls?.subtitleTracks?.length) {
      this.hls.subtitleTracks.forEach((t, index) => {
        tracks.push({
          id: index,
          label: trackLabel(t.name, t.lang, `Subtitle ${index + 1}`),
          lang: t.lang,
        });
      });
      return {
        tracks,
        current: this.hls.subtitleTrack,
      };
    }

    if (this.video.textTracks && this.video.textTracks.length > 0) {
      let current = -1;
      for (let i = 0; i < this.video.textTracks.length; i++) {
        const t = this.video.textTracks[i]!;
        tracks.push({
          id: i,
          label: trackLabel(t.label, t.language, `Subtitle ${i + 1}`),
          lang: t.language,
        });
        if (t.mode !== "disabled" && !isHeld(t)) current = i;
      }
      return { tracks, current };
    }

    return undefined;
  }

  private getAudioState(): { tracks: PlayerTrack[]; current: number } | undefined {
    if (!this.hls?.audioTracks || this.hls.audioTracks.length <= 1) return undefined;
    const tracks: PlayerTrack[] = this.hls.audioTracks.map((t, index) => ({
      id: index,
      label: trackLabel(t.name, t.lang, `Audio ${index + 1}`),
      lang: t.lang,
    }));
    return {
      tracks,
      current: this.hls.audioTrack,
    };
  }

  destroy(): void {
    clearInterval(this.ticker);
    this.teardown();
  }

  private fail(code: string, detail?: string): void {
    this.errorCode = code;
    this.errorDetail = detail?.slice(0, 200);
    this.loading = false;
    this.emit();
  }

  private teardown(): void {
    this.generation += 1;
    this.lowStart = null;
    this.pendingPlay = false;
    this.startAt = undefined;
    this.hlsStartAt = undefined;
    this.requestedStart = undefined;
    this.nativeFallbackSrc = undefined;
    clearTimeout(this.directTimer);
    this.syncHandle?.close();
    this.syncHandle = undefined;
    this.syncStatus = "ready";
    this.tap?.stop();
    this.tap = undefined;
    this.audioSwitching = undefined;
    this.hls?.destroy();
    this.hls = null;
    this.hasSource = false;
    this.loading = false;
    this.errorCode = undefined;
    this.errorDetail = undefined;
    this.video.pause();
    this.boostedFrom = null;
    this.video.playbackRate = 1;

    while (this.video.firstChild) {
      this.video.removeChild(this.video.firstChild);
    }

    this.corsTrial = false;
    this.video.removeAttribute("crossorigin");
    this.video.removeAttribute("src");
    this.video.load();
  }

  private emit(): void {
    const state = this.getState();
    const key = JSON.stringify(state);
    if (key === this.lastEmitted) return;
    this.lastEmitted = key;
    this.onChange(state);
  }
}
