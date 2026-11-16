import type Hls from "hls.js";
import { prepareBrowserStream } from "./browserStream";
import {
  IDLE_STATE,
  type OfficialOfferLine,
  type PlayerQualityLevel,
  type PlayerState,
  type PlayerTrack,
  type StreamType,
  type SubtitleSyncMode,
  type SubtitleTrack,
  trackLabel,
} from "../../shared";
import { reloadForScript, scriptIsMissing } from "../shared/scriptRescue";
import { offerOfficial } from "./officialOffer";
import { isHeld, markNoLanguage, release } from "../subsync/hold";
import type { SyncStatus } from "../subsync/session";
import { canCapture, ElementTap } from "../subsync/capture";
import { AudioTap, type HlsEvents, type SoundTap } from "../subsync/tap";

/** What the subtitle aligner is given of a film (see `subsync/start.ts`), and the handle it gives back. */
export interface SyncFilm {
  /** hls.js, for a film that plays through it; none for a file the browser plays by itself. */
  hls?: Hls;
  video: HTMLVideoElement;
  /** hls.js's name for the event it listens to. */
  events?: { audioSwitching: string };
  /** The film's sound: as hls.js downloads it (the player has listened since the film began, so that the aligner has all of it however late it starts), or as it comes out of the `<video>`. */
  tap: SoundTap;
  /** The sound comes as the film plays, never ahead of it (a file the browser plays by itself). */
  live?: boolean;
  /** Puts subtitle track `id` on screen. */
  show(id: number): void;
  report(status: SyncStatus, moved?: number): void;
  /** The viewer's own subtitle delay. */
  delay?: () => number;
  /** Whether the viewer chose the light way of timing (asked each time: it can change while the film plays). */
  light?: () => boolean;
  /** Offers a file the aligner has timed well for a Kino Official subtitle (see `subsync/official.ts`). */
  offer?: (id: number, offer: { duration: number; lines: OfficialOfferLine[] }, last: boolean) => void;
}
export interface SyncHandle {
  /** `restore`: the lines go back to the file's times (the viewer turned it off). */
  close(restore?: boolean): void;
}
export type SyncStarter = (film: SyncFilm) => SyncHandle | undefined;

/** Error codes surfaced in PlayerState.error. */
export const PlayerError = {
  NotDirectlyPlayable: "SOURCE_NOT_DIRECTLY_PLAYABLE",
  HlsUnsupported: "HLS_UNSUPPORTED",
  Blocked: "PLAYBACK_BLOCKED",
  /** Nothing came back from the network at all: the link or the server went away (it passes; the video itself is fine). */
  ConnectionLost: "CONNECTION_LOST",
  /** The place the video comes from answered, and said no (a 5xx, a 404 for a link that has run out): the TV is not what failed, and another look for the link may find one that plays. */
  SourceUnavailable: "SOURCE_UNAVAILABLE",
} as const;

/**
 * Whether a fatal hls.js error is the connection going and not the video being bad: a network error that got no answer (a refused or dropped
 * connection, a time-out). An answer that says no (404, 403, a 5xx) is the video's, or the site's, and no waiting changes it.
 */
export function lostTheConnection(data: { type?: string; details?: string; response?: { code?: number } }): boolean {
  if (data.type !== "networkError") return false;
  if (data.details?.endsWith("TimeOut")) return true;
  const code = data.response?.code;
  return code === undefined || code < 100;
}

/** Whether a fatal hls.js error is the place the video comes from answering with a refusal or a failure (an HTTP status of 400 or more), where the TV, the picture and the connection were all fine. */
export function sourceSaidNo(data: { type?: string; details?: string; response?: { code?: number } }): boolean {
  return data.type === "networkError" && (data.response?.code ?? 0) >= 400 && !lostTheConnection(data);
}

/** Where an address leads, short: the host, the one behind it when the address is a proxy's (or the relay's) and carries the real one, and the file. Never the query or the rest of the path: those hold links' tokens and signatures. */
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
        /* not an address */
      }
    }
    return real ? `${address.host} → ${real.host} ${file(real)}`.trim() : `${address.host} ${file(address)}`.trim();
  } catch {
    return "";
  }
}

/**
 * One line for the console about an hls.js error: what it was, whether it ended the video, what the other end answered and where from. A line pasted
 * from a viewer's console is then enough to tell a link that is gone (HTTP 404 from the film's host) from a connection that dropped (no answer).
 */
export function describeHlsError(data: { type?: string; details?: string; fatal?: boolean; url?: string; response?: { code?: number } }): string {
  const code = data.response?.code;
  const answer = code ? `HTTP ${code}` : data.type === "networkError" ? "no answer" : "";
  const where = whereIs(data.url);
  return `[HLS] ${data.details ?? data.type ?? "error"}${data.fatal ? " (fatal)" : ""}${answer || where ? ":" : ""}${answer ? ` ${answer}` : ""}${where ? ` from ${where}` : ""}`;
}

/**
 * How far ahead of the picture a screen downloads, in the three numbers hls.js wants (it aims at `max(8 * maxBufferSize / bitrate, maxBufferLength)`
 * seconds, and never more than `maxMaxBufferLength`). Alone, a screen takes a good part of the film in at once (minutes ahead): nothing else
 * is asking for it. The screens of a party are different: the proxy keeps the pieces that one of them fetched so that the others get them
 * from memory, but only a few dozen megabytes of them (see `SegmentCache`), and a host that is minutes ahead has long since pushed out what a
 * guest asks for now, so every guest went to the film's own server for all of it again. Within a party every screen stays this close to
 * its picture instead, which is what the proxy can hold, and which is plenty to ride out a bad moment on the way.
 */
export const PARTY_BUFFER_AHEAD_S = 40;
export const PARTY_BUFFER_BYTES = 32 * 1024 * 1024;
export const LONE_PROXY_BUFFER_AHEAD_S = 90;
export const LONE_PROXY_BUFFER_BYTES = 48 * 1024 * 1024;

export function bufferPolicy(inParty: boolean, isProxied = false): { maxBufferLength: number; maxMaxBufferLength: number; maxBufferSize: number } {
  if (inParty) {
    return { maxBufferLength: 10, maxMaxBufferLength: PARTY_BUFFER_AHEAD_S, maxBufferSize: PARTY_BUFFER_BYTES };
  }
  if (isProxied) {
    return { maxBufferLength: 30, maxMaxBufferLength: LONE_PROXY_BUFFER_AHEAD_S, maxBufferSize: LONE_PROXY_BUFFER_BYTES };
  }
  return { maxBufferLength: 120, maxMaxBufferLength: 600, maxBufferSize: 128 * 1024 * 1024 };
}

/** How long a direct address may take to start playing before the server's own is used instead (see `PlayerEngine.playNatively`). */
export const DIRECT_START_MS = 12_000;

/**
 * With Auto off (every piece in the highest quality), the first piece of a film comes in 480p instead, a quarter of the bytes or less, so that the picture
 * starts sooner; the highest follows from the second piece on, without a stop (the owner's idea, 15 Nov: a first piece in 480p, "only if this can be done
 * for the first 3-5 seconds at most"; then, 16 Nov evening, yes to 6 s, which many hosts cut). So only when that first piece plays for no longer than
 * `LOW_FIRST_MAX_S`: the highest's list comes first, as before, and says how long the piece is; a stream cut into longer pieces then starts in the
 * highest, request for request as before (0 turns this off). (Auto starts in the lowest quality there is anyway, and follows the connection from there.)
 * Measured on a synthetic 1080p/720p/480p/360p stream (item 9's bench, 16 Nov): with 2 s pieces, from Play to a moving picture took 1.98 s before and 1.05 s
 * after on a 10 Mbps link, 1.05 s and 0.68 s on 25 Mbps; 480p for the first 1.8 s, then 1080p, and no stop to fill at the change. 10 s pieces: the
 * same as before within a few tens of ms (6.2 s on 10 Mbps, 2.77 s on 25 Mbps). 6 s pieces, once 6 s counted (16 Nov evening, 3 runs each): 4.05 s before and
 * 1.50 s after on 10 Mbps, 1.90 s and 0.89 s on 25 Mbps; 480p for the first 5.9 s, then 1080p, no stop to fill.
 */
export const LOW_FIRST_MAX_S = 6;
/**
 * How much longer than `LOW_FIRST_MAX_S` a first piece may be and still count. A host that cuts "6 s" pieces cuts at the picture's own frames, so its
 * lists say 6.006 (30000/1001 frames a second), 6.0067, or 6.2 when the first frame that starts a picture of its own falls later; 0.05 left those out.
 * The box had no piece lengths to read when this was set (16 Nov: its 5 logged starts predate the `pieceS` line), so it is from how streams are cut.
 */
export const LOW_FIRST_SLACK_S = 0.3;
export const LOW_FIRST_LABEL = "480p";

/**
 * The quality the first piece comes in with Auto off (see `LOW_FIRST_MAX_S`): a 480p one, as the menu names them (`formatQualityLabel`, so a wide
 * 854x356 is one), the best of them if there are several; only when the highest is 720p or above. Else -1: a film with no 480p starts in the highest
 * as before (a 360p or 180p first piece is not what a profile that asked for the best quality wants to see). Only one of the highest's kind of picture
 * (its `codecSet` and `videoRange`, as hls.js has them): hls.js's own Auto never changes between kinds in a film, and neither does this.
 */
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

/** hls.js's answer to a piece or a list that will not come, once the tries it makes itself are over: leave this quality (its `NetworkErrorAction.SendAlternateToPenaltyBox`, which it does not export). */
const LEAVE_THIS_QUALITY = 2;

/**
 * A quality picked by hand stays through the answers above: hls.js would go back to Auto at the first one, a piece that was refused once
 * was enough, and a viewer found the picture on Auto every few seconds while it was not even short of data. It goes back to Auto only when
 * that many come one after the other with no piece arriving between them: the quality does not load, and the film would stand still on it.
 */
export const QUALITY_GIVE_UPS = 3;

/** 1080p and above: what `formatQualityLabel` calls those (a film's own shape counts: 1920x804 is 1080p, 1280x536 is 720p). */
const isHighDefinition = (width = 0, height = 0): boolean => width >= 1800 || height >= 800;

/**
 * Whether a page may read the sound of a film from `src`, and so the aligner listen to it (see `subsync/capture.ts`): a film from this
 * site, or one through the stream relay, which answers every request, a refusal too, with `Access-Control-Allow-Origin: *`. A film
 * through the relay must then be asked for so (`crossorigin`); one from anywhere else is not read, and is asked for as it always was.
 */
export function readableFrom(src: string, here = location.href): "same-origin" | "cors" | undefined {
  try {
    const url = new URL(src, here);
    if (url.origin === new URL(here).origin) return "same-origin";
    return url.pathname === "/api/proxy" && url.searchParams.has("url") && url.searchParams.has("sig") ? "cors" : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A film through a proxy of ours (the stream relay, or this website's own) that would not open at all. A video element is told no more than "will not
 * open" (MEDIA_ERR 4) whatever the reason, and through our proxies that is almost always the film's host saying no (a token that ran out, a busy
 * server: the proxy passes its refusal on), not a file the TV cannot play. So it is said as that (SOURCE_UNAVAILABLE): the title is looked up afresh
 * once by itself, and the card says the source is not answering, as for a stream whose host said no.
 */
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

/**
 * Where the quality that the player picks by itself stops while the picture comes through this server (`/api/proxy`), which is where
 * the bytes of a film are the server's to pay for: the best level that is not high definition (720p carries about half of what 1080p does),
 * as the index hls.js wants for `autoLevelCapping`, or -1 for no limit (one level, or none above 720p). A quality picked by hand is no part of
 * this (the menu still lists every level), and neither is a picture that does not come through the server. When every level is high
 * definition the lowest one is the limit.
 */
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

/** Where the load of a film spent its time (see `PlayerEngine.startup`), in milliseconds from the start of the load. */
export interface StartupNote {
  /** It started further in than the beginning (a resume): its first piece is the one at that place. */
  resumed?: boolean;
  /** hls.js: the list of the qualities came. */
  manifestMs?: number;
  /** hls.js: the first piece of picture came; how long it plays (seconds), its size (KB) and its picture's height. */
  pieceMs?: number;
  pieceS?: number;
  pieceKB?: number;
  height?: number;
  /** The browser knew the film's length and size (for a file, its index came). */
  metadataMs?: number;
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
  private errorDetail: string | undefined;
  /** Resume point for a plain (non-hls.js) source; applied once the duration is known. */
  private startAt: number | undefined;
  /** Where the video that is loading (or has just failed to) was told to start, kept after the player has taken it: see `resumePoint`. */
  private requestedStart: number | undefined;
  private generation = 0;
  /** The speed that was chosen, while a hold on the picture plays faster (see `boost`); null when nothing is held. */
  private boostedFrom: number | null = null;
  /** This screen is in a party (see `bufferPolicy`). */
  private inParty = false;
  /** The profile lets the picture's quality follow the connection (see `setAdaptive`). */
  private adaptive = true;
  /** The last state handed to `onChange`, as JSON, to skip repeats. */
  private lastEmitted = "";
  private nativeFallbackSrc?: string;
  /** Gives up on a direct address that has not started playing (see `watchDirectStart`). */
  private directTimer?: ReturnType<typeof setTimeout>;
  private readonly ticker: ReturnType<typeof setInterval>;
  /** The subtitle aligner (see `useSubtitleSync`): fetched when a film starts, if the viewer has it on. */
  private syncLoader: (() => Promise<SyncStarter>) | undefined;
  private syncDelay: (() => number) | undefined;
  private syncOn = true;
  private syncMode: SubtitleSyncMode = "full";
  private syncHandle: SyncHandle | undefined;
  private syncStatus: SyncStatus = "ready";
  /** How far the aligner moved the lines, while they are timed (see `SyncSession.moved`). */
  private syncMoved: number | undefined;
  /** What listens to the sound hls.js downloads, whether or not the aligner is on (see `AudioTap`), and the name of the event for a switch of the sound track. */
  private tap: SoundTap | undefined;
  private audioSwitching: string | undefined;
  /** The file playing was asked for with `crossorigin`, so that the aligner may listen, and has not begun yet: should it fail, it is asked for again without (once). */
  private corsTrial = false;
  /** The aligner has just put another subtitle track on screen: the page says nothing about it (see `quiet`). */
  private quietUntil = 0;
  /**
   * With Auto off, the film's first piece comes in 480p and the rest in `highest` (see `LOW_FIRST_MAX_S`): set from the list of qualities until the
   * first picture piece has come; `down` once the highest's list said the first piece is short and 480p was asked for.
   */
  private lowStart: { low: number; highest: number; down: boolean } | null = null;
  /** How the film that is loading came in (see `startup`), and when its load began. */
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
      if (this.hasSource) {
        if (this.useFallbackSource() || this.withoutCors()) return;
        // (MEDIA_ERR_NETWORK, 2: the download broke off part of the way. A file that cannot be opened at all, or played, is another code.)
        const { code, message } = video.error ?? {};
        // (MEDIA_ERR_SRC_NOT_SUPPORTED, 4, before anything of it came, from a proxy of ours: see `throughOurProxy`.)
        const refused = code === 4 && this.loading && throughOurProxy(video.currentSrc || video.src);
        this.fail(code === 2 ? PlayerError.ConnectionLost : refused ? PlayerError.SourceUnavailable : PlayerError.NotDirectlyPlayable, `MEDIA_ERR ${code ?? "?"}${message ? `: ${message}` : ""}`);
      }
    });
    this.ticker = setInterval(() => this.hasSource && this.emit(), 1000);
  }

  /**
   * Where the load of the film that plays spent its time, for the team's record of the wait before a film (TV_STARTED, `playback-started`): numbers only.
   * Each time is from the start of the load.
   */
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

    // Media may be root-relative (local fixtures); resolve against the TV's own origin.
    let src = new URL(url, location.href).href;
    const browserStream = type === "hls" ? prepareBrowserStream(directUrl ?? src) : undefined;
    if (browserStream) {
      try {
        src = await browserStream;
        if (generation !== this.generation) return;
        directUrl = undefined;
      } catch (error) {
        if (generation === this.generation) {
          console.warn("[Kino direct playback]", error instanceof Error ? error.message : "Could not prepare video");
          this.fail(PlayerError.NotDirectlyPlayable);
        }
        return;
      }
    }

    // Attach external subtitle tracks if provided
    if (subtitles?.length) {
      for (const sub of subtitles) {
        const track = document.createElement("track");
        track.kind = "subtitles";
        track.label = sub.label;
        track.srclang = sub.lang || "en";
        // (A track needs a language, so this one says English; the aligner is told that it is not known to be.)
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
      // (A page left open across a new version asks for a script that is no longer there: it starts again, once, with the new one's. If it cannot, or the connection
      // only blinked, the card says that the connection went, and its tries and its button go to the script again.)
      if (!(scriptIsMissing(error) && reloadForScript())) this.fail(PlayerError.ConnectionLost);
      return;
    }
    if (generation !== this.generation) return; // a newer load/stop superseded this one

    if (HlsLib.isSupported()) {
      const resumeAt = this.startAt;
      this.startAt = undefined; // hls.js starts there itself
      const adaptive = this.adaptive;
      const hls = new HlsLib({
        startPosition: resumeAt ?? -1,
        capLevelToPlayerSize: false,
        ...bufferPolicy(this.inParty, usesWebsiteProxy(src)),
        lowLatencyMode: false,
        // (A quality picked by hand is kept through a piece that will not load: see `QUALITY_GIVE_UPS`.)
        preserveManualLevelOnError: true,
        // (The first piece in the lowest quality, which is the first one the player lists: it drops the variants that have no picture when there are some that do.)
        ...(adaptive ? { startLevel: 0 } : {}),
      });
      this.hls = hls;
      hls.subtitleDisplay = false; // keep its subtitle tracks "hidden" instead of painting them: the page draws them
      let mediaRecoverAttempts = 0;
      let qualityGiveUps = 0;
      hls.on(HlsLib.Events.FRAG_LOADED, (_event, data) => {
        qualityGiveUps = 0;
        // (The first piece of picture: when it came, how long it plays, its size and its height. The sound's own pieces are not it.)
        const frag = data?.frag;
        // (The first piece came in 480p: the next ones are the highest, from the next one asked for, and what came plays out first. The
        // highest's list is here already: the second piece does not wait for it.)
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
        // (The 480p first piece, or its list, does not come at once: the highest then, as before this was done, without waiting out hls.js's tries of it.)
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
          hls.loadLevel = -1; // (what hls.js does at the first one, unless it is told to keep the quality)
          this.emit();
        }
        if (data.fatal) {
          if (data.type === HlsLib.ErrorTypes.MEDIA_ERROR && mediaRecoverAttempts < 2) {
            mediaRecoverAttempts++;
            console.log("[HLS] Recovering from media error, attempt:", mediaRecoverAttempts);
            hls.recoverMediaError();
            return;
          }

          // (Where it came from is in the line, short and without the link's token: a report that holds it says whether it was this server, a relay or the video's own host that answered.)
          const where = whereIs(data.url);
          console.error("[HLS FATAL ERROR]", data.type, data.details, ...(data.response?.code ? [`HTTP ${data.response.code}`] : []), ...(where ? [`from ${where}`] : []));
          this.fail(
            lostTheConnection(data) ? PlayerError.ConnectionLost : sourceSaidNo(data) ? PlayerError.SourceUnavailable : PlayerError.NotDirectlyPlayable,
            describeHlsError(data).replace(/^\[HLS\] /, ""),
          );
        }
      });

      // The highest's list came, as it always did first with Auto off: hls.js asks for the first piece right after this. A short first piece
      // comes in 480p (asked for here, so that hls.js asks for that one instead); a first piece longer than `LOW_FIRST_MAX_S` is not worth it
      // (480p for that long, for a second saved at most) and comes in the highest, as before.
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
        // Not adaptive: the highest quality there is, whatever the connection. (Adaptive leaves the choice to hls.js: see `setAdaptive`.)
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
          // (The first piece 480p when there is one, if the first piece is short: see `LOW_FIRST_MAX_S` and LEVEL_UPDATED.)
          const low = lowFirstLevel(data.levels, highestIdx);
          if (low >= 0) this.lowStart = { low, highest: highestIdx, down: false };
        } else if (data?.levels && usesWebsiteProxy(hls.url ?? src)) {
          // Adaptive, through this server: its own choice stops at 720p (a quality picked from the menu still goes higher). See `proxiedQualityCap`.
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
      // A viewer who reads the app in Romanian hears a film's Romanian sound first, when it has one. Only once, when the film's sound tracks
      // are first known: hls.js says so again when it changes to a variant with its sound in another group, and the track the viewer
      // picked by then is theirs. (A page that may not use its storage still plays: the setting is just not read.)
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

      // (The sound is listened to from the first piece, which comes as soon as the source is loaded, whether or not the aligner is there by then: the film does not wait for it.)
      if (this.syncLoader) {
        // (hls.js types its events and listeners more narrowly than the tap needs.)
        this.tap = new AudioTap(hls as unknown as HlsEvents, HlsLib.Events.BUFFER_APPENDING);
        this.audioSwitching = HlsLib.Events.AUDIO_TRACK_SWITCHING;
        this.attachSync(hls, generation);
      }
      hls.loadSource(src);
      hls.attachMedia(this.video);
    } else if (this.video.canPlayType("application/vnd.apple.mpegurl")) {
      this.syncStatus = "unavailable"; // (the browser's own player gives no access to the sound)
      this.playNatively(src, directUrl, generation);
    } else {
      this.fail(PlayerError.HlsUnsupported);
    }
  }

  /**
   * A file the browser plays by itself. The aligner listens to its sound as it comes out of the `<video>` (`ElementTap`) where the
   * page may read it (`readableFrom`): asked for with `crossorigin` when it comes through the relay, and asked for again without, once,
   * should it fail to start so (`withoutCors`). A direct address that goes first (the website's own proxy behind it) is not read.
   */
  private playFile(src: string, directUrl: string | undefined, generation: number): void {
    const directFirst = !!directUrl && directUrl !== src && usesWebsiteProxy(src);
    const reading = this.syncLoader && !directFirst && canCapture(this.video) ? readableFrom(src) : undefined;
    if (reading === "cors") {
      this.video.crossOrigin = "anonymous";
      this.corsTrial = true;
    }
    this.playNatively(src, directUrl, generation);
    if (!reading) {
      this.syncStatus = "unavailable"; // (the browser gives no access to the sound of this one)
      return;
    }
    this.tap = new ElementTap(this.video);
    this.attachSync(undefined, generation);
  }

  /** The file asked for with `crossorigin` failed before it began: it is asked for again as any file is, without the aligner. True when it was. */
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

  /** Plays with the browser's own player: a direct address, when there is one, goes first and `src` (the server's own) is what it falls back to. */
  private playNatively(src: string, directUrl: string | undefined, generation: number): void {
    // Only the website's explicitly configured proxy has a direct-first path. A separate relay owns its tokens and must be used on Safari too.
    if (directUrl && directUrl !== src && usesWebsiteProxy(src)) {
      this.nativeFallbackSrc = src;
      this.video.src = directUrl;
      this.watchDirectStart(generation);
    } else {
      this.video.src = src;
    }
  }

  /** A direct address that neither plays nor fails is a place that does not answer: after `DIRECT_START_MS` the server's own is used (once). */
  private watchDirectStart(generation: number): void {
    clearTimeout(this.directTimer);
    this.directTimer = setTimeout(() => {
      // (1 is HAVE_METADATA: it has begun.)
      if (generation === this.generation && this.video.readyState < 1) this.useFallbackSource();
    }, DIRECT_START_MS);
  }

  /** The direct address failed, or never started: the server's own instead. False when there is none (or it is the one that is playing). */
  private useFallbackSource(): boolean {
    clearTimeout(this.directTimer);
    const fallback = this.nativeFallbackSrc;
    if (!fallback || this.video.src === fallback) return false;
    this.nativeFallbackSrc = undefined;
    this.video.src = fallback;
    return true;
  }

  /**
   * This screen is, or is no longer, in a party: how far ahead it downloads changes at once for a film that is playing (hls.js reads its
   * settings each time it decides what to fetch next) and is the same for the ones that load later. What it has downloaded already stays.
   */
  setInParty(inParty: boolean): void {
    this.inParty = inParty;
    if (this.hls) {
      const isProxied = usesWebsiteProxy(this.hls.url || this.video.src || location.href);
      Object.assign(this.hls.config, bufferPolicy(inParty, isProxied));
    }
  }

  /**
   * Whether the picture's quality follows the connection (the profile's choice), from the next film on. On, the first piece of a film is
   * the lowest quality, which arrives at once whatever the link, so the picture starts at once; hls.js then asks for every piece in the best
   * quality that the link carries, as it measures it, which a weak or unsteady link brings down (and back up when it recovers). A change
   * applies to the pieces still to be downloaded: what is downloaded already plays out first. Off, every piece is the highest quality
   * there is (but a short first one, in 480p: see `LOW_FIRST_MAX_S`), which on a link that cannot carry it is a picture that stops to fill
   * again and again. Either way a quality picked from the
   * menu stays (`setQuality`).
   */
  setAdaptive(adaptive: boolean): void {
    this.adaptive = adaptive;
  }

  /**
   * Where the subtitle aligner comes from (a dynamic import: the page does not carry it until a film plays through hls.js), and the
   * viewer's own subtitle delay. Without this, there is no aligner and the state says nothing of one.
   */
  useSubtitleSync(loader: () => Promise<SyncStarter>, delay?: () => number): void {
    this.syncLoader = loader;
    this.syncDelay = delay;
  }

  /**
   * The viewer's switch for the aligner. Turned off, the lines go back where the file had them; turned on in the middle of a film,
   * it starts from what the player downloads from then on (the init segments of the sound were learned all along, so it can read it).
   */
  /** The way the aligner times the lines (see `SubtitleSyncModeSchema`). It is asked each time, so a change applies at once, to the film playing. */
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

  /** True for a moment after the aligner put another subtitle track on screen, so that the page does not announce a change nobody made. */
  quiet(): boolean {
    return Date.now() < this.quietUntil;
  }

  /**
   * Gets the aligner going on a film that plays through hls.js. Its code is fetched without the film waiting for it (the tap keeps the
   * first pieces of sound until it is there); nothing happens when the film is gone, or the viewer has turned it off, by then.
   */
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

  /**
   * Where the picture carries on from if it has to be loaded again (another source, the same one once more): where it is, or, when it never got
   * going, where it was told to start. Read it before `load`, which wipes the element.
   */
  resumePoint(): number {
    const at = this.video.currentTime || 0;
    return at > 0 ? at : (this.requestedStart ?? 0);
  }

  /** Whether the picture is meant to be playing: it is, or it was asked to as soon as it can (a video put back after a restart is neither, and stays held). */
  wantsPlay(): boolean {
    return this.pendingPlay || (this.hasSource && !this.video.paused);
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

  /**
   * Whether the page may read the picture's frames (for the ✦ choices, which redraw it): a stream hls.js plays is put together by the page itself, so
   * always; a file the browser plays by itself only from this site, or asked for with `crossorigin` (through the relay: see `readableFrom`) and begun so.
   * (enhancer.ts still finds out for sure at its first frame: a browser may say no where this says yes.)
   */
  pictureReadable(): boolean {
    if (this.hls) return true;
    const src = this.video.currentSrc || this.video.src;
    if (!src) return false;
    return readableFrom(src) === "same-origin" || (this.video.crossOrigin === "anonymous" && !this.corsTrial);
  }

  /** A quality picked by hand, or -1 for the player's own choice again: from the next piece on, without a stop (what is downloaded beyond the piece that plays is replaced). */
  setQuality(level: number): void {
    if (!this.hls) return;
    this.lowStart = null; // (a quality picked while the first piece comes in 480p: that one from the next piece)
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
        release(t); // (a track the aligner loaded to try is the viewer's, or off, from here on)
        t.mode = i === trackIndex ? "hidden" : "disabled"; // hidden: loaded and timed, drawn by the page itself (Captions.tsx)
      }
    }
    this.emit();
  }

  setPlaybackRate(rate: number): void {
    const chosen = Math.max(0.25, Math.min(rate, 4));
    if (this.boostedFrom !== null) this.boostedFrom = chosen; // held down: the new speed comes when the hold ends
    else this.video.playbackRate = chosen;
    this.emit();
  }

  /**
   * Plays at `rate` for as long as a hand holds the picture. The speed that was chosen stays the one that is reported meanwhile, so a
   * hold is no news to the phone, the speed menu, or the line that says a speed changed; `unboost` goes back to it.
   */
  boost(rate: number): void {
    if (this.boostedFrom !== null || !this.hasSource) return;
    this.boostedFrom = this.video.playbackRate || 1;
    this.video.playbackRate = rate;
  }

  /** The hold is over: back to the speed that was chosen. */
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

  /** Where the buffered range around the playhead ends, for the grey part of the progress bar. */
  private getBufferedEnd(): number {
    const { buffered, currentTime } = this.video;
    for (let i = 0; i < buffered.length; i++) {
      if (buffered.start(i) <= currentTime + 0.5 && buffered.end(i) >= currentTime) return buffered.end(i);
    }
    return currentTime || 0;
  }

  /** Whether the picture from `time` on for the next few seconds is already downloaded, so that going there needs nothing from the network. */
  hasBuffered(time: number, seconds = 3): boolean {
    if (!this.hasSource) return false;
    const { buffered, duration } = this.video;
    const to = Number.isFinite(duration) ? Math.min(time + seconds, duration - 0.1) : time + seconds;
    for (let i = 0; i < buffered.length; i++) {
      // (A little give at the start: the ranges of a stream put together in pieces do not always begin on the exact second.)
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
    const playing = this.hls.currentLevel; // (-1 until a piece plays)
    return {
      levels,
      current: this.lowStart?.highest ?? this.hls.manualLevel, // (the first piece in 480p is not a choice: what plays says it, `active`)
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
        if (t.mode !== "disabled" && !isHeld(t)) current = i; // (a held track is loaded for the aligner, not chosen)
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

  /** The video is over with `code` for the viewer, and `detail` (what was hit, short, never a link) for the server's log. */
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

    // Remove any attached text tracks
    while (this.video.firstChild) {
      this.video.removeChild(this.video.firstChild);
    }

    this.corsTrial = false;
    this.video.removeAttribute("crossorigin");
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
