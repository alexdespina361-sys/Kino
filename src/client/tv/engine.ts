import type Hls from "hls.js";
import {
  IDLE_STATE,
  type PlayerQualityLevel,
  type PlayerState,
  type PlayerTrack,
  type StreamType,
  type SubtitleTrack,
  trackLabel,
} from "../../shared";

/** Error codes surfaced in PlayerState.error. */
export const PlayerError = {
  NotDirectlyPlayable: "SOURCE_NOT_DIRECTLY_PLAYABLE",
  HlsUnsupported: "HLS_UNSUPPORTED",
  Blocked: "PLAYBACK_BLOCKED",
} as const;

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

/**
 * Thin wrapper around one <video>. Reports its real state through `onChange` on every media event
 * and once per second while it is moving, so the phone always renders what the TV is actually doing.
 */
export class PlayerEngine {
  private hls: Hls | null = null;
  private hasSource = false;
  private loading = false;
  private pendingPlay = false;
  private errorCode: string | undefined;
  /** Resume point for a plain (non-hls.js) source; applied once the duration is known. */
  private startAt: number | undefined;
  private generation = 0;
  /** The last state handed to `onChange`, as JSON, to skip repeats. */
  private lastEmitted = "";
  private readonly ticker: ReturnType<typeof setInterval>;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly onChange: (state: PlayerState) => void,
    private readonly onEnded?: () => void,
  ) {
    video.addEventListener("loadedmetadata", () => {
      this.loading = false;
      if (this.startAt !== undefined) {
        const duration = Number.isFinite(video.duration) ? video.duration : this.startAt;
        video.currentTime = Math.max(0, Math.min(this.startAt, duration - 1));
        this.startAt = undefined;
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
      if (this.hasSource) this.fail(PlayerError.NotDirectlyPlayable);
    });
    this.ticker = setInterval(() => this.hasSource && this.emit(), 1000);
  }

  async load(url: string, type: StreamType, subtitles?: SubtitleTrack[], startAt?: number): Promise<void> {
    this.teardown();
    const generation = this.generation;
    this.hasSource = true;
    this.loading = true;
    this.startAt = startAt && startAt > 0 ? startAt : undefined;
    this.emit();

    // Media may be root-relative (local fixtures); resolve against the TV's own origin.
    const src = new URL(url, location.href).href;

    // Attach external subtitle tracks if provided
    if (subtitles?.length) {
      for (const sub of subtitles) {
        const track = document.createElement("track");
        track.kind = "subtitles";
        track.label = sub.label;
        track.srclang = sub.lang || "en";
        track.src = new URL(sub.url, location.href).href;
        this.video.appendChild(track);
      }
    }

    if (type === "mp4") {
      this.video.src = src;
      return;
    }

    const { default: HlsLib } = await import("hls.js");
    if (generation !== this.generation) return; // a newer load/stop superseded this one

    if (HlsLib.isSupported()) {
      const resumeAt = this.startAt;
      this.startAt = undefined; // hls.js starts there itself
      const hls = new HlsLib({
        startPosition: resumeAt ?? -1,
        capLevelToPlayerSize: false,
        maxBufferLength: 120,
        maxMaxBufferLength: 600,
        maxBufferSize: 128 * 1024 * 1024,
        lowLatencyMode: false,
      });
      this.hls = hls;
      hls.subtitleDisplay = false; // keep its subtitle tracks "hidden" instead of painting them: the page draws them
      let retriedProxy = false;
      let mediaRecoverAttempts = 0;
      hls.on(HlsLib.Events.ERROR, (_event, data) => {
        console.warn("[HLS EVENT ERROR]", {
          type: data.type,
          details: data.details,
          fatal: data.fatal,
          url: data.url,
          response: data.response ? { code: data.response.code, text: data.response.text } : undefined,
        });
        if (data.fatal) {
          if (!retriedProxy && !src.includes("/api/proxy") && (src.startsWith("http://") || src.startsWith("https://"))) {
            retriedProxy = true;
            console.log("[HLS] Retrying via proxy:", src);
            const proxied = new URL(`/api/proxy?url=${encodeURIComponent(src)}`, location.href).href;
            hls.loadSource(proxied);
            return;
          }

          if (data.type === HlsLib.ErrorTypes.MEDIA_ERROR && mediaRecoverAttempts < 2) {
            mediaRecoverAttempts++;
            console.log("[HLS] Recovering from media error, attempt:", mediaRecoverAttempts);
            hls.recoverMediaError();
            return;
          }

          console.error("[HLS FATAL ERROR]", data.type, data.details);
          this.fail(PlayerError.NotDirectlyPlayable);
        }
      });

      hls.on(HlsLib.Events.MANIFEST_PARSED, (_event, data) => {
        // Automatically select the highest available quality level
        if (data?.levels && data.levels.length > 0) {
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
      hls.on(HlsLib.Events.AUDIO_TRACKS_UPDATED, () => this.emit());

      hls.loadSource(src);
      hls.attachMedia(this.video);
    } else if (this.video.canPlayType("application/vnd.apple.mpegurl")) {
      this.video.src = src;
    } else {
      this.fail(PlayerError.HlsUnsupported);
    }
  }

  play(): void {
    if (!this.hasSource) return;
    if (this.loading) {
      this.pendingPlay = true;
      return;
    }
    // Asking again after a block means someone pressed something since: the block is over unless the browser says it again.
    if (this.errorCode === PlayerError.Blocked) {
      this.errorCode = undefined;
      this.emit();
    }
    this.video.play().catch((error: unknown) => {
      // AbortError = interrupted by a newer load/pause; not a real failure.
      if (error instanceof DOMException && error.name === "NotAllowedError") this.fail(PlayerError.Blocked);
    });
  }

  pause(): void {
    this.pendingPlay = false;
    this.video.pause();
  }

  seek(time: number): void {
    if (!this.hasSource) return;
    const max = Number.isFinite(this.video.duration) ? this.video.duration : time;
    this.video.currentTime = Math.max(0, Math.min(time, max));
  }

  /** Jump relative to where the video really is right now. */
  skip(seconds: number): void {
    this.seek(this.video.currentTime + seconds);
  }

  setQuality(level: number): void {
    if (!this.hls) return;
    this.hls.currentLevel = level;
    this.emit();
  }

  setSubtitle(trackIndex: number): void {
    if (this.hls && this.hls.subtitleTracks?.length) {
      this.hls.subtitleTrack = trackIndex;
    }
    if (this.video.textTracks && this.video.textTracks.length > 0) {
      for (let i = 0; i < this.video.textTracks.length; i++) {
        const t = this.video.textTracks[i]!;
        t.mode = i === trackIndex ? "hidden" : "disabled"; // hidden: loaded and timed, drawn by the page itself (Captions.tsx)
      }
    }
    this.emit();
  }

  setPlaybackRate(rate: number): void {
    this.video.playbackRate = Math.max(0.25, Math.min(rate, 4));
    this.emit();
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
    if (this.errorCode) return { state: "error", currentTime, duration, error: this.errorCode };
    if (this.loading) return { state: "loading", currentTime, duration };

    return {
      state: this.video.paused ? "paused" : "playing",
      currentTime,
      duration,
      buffering: this.video.seeking || (!this.video.paused && this.video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA),
      bufferedEnd: this.getBufferedEnd(),
      playbackRate: this.video.playbackRate || 1,
      quality: this.getQualityState(),
      subtitles: this.getSubtitleState(),
      audio: this.getAudioState(),
    };
  }

  /** Where the buffered range around the playhead ends, for the grey part of the progress bar. */
  private getBufferedEnd(): number {
    const { buffered, currentTime } = this.video;
    for (let i = 0; i < buffered.length; i++) {
      if (buffered.start(i) <= currentTime + 0.5 && buffered.end(i) >= currentTime) return buffered.end(i);
    }
    return currentTime || 0;
  }

  private getQualityState(): { levels: PlayerQualityLevel[]; current: number } | undefined {
    if (!this.hls?.levels || this.hls.levels.length <= 1) return undefined;
    const levels: PlayerQualityLevel[] = this.hls.levels.map((lvl, index) => {
      return {
        id: index,
        label: formatQualityLabel(lvl.width, lvl.height, lvl.name),
        height: lvl.height,
        bitrate: lvl.bitrate,
      };
    });
    return {
      levels,
      current: this.hls.autoLevelEnabled ? -1 : this.hls.currentLevel,
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
        if (t.mode !== "disabled") current = i;
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

  private fail(code: string): void {
    this.errorCode = code;
    this.loading = false;
    this.emit();
  }

  private teardown(): void {
    this.generation += 1;
    this.pendingPlay = false;
    this.startAt = undefined;
    this.hls?.destroy();
    this.hls = null;
    this.hasSource = false;
    this.loading = false;
    this.errorCode = undefined;
    this.video.pause();
    this.video.playbackRate = 1;

    // Remove any attached text tracks
    while (this.video.firstChild) {
      this.video.removeChild(this.video.firstChild);
    }

    this.video.removeAttribute("src");
    this.video.load();
  }

  /** Tells the page about the state, unless nothing changed since last time (a paused video would otherwise repeat itself every second). */
  private emit(): void {
    const state = this.getState();
    const key = JSON.stringify(state);
    if (key === this.lastEmitted) return;
    this.lastEmitted = key;
    this.onChange(state);
  }
}
