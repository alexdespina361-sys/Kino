import { normalizeLang } from "../../shared";
import { CueEditor, type EditableCue } from "./apply";
import { AudioFeed } from "./audio";
import type { Backend } from "./backend";
import { pairCaptions, timeFromEnglish } from "./bridge";
import type { Cue } from "./cues";
import { hasNoLanguage, hold, isHeld, release } from "./hold";
import { bestAlternative, EVIDENCE_SECONDS, MAX_TESTS, MIN_SECONDS, MIN_WORDS, RETEST_GROWTH, verdict, type Verdict } from "./pick";
import { nextWindow, rest, WINDOW } from "./schedule";
import { Borrowed, Lent, timingKeys, type Sent, type Shared } from "./share";
import { mergeRanges, SAMPLE_RATE, type Range } from "./signals";
import type { Outcome } from "./solve";
import { alignerStats as stats, resetAlignerStats } from "./stats";
import type { AudioTap, HlsEvents } from "./tap";
import type { Recogniser } from "./whistle";

/** What the aligner is doing, for the menus: off (the viewer's choice), on and waiting for something to time, timing, timed, or not possible here. */
export type SyncStatus = "off" | "ready" | "syncing" | "synced" | "unavailable";

/** The parts of the page's `<video>` and its subtitle tracks that this uses (the browser's own objects have them; tests use stand-ins). */
export interface CueLike extends EditableCue {
  readonly text: string;
}
export interface TrackLike {
  readonly kind: string;
  readonly language: string;
  readonly label: string;
  mode: "disabled" | "hidden" | "showing";
  readonly cues: ArrayLike<CueLike> | null;
}
export interface VideoLike {
  readonly currentTime: number;
  /** The film's length; NaN until the player knows it. */
  readonly duration: number;
  readonly playbackRate: number;
  readonly textTracks: ArrayLike<TrackLike>;
}
/** What hls.js says of a sound track (its list of them, and the event for a switch to one). */
interface AudioInfo {
  lang?: string;
  name?: string;
}
export interface HlsLike extends HlsEvents {
  readonly audioTracks?: ReadonlyArray<AudioInfo>;
  readonly audioTrack?: number;
  /** Subtitles that come in the stream itself are hls.js's to draw; only the files the page loads itself are timed here. */
  readonly subtitleTracks?: ReadonlyArray<unknown>;
}

export interface SessionDeps {
  video: VideoLike;
  hls: HlsLike;
  /** hls.js's name for the event this listens to. */
  events: { audioSwitching: string };
  /** The film's sound as the player downloads it. The player owns it (it has been listening since the film began): this takes the pieces for as long as it runs. */
  tap: AudioTap;
  /** Puts subtitle track `id` (the number the menus use) on screen. */
  show(id: number): void;
  backend(): Promise<Backend>;
  recogniser(): Promise<Recogniser>;
  decode(bytes: Uint8Array): Promise<Float32Array>;
  report(status: SyncStatus): void;
  /** The viewer's own subtitle delay: a line is on screen when the picture is that far past its time. */
  delay?(): number;
  /** The timings that screens leave each other (see `share.ts`). Without it nothing is borrowed or left. */
  shared?: Shared;
  /** Processors of the device; the recogniser takes less of a small one. */
  cores?: number;
  now?(): number;
  log?(message: string): void;
}

/** How far past the newest words heard the solve looks (the voice detector has the sound there, and a line is placed by its end). */
const SOLVE_AHEAD = 12;
/** Without the recogniser a solve is made each time the sound has grown by this much. */
const SOLVE_STEP = 15;
/** A track that is chosen is solved from this far behind the picture. */
const CATCH_UP = 90;
/** The other English tracks tried when the one on screen is not right. */
const MAX_CANDIDATES = 4;
/** The tracks that were asked for have this long to load before the test goes on without them. */
const LOAD_WAIT_MS = 15_000;
/** A track is changed in a gap between lines; if there is none for this long, in the middle of one. */
const SWITCH_WAIT_MS = 30_000;
const IDLE_MS = 500;
const TICK_MS = 500;
/** The voice detector must get through sound this much faster than the picture plays it, or the aligner is no use on this device. */
const MAX_BUSY_SHARE = 0.8;
/** The track's lines must have kept the same count for this many looks (a file arrives in pieces) before they are taken. */
const STABLE_LOOKS = 2;
/** A timing that another screen left is checked against this screen's own work for this long before the recogniser (a download of 17 MB) starts anyway. */
const BORROW_WAIT_MS = 45_000;
/** What this screen has found is left for the others every so often, when there are this many lines to leave (and a few will do when the page is closing). */
const LEND_EVERY_MS = 180_000;
const LEND_MIN = 10;
const LEND_MIN_LAST = 3;
/** A page that is closing may send little (the browser allows 64 KB for all such requests): the first lines of what is left. */
const LEND_MAX_LAST = 1500;

/** Everything the session knows about one subtitle track it works with. */
interface Followed {
  key: string;
  track: TrackLike;
  /** The number the menus use for it. */
  id: number;
  english: boolean;
  editor: CueEditor<CueLike>;
  /** The lines as the file gave them. */
  cues: Cue[];
  /** Where each line is planned to be: the file's time, moved by what is known of the track. */
  placed: Cue[];
  /** Lines a solve has placed (the others only carry the track's general shift). */
  solved: Set<number>;
  /** Stretches of the picture a solve has covered. */
  coverage: Range[];
  /** Video time minus the file's time, as far as the solver knows it. */
  offset: number | null;
  /** The shift is known well enough to move lines no solve has reached (words agreed with it, or the voice detector did three times). */
  trusted: boolean;
  agreed: number;
  /** The shift written to the lines no solve has placed yet. */
  appliedOffset: number;
  /** The worker follows this track. */
  registered: boolean;
  /** Lines that were placed with the recogniser's words (or timed from an English track that had them), as against the voice detector alone. */
  worded: Set<number>;
  /** The names a timing of this file is kept under, whether one has been asked for, and when the lines were taken (the recogniser waits for the answer from then on). */
  keys: string[] | undefined;
  asked: "no" | "looking" | "done";
  seenAt: number;
  /** The timing another screen left for this file, being checked against what this screen hears, and whether its lines have been put in place. */
  borrowed: Borrowed | undefined;
  believed: boolean;
  /** What this screen placed itself, to leave for the others. Only a track that is known to be this film's is left (`verified`), now and then (`lentAt`). */
  lent: Lent;
  verified: boolean;
  lentAt: number;
  /** The name it is left under: the one a timing was found under, else the first of `keys`. Not any more once the server has refused what was sent (`refused`). */
  leaveAs: string | undefined;
  refused: boolean;
}

interface Job {
  follow: Followed;
  end: number;
}

interface Bridge {
  reference: Followed;
  pairing: { match: Int32Array; share: number };
  /** For each line of the track on screen, the nearest one that is paired to the reference. */
  nearest: Int32Array;
}

// (A track the provider gave no language is not known to be English, though the page labels it so.)
const isEnglish = (track: TrackLike): boolean => normalizeLang(track.language) === "en" && !hasNoLanguage(track);

/** Which sound track this is, by what hls.js says of it (undefined when it says nothing). */
const audioKey = (info: AudioInfo | undefined): string | undefined => (info && (info.lang !== undefined || info.name !== undefined) ? `${info.lang ?? ""}|${info.name ?? ""}` : undefined);

/**
 * Times the subtitles of one film to its sound while it plays. It listens to the sound as the player downloads it (`AudioTap`), keeps a
 * map of where there is speech (the voice detector, in a worker), has a speech recogniser write down words from a window at a time
 * (English only), and has the aligner place the lines of the track on screen against both. It also checks that the track is the right
 * one: if most of what is said is not in it, another English release of the film replaces it, between two lines. A track in another
 * language is timed from the English one (the same film, so the same cuts), when the film has one.
 *
 * Nothing here needs the viewer: it starts with the film, works through what the player has downloaded, and moves lines only by
 * the little that is needed (a line on screen waits until it is off). And it costs nothing while there is nothing to time: the sound
 * is only kept (a little) until a subtitle track is on screen, and only then decoded and listened to.
 */
export class SyncSession {
  private readonly feed: AudioFeed;
  private backend: Backend | undefined;
  /** The worker has been asked for (`awake`). */
  private ready: Promise<void> | undefined;
  private recogniser: Recogniser | undefined;
  private recogniserStarting = false;
  private recogniserFailed = false;
  private recogniserErrors = 0;
  private restUntil = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private wake: (() => void) | undefined;
  private closed = false;
  private restored = false;
  private unavailable = false;
  private errors = 0;
  private lastStatus: SyncStatus | undefined;
  /** Which sound track is playing, and how many times the sound has been started over (work that began before a start over is not taken after it). */
  private audioId: string | undefined;
  private epoch = 0;

  /** Sound handed to the voice detector, and how long it took, to see whether the device keeps up. */
  private audioSeconds = 0;
  private audioMs = 0;

  /** What the recogniser has done. */
  private heard: Range[] = [];
  private heardEnds: number[] = [];
  private heardWords = 0;
  private heardSeconds = 0;
  private speed = 1;
  private listeningUseless = false;

  private readonly followed = new Map<TrackLike, Followed>();
  private readonly seen = new Map<TrackLike, { count: number; looks: number }>();
  private nextKey = 1;
  /** The track on screen, and (once its lines have loaded) what is known of it. */
  private shown: TrackLike | undefined;
  private everShown = false;
  private current: Followed | undefined;
  private bridge: Bridge | undefined;
  /** Tracks other than the one on screen that are loaded to be tried, and since when they have been asked for. */
  private readonly wanted = new Set<TrackLike>();
  private wantedSince = 0;

  private jobs: Job[] = [];
  private queued = new Map<Followed, number>();

  /** Whether the viewer chose a track themselves after the first one (then it is theirs: no switching). */
  private manual = false;
  private expected: number | undefined;
  private switchTo: { id: number; since: number } | undefined;
  private tests = 0;
  private lastTestWords = 0;
  /** The seconds the recogniser had heard when a test last found too little to say anything. */
  private waitedAt = -1;
  private wrongRounds = 0;
  /** The track that has just been put on screen by the aligner was found right. */
  private verifiedNext = false;

  constructor(private readonly deps: SessionDeps) {
    resetAlignerStats();
    stats.started = true;
    this.feed = new AudioFeed({
      decode: async (bytes) => {
        const started = this.clock();
        const pcm = await deps.decode(bytes);
        stats.pieces++;
        stats.decodedSeconds += pcm.length / SAMPLE_RATE;
        stats.decodeMs += this.clock() - started;
        return pcm;
      },
      sink: (time, pcm) => this.sound(time, pcm),
      playhead: () => deps.video.currentTime,
      unreadable: () => this.giveUp("The sound of this film cannot be read here"),
    });
    // (Nothing is decoded, and the worker and the voice detector's weights are not fetched, until a subtitle track is on screen: see `awake`. What the player downloads before that is kept, a little, for then.)
    this.feed.pause(true);
    this.audioId = audioKey(deps.hls.audioTracks?.[deps.hls.audioTrack ?? 0]);
    deps.tap.connect((piece) => this.feed.push(piece));
    deps.hls.on(deps.events.audioSwitching, this.audioListener);
  }

  /** The worker of the voice detector (with its weights, a download of 1.2 MB), started when there is a subtitle track on screen to time, and not before. */
  private awake(): Promise<void> {
    this.ready ??= this.deps.backend().then(
      (backend) => {
        if (this.closed) backend.close();
        else this.backend = backend;
      },
      (error: unknown) => this.giveUp(`The aligner could not start: ${describe(error)}`),
    );
    return this.ready;
  }

  /** Runs by itself: checks the tracks twice a second and works through what there is to do. */
  start(): void {
    this.timer = setInterval(() => this.guarded(() => this.tick()), TICK_MS);
    void this.loop();
  }

  /** Resolves when everything the player has handed over so far has been through the voice detector (pieces kept while no subtitles are on are not waited for). */
  async settle(): Promise<void> {
    await this.ready;
    await this.feed.idle();
  }

  /**
   * Stops. The lines go back to the file's times when `restore` (the viewer turned the aligner off), else stay where they are. A viewer
   * who turns it off after it gave up on its own gets the lines back too.
   */
  close(restore = false): void {
    if (!this.closed) {
      this.lend(true);
      this.closed = true;
      clearInterval(this.timer);
      this.wake?.();
      this.deps.tap.disconnect();
      this.deps.hls.off(this.deps.events.audioSwitching, this.audioListener);
      this.feed.reset();
      this.recogniser?.close();
      this.backend?.close();
      for (const track of this.wanted) this.letGo(track);
      this.wanted.clear();
    }
    if (restore && !this.restored) {
      this.restored = true;
      for (const follow of this.followed.values()) follow.editor.restore();
    }
    this.report();
  }

  /* ------------------------------------ the loop ------------------------------------ */

  private async loop(): Promise<void> {
    while (!this.closed) {
      let did = false;
      try {
        did = await this.work();
        this.errors = 0;
      } catch (error) {
        this.deps.log?.(`work: ${describe(error)}`);
        if (++this.errors >= 5) this.giveUp("The aligner keeps failing");
      }
      if (this.closed) break;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
        setTimeout(resolve, did ? 0 : IDLE_MS);
      });
    }
  }

  private guarded(run: () => void): void {
    try {
      run();
    } catch (error) {
      this.deps.log?.(`tick: ${describe(error)}`);
      if (++this.errors >= 5) this.giveUp("The aligner keeps failing");
    }
  }

  /** The quick part: the tracks the page has, the lines waiting to move, a track to change to. */
  tick(): void {
    if (this.closed) return;
    this.syncTracks();
    if (this.current) {
      this.borrow(this.current);
      this.lend(false);
    }
    this.current?.editor.flush(this.shownAt());
    this.maybeSwitch();
    this.report();
  }

  /** One piece of the slow part: a solve, a window for the recogniser, or a test of the tracks. False when there was nothing to do. */
  async work(): Promise<boolean> {
    if (this.closed || this.unavailable || !this.ready) return false;
    await this.ready;
    if (!this.backend || this.closed) return false;
    this.kickRecogniser();
    if (await this.solveOnce()) return true;
    if (await this.listenOnce()) return true;
    return this.judgeOnce();
  }

  /* ------------------------------------ the sound ------------------------------------ */

  private readonly audioListener = (_event: string, data: never): void => {
    // Another audio track (a dub, a commentary) is another sound: what was heard is of the one before. The same one again is not (hls.js
    // says so too when it moves to a variant of the film that has its audio in another group), and starting over for it would waste the work.
    // (The init segments are kept either way: the player does not always send them again, and the pieces can't be read without them.)
    const next = audioKey(data as unknown as AudioInfo | undefined) ?? audioKey(this.deps.hls.audioTracks?.[this.deps.hls.audioTrack ?? 0]);
    if (next !== undefined && next === this.audioId) return;
    this.audioId = next;
    this.epoch++;
    this.feed.reset();
    this.heard = [];
    this.heardEnds = [];
    this.heardWords = 0;
    this.heardSeconds = 0;
    this.jobs = [];
    this.queued.clear();
    this.tests = 0;
    this.lastTestWords = 0;
    this.waitedAt = -1;
    this.wrongRounds = 0;
    this.listeningUseless = false;
    this.bridge = undefined;
    for (const follow of this.followed.values()) {
      follow.solved.clear();
      follow.coverage = [];
      follow.offset = null;
      follow.trusted = false;
      follow.agreed = 0;
      follow.registered = false;
      // (Another sound is another timing: what was borrowed or is to be left was for the one before.)
      follow.worded.clear();
      follow.keys = undefined;
      follow.leaveAs = undefined;
      follow.refused = false;
      follow.asked = "no";
      follow.borrowed = undefined;
      follow.believed = false;
      follow.lent = new Lent();
      follow.verified = false;
    }
    void this.backend?.reset().catch(() => {});
    if (this.current) void this.register(this.current);
  };

  private async sound(time: number, pcm: Float32Array): Promise<void> {
    const epoch = this.epoch;
    await this.ready;
    const backend = this.backend;
    if (!backend || this.closed || epoch !== this.epoch) return;
    const seconds = pcm.length / SAMPLE_RATE;
    try {
      this.audioMs += await backend.addAudio(time, pcm);
      this.audioSeconds += seconds;
      stats.vadSeconds = this.audioSeconds;
      stats.vadMs = this.audioMs;
    } catch (error) {
      this.giveUp(`The voice detector failed: ${describe(error)}`);
      return;
    }
    if (this.audioSeconds >= 60 && this.audioMs > this.audioSeconds * 1000 * MAX_BUSY_SHARE) {
      this.giveUp("This device cannot keep up with the voice detector");
      return;
    }
    this.noteSound();
  }

  /** Without the recogniser, new sound is the reason to solve again. */
  private noteSound(): void {
    if (this.listening()) return;
    const end = this.coveredEnd();
    for (const follow of this.solving()) {
      if (end - (this.queued.get(follow) ?? -Infinity) >= SOLVE_STEP) this.queue(follow, end);
    }
  }

  private coveredEnd(): number {
    const covered = this.feed.ranges();
    const at = this.deps.video.currentTime;
    const around = covered.find((r) => r.from <= at + 1 && r.to >= at - 1) ?? covered[covered.length - 1];
    return around?.to ?? 0;
  }

  /* ------------------------------------ the recogniser ------------------------------------ */

  /** Whether words are of any use: a track in English to compare them with, over sound that may be English. */
  private wantsWords(): boolean {
    if (this.recogniserFailed || this.listeningUseless || !this.current) return false;
    if (!this.audioMayBeEnglish() || this.borrowedHolds(this.current)) return false;
    return this.current.english || this.englishTracks().length > 0;
  }

  private audioLanguage(): string | undefined {
    const { audioTracks, audioTrack } = this.deps.hls;
    return normalizeLang(audioTracks?.[audioTrack ?? 0]?.lang);
  }

  private audioMayBeEnglish(): boolean {
    const lang = this.audioLanguage();
    return lang === undefined || lang === "en" || lang === "und" || lang === "mul";
  }

  /**
   * The recogniser (a download of 17 MB) waits for the answer to the question whether another screen left a timing of this file, and while one
   * is being checked (for a while at most), and is not needed at all when a believed one places the whole file.
   */
  private borrowedHolds(follow: Followed): boolean {
    if (!this.deps.shared) return false;
    const borrowed = follow.borrowed;
    if (borrowed?.state === "trusted") return borrowed.complete();
    if (borrowed?.state === "rejected" || (!borrowed && follow.asked === "done")) return false;
    return this.clock() - follow.seenAt < BORROW_WAIT_MS;
  }

  private listening(): boolean {
    return this.recogniser !== undefined && this.wantsWords();
  }

  private kickRecogniser(): void {
    if (this.recogniser || this.recogniserStarting || !this.wantsWords()) return;
    // (Where a believed timing places everything near the picture there is nothing to listen to yet, and the recogniser is not fetched before there is.)
    if (this.current?.borrowed?.state === "trusted" && this.nextToHear() === undefined) return;
    this.recogniserStarting = true;
    stats.recogniser = "starting";
    this.deps.recogniser().then(
      (recogniser) => {
        this.recogniserStarting = false;
        if (this.closed) recogniser.close();
        else {
          this.recogniser = recogniser;
          stats.recogniser = "running";
        }
      },
      (error: unknown) => {
        this.recogniserStarting = false;
        this.recogniserFailed = true;
        stats.recogniser = "failed";
        this.deps.log?.(`recogniser: ${describe(error)}`);
      },
    );
  }

  /** Gives the recogniser the next window, if there is one it can finish before the picture gets there. */
  private async listenOnce(): Promise<boolean> {
    const recogniser = this.recogniser;
    const backend = this.backend;
    if (!recogniser || !backend || !this.wantsWords() || this.clock() < this.restUntil) return false;
    const playhead = this.deps.video.currentTime;
    const from = this.nextToHear();
    if (from === undefined) return false;
    const pcm = this.feed.pcm(from, from + WINDOW);
    if (!pcm) return false;
    const started = this.clock();
    const epoch = this.epoch;
    try {
      const words = await recogniser.hear(pcm);
      const busy = this.clock() - started;
      // (Closed meanwhile, or the sound was started over: these words are of the one before.)
      if (this.closed || epoch !== this.epoch) return true;
      this.recogniserErrors = 0;
      const absolute = words.map((word) => ({ ...word, start: word.start + from, end: word.end + from }));
      await backend.addWords(absolute, from, from + WINDOW);
      // (The sound may have been started over while the words were being handed on: they were reset with it.)
      if (this.closed || epoch !== this.epoch) return true;
      this.heard = mergeRanges([...this.heard, { from, to: from + WINDOW }]);
      this.heardEnds.push(from + WINDOW);
      this.heardWords += words.length;
      this.heardSeconds += WINDOW;
      const measured = WINDOW / Math.max(0.05, busy / 1000);
      this.speed = this.heardEnds.length === 1 ? measured : 0.5 * this.speed + 0.5 * measured;
      stats.windows++;
      stats.words = this.heardWords;
      stats.heardSeconds = this.heardSeconds;
      stats.speed = this.speed;
      for (const follow of this.solving()) this.queue(follow, from + WINDOW + SOLVE_AHEAD);
      // (The recogniser works for a share of the time and leaves the rest to the picture; more of it when the picture is about to need the words.)
      const near = from - playhead < 30;
      const duty = (this.deps.cores ?? 4) <= 2 ? (near ? 0.5 : 0.3) : near ? 0.8 : 0.5;
      this.restUntil = this.clock() + rest(busy, duty);
    } catch (error) {
      // (A recogniser that was closed under the work is the viewer's doing, not a failure.)
      if (this.closed || epoch !== this.epoch) return true;
      this.deps.log?.(`hear: ${describe(error)}`);
      // (A window that fails is left behind; a recogniser that keeps failing is given up on.)
      this.heard = mergeRanges([...this.heard, { from, to: from + WINDOW }]);
      if (++this.recogniserErrors >= 3) {
        this.recogniserFailed = true;
        stats.recogniser = "failed";
        this.recogniser?.close();
        this.recogniser = undefined;
      }
    }
    return true;
  }

  /** Where the recogniser would listen next. What a believed timing places is not listened to again. */
  private nextToHear(): number | undefined {
    const done = this.current?.borrowed?.state === "trusted" ? mergeRanges([...this.heard, ...this.current.borrowed.ranges()]) : this.heard;
    return nextWindow({ playhead: this.deps.video.currentTime, rate: this.deps.video.playbackRate || 1, covered: this.feed.ranges(), heard: done, speed: this.speed });
  }

  private clock(): number {
    return this.deps.now ? this.deps.now() : performance.now();
  }

  /* ------------------------------------ the tracks ------------------------------------ */

  private englishTracks(): Array<{ track: TrackLike; id: number }> {
    const out: Array<{ track: TrackLike; id: number }> = [];
    const list = this.deps.video.textTracks;
    for (let id = 0; id < list.length; id++) {
      const track = list[id] as TrackLike;
      if (track.kind === "subtitles" && isEnglish(track)) out.push({ track, id });
    }
    return out;
  }

  /** Finds the track on screen, makes sure the ones that are wanted are loaded (and kept off screen), and takes the lines of those that have loaded. */
  private syncTracks(): void {
    if ((this.deps.hls.subtitleTracks?.length ?? 0) > 0) {
      this.giveUp("The subtitles of this film come in its stream");
      return;
    }
    const list = this.deps.video.textTracks;
    let shown: { track: TrackLike; id: number } | undefined;
    for (let id = 0; id < list.length && !shown; id++) {
      const track = list[id] as TrackLike;
      if (track.kind === "subtitles" && track.mode !== "disabled" && !isHeld(track)) shown = { track, id };
    }
    if (shown?.track !== this.shown) {
      const first = this.shown === undefined && !this.everShown;
      this.shown = shown?.track;
      if (shown) {
        this.everShown = true;
        this.chosen(shown.track, shown.id, first);
      } else this.lost();
    }

    // Tracks that were asked for are loaded the way the shown one is: hidden, which makes the browser fetch the file. Once their lines are taken they are switched off again.
    for (const track of this.wanted) {
      if (track.mode === "disabled" && !this.followed.has(track)) {
        hold(track);
        track.mode = "hidden";
      }
    }
    for (let id = 0; id < list.length; id++) {
      const track = list[id] as TrackLike;
      const isShown = shown?.track === track;
      if (!isShown && !this.wanted.has(track)) continue;
      const follow = this.take(track, id);
      if (!follow) continue;
      if (isShown) {
        if (this.current !== follow) this.adopt(follow);
      } else this.letGo(track);
    }
  }

  /** The lines of a track once it has finished loading (the count stopped growing), and again if more of them come. */
  private take(track: TrackLike, id: number): Followed | undefined {
    const cues = track.cues;
    const count = cues?.length ?? 0;
    const known = this.followed.get(track);
    if (known) {
      known.id = id;
      // (A track that is switched off has no list to compare: what was taken stays.)
      if (!cues || count === known.cues.length) return known;
    }
    if (!cues || count === 0) return undefined;
    const looked = this.seen.get(track);
    if (!looked || looked.count !== count) {
      this.seen.set(track, { count, looks: 1 });
      return undefined;
    }
    if (++looked.looks < STABLE_LOOKS) return undefined;

    const list = Array.from({ length: count }, (_, i) => cues[i] as CueLike);
    const editor = new CueEditor(list, known?.editor.snapshot());
    if (known) this.forget(known);
    const lines: Cue[] = list.map((cue, i) => ({ start: editor.original(i).start, end: editor.original(i).end, text: cue.text }));
    const follow: Followed = {
      key: `t${this.nextKey++}`,
      track,
      id,
      english: isEnglish(track),
      editor,
      cues: lines,
      placed: lines.map((line) => ({ ...line })),
      solved: new Set(),
      coverage: [],
      offset: null,
      trusted: false,
      agreed: 0,
      appliedOffset: 0,
      registered: false,
      worded: new Set(),
      keys: undefined,
      asked: "no",
      seenAt: this.clock(),
      borrowed: undefined,
      believed: false,
      lent: new Lent(),
      verified: false,
      lentAt: 0,
      leaveAs: undefined,
      refused: false,
    };
    this.followed.set(track, follow);
    return follow;
  }

  private forget(follow: Followed): void {
    this.followed.delete(follow.track);
    this.jobs = this.jobs.filter((job) => job.follow !== follow);
    this.queued.delete(follow);
    if (follow.registered) void this.backend?.dropTrack(follow.key).catch(() => {});
    if (this.current === follow) this.current = undefined;
    if (this.bridge?.reference === follow) this.bridge = undefined;
  }

  /** Another track is on screen: the viewer put it there, or the first one came up with the film, or the aligner changed it. */
  private chosen(track: TrackLike, id: number, first: boolean): void {
    const automatic = this.expected === id;
    this.expected = undefined;
    this.switchTo = undefined;
    this.current = undefined;
    this.bridge = undefined;
    this.releaseWanted();
    if (!automatic && !first) this.manual = true;
    // (A track the aligner changed to has just been found right.)
    this.verifiedNext = automatic;
    this.tests = automatic ? 1 : 0;
    this.lastTestWords = automatic ? this.heardWords : 0;
    this.waitedAt = -1;
    this.wrongRounds = 0;
    // A track in another language is timed from an English one: that one is loaded at once.
    if (!isEnglish(track)) this.wantEnglish(1);
    // There is something to time now: the worker starts, and the sound that was kept is decoded.
    void this.awake();
    this.feed.pause(false);
  }

  /** There is no track on screen any more (subtitles were turned off): the sound is kept again, and not decoded. */
  private lost(): void {
    this.current = undefined;
    this.bridge = undefined;
    this.switchTo = undefined;
    this.releaseWanted();
    this.feed.pause(true);
  }

  /** A track on screen whose lines have loaded: the aligner starts on it. */
  private adopt(follow: Followed): void {
    this.current = follow;
    this.queued.delete(follow);
    if (this.verifiedNext) this.verify(follow);
    this.paint(follow);
    this.noteLines();
    void this.register(follow).then(() => {
      if (this.current === follow && !this.closed) this.catchUp(follow);
    });
  }

  /**
   * Puts the lines the aligner placed while the track was not on screen (subtitles were off for a while, or it was the English track
   * another was timed from) where it placed them: what is solved is written to the lines only while the track is shown.
   */
  private paint(follow: Followed): void {
    const now = this.shownAt();
    follow.cues.forEach((line, index) => {
      const at = follow.placed[index];
      if (at && (at.start !== line.start || at.end !== line.end)) follow.editor.place(index, at.start, at.end, now);
    });
  }

  private idOf(track: TrackLike): number | undefined {
    const list = this.deps.video.textTracks;
    for (let id = 0; id < list.length; id++) if (list[id] === track) return id;
    return undefined;
  }

  /** The numbers for the debug panel that come from the track on screen. */
  private noteLines(): void {
    stats.lines = this.current?.cues.length ?? 0;
    stats.placed = this.current?.solved.size ?? 0;
    stats.bridged = this.bridge !== undefined;
    stats.shared = this.sharedState(this.current);
  }

  /** For the debug panel: where the timing from other screens stands for a track. */
  private sharedState(follow: Followed | undefined): string {
    if (!this.deps.shared || !follow) return "";
    if (follow.borrowed) return follow.borrowed.state === "trusted" && follow.borrowed.complete() ? "believed (all of it)" : follow.borrowed.state === "trusted" ? "believed (part)" : follow.borrowed.state;
    return follow.asked === "no" ? "waiting" : follow.asked === "looking" ? "asking" : "none found";
  }

  private async register(follow: Followed): Promise<void> {
    await this.ready;
    if (!this.backend || this.closed || follow.registered) return;
    follow.registered = true;
    await this.backend.setTrack(follow.key, follow.cues, follow.english);
  }

  /** The tracks that are worked on now: the shown one, or (when it is timed from an English one) that English one. */
  private solving(): Followed[] {
    if (!this.current) return [];
    return this.bridge ? [this.bridge.reference] : [this.current];
  }

  /** Solves for the sound that has been heard already, from a little behind the picture on (a track that has just been chosen has none yet). */
  private catchUp(follow: Followed): void {
    const from = this.deps.video.currentTime - CATCH_UP;
    const ends = this.heardEnds.filter((end) => end >= from).map((end) => end + SOLVE_AHEAD);
    if (ends.length === 0) ends.push(this.coveredEnd());
    for (const end of ends) if (end > 0) this.queue(follow, end);
  }

  private queue(follow: Followed, end: number): void {
    if (this.jobs.some((job) => job.follow === follow && Math.abs(job.end - end) < 4)) return;
    this.jobs.push({ follow, end });
    this.queued.set(follow, Math.max(this.queued.get(follow) ?? -Infinity, end));
  }

  /** Asks for English tracks other than the one on screen to be loaded, up to `count` more. */
  private wantEnglish(count: number): void {
    for (const { track } of this.englishTracks()) {
      if (count <= 0 || this.wanted.size >= MAX_CANDIDATES) break;
      if (this.wanted.has(track) || track === this.shown) continue;
      this.wanted.add(track);
      count--;
    }
    this.wantedSince = this.clock();
  }

  private releaseWanted(): void {
    for (const track of this.wanted) this.letGo(track);
    this.wanted.clear();
  }

  /** A track that was only loaded for the aligner goes back to off (the track on screen is never touched). */
  private letGo(track: TrackLike): void {
    if (!isHeld(track)) return;
    release(track);
    if (track !== this.shown) track.mode = "disabled";
  }

  /* ------------------------------------ solving ------------------------------------ */

  private async solveOnce(): Promise<boolean> {
    const backend = this.backend;
    if (!backend) return false;
    // (Oldest first: a solve leaves the start of its window to the one before it, which saw that sound with more around it.)
    this.jobs.sort((a, b) => a.end - b.end);
    const job = this.jobs.shift();
    if (!job) return false;
    if (this.followed.get(job.follow.track) !== job.follow) return true;
    // (A solve looks a little past the newest words; early in a film, or after a jump, the sound does not reach that far.)
    const end = this.reachable(job.end);
    if (end === undefined) return true;
    const epoch = this.epoch;
    await this.register(job.follow);
    const outcome = await backend.solve(job.follow.key, end);
    // (Not one that was begun on the sound before the last start over.)
    if (outcome && !this.closed && epoch === this.epoch && this.followed.get(job.follow.track) === job.follow) this.absorb(job.follow, outcome);
    return true;
  }

  /** `end`, or where the sound that reaches nearest to it stops, whichever is earlier; undefined when there is none before it. */
  private reachable(end: number): number | undefined {
    let reach: number | undefined;
    for (const range of this.feed.ranges()) if (range.from <= end && (reach === undefined || range.to > reach)) reach = range.to;
    return reach === undefined ? undefined : Math.min(end, reach);
  }

  /** Writes what a solve found: lines it placed go there, the others get the track's general shift. */
  private absorb(follow: Followed, outcome: Outcome): void {
    if (outcome.method === "whistle+silero") follow.trusted = true;
    else if (outcome.method === "silero" && outcome.shift !== null) {
      follow.agreed = follow.offset !== null && Math.abs(outcome.shift - follow.offset) < 0.5 ? follow.agreed + 1 : 0;
      if (follow.agreed >= 3) follow.trusted = true;
    }
    follow.offset = outcome.shift;
    const words = outcome.method === "whistle+silero";
    // (What this screen hears is held up against a timing another screen left, and once they agree that timing is put in place.)
    follow.borrowed?.check(outcome.updates);
    this.believe(follow);
    // (The lines of a believed timing are not made worse by the voice detector alone, which on real sound is a second or three off the words
    // and now and then four or five on a line: they stay as the timing has them - unless the whole stretch this solve covers is far from the
    // timing, as with another cut further on, and then what this screen hears goes.)
    const kept = !words && follow.borrowed?.state === "trusted" && follow.borrowed.agrees(outcome.updates) !== false ? follow.borrowed : undefined;
    const now = this.shownAt();
    const onScreen = follow === this.current && !this.bridge;
    let from = Infinity;
    let to = -Infinity;
    for (const update of outcome.updates) {
      const line = follow.cues[update.index];
      if (!line) continue;
      if (kept?.at(update.index)) continue;
      follow.placed[update.index] = { start: update.start, end: update.end, text: line.text };
      follow.solved.add(update.index);
      if (words) follow.worded.add(update.index);
      if (onScreen) {
        follow.editor.place(update.index, update.start, update.end, now);
        follow.lent.note(update.index, line, update.start, update.end, words);
      }
      from = Math.min(from, update.start);
      to = Math.max(to, update.end);
    }
    if (to > from) follow.coverage = mergeRanges([...follow.coverage, { from, to }]);
    if (follow === this.current) this.carryShift(follow);
    if (this.bridge?.reference === follow) this.applyBridge();
    stats.solves++;
    this.noteLines();
  }

  /** Lines no solve has reached yet take the shift learned so far, so that a seek into new ground finds the track about right at once. */
  private carryShift(follow: Followed): void {
    if (!follow.trusted || follow.offset === null || Math.abs(follow.offset - follow.appliedOffset) < 0.25) return;
    const shift = follow.offset;
    follow.appliedOffset = shift;
    const now = this.shownAt();
    follow.cues.forEach((line, index) => {
      if (follow.solved.has(index)) return;
      const start = Math.max(0, line.start + shift);
      const end = Math.max(start + 0.05, line.end + shift);
      follow.placed[index] = { start, end, text: line.text };
      if (follow === this.current) follow.editor.place(index, start, end, now);
    });
  }

  /** The track on screen follows the English one's times, line for line, where the English one has been placed. */
  private applyBridge(): void {
    const bridge = this.bridge;
    const follow = this.current;
    if (!bridge || !follow) return;
    const timed = timeFromEnglish(follow.cues, { original: bridge.reference.cues, placed: bridge.reference.placed }, bridge.pairing);
    if (!timed) return;
    const now = this.shownAt();
    let from = Infinity;
    let to = -Infinity;
    const placed: Array<{ index: number; start: number }> = [];
    const moves: number[] = [];
    timed.cues.forEach((cue, index) => {
      const anchor = bridge.nearest[index] ?? -1;
      const reference = anchor >= 0 ? (bridge.pairing.match[anchor] ?? -1) : -1;
      if (reference < 0 || !bridge.reference.solved.has(reference)) return;
      follow.placed[index] = cue;
      follow.solved.add(index);
      follow.worded.add(index);
      follow.editor.place(index, cue.start, cue.end, now);
      follow.lent.note(index, follow.cues[index] as Cue, cue.start, cue.end, true);
      placed.push({ index, start: cue.start });
      moves.push(cue.start - (follow.cues[index] as Cue).start);
      from = Math.min(from, cue.start);
      to = Math.max(to, cue.end);
    });
    if (to > from) follow.coverage = mergeRanges([...follow.coverage, { from, to }]);
    follow.borrowed?.check(placed);
    this.believe(follow);
    // The lines no solve has reached take this track's own shift: the typical move of the lines it was just given. (Not the English track's,
    // which is another file: it may be late where this one is right, and then every line ahead would be moved from where it was right.)
    if (moves.length > 0) follow.offset = moves.sort((a, b) => a - b)[moves.length >> 1] as number;
    follow.trusted = follow.trusted || bridge.reference.trusted;
    this.carryShift(follow);
  }

  /* ------------------------------------ is it the right track? ------------------------------------ */

  /**
   * Once enough has been heard (and again when it has more than doubled): how much of what is said is in the track on screen. If most of
   * it is not, the other English tracks are tried the same way, and a clearly better one replaces it. A track in another language
   * has no words to compare, but pairs with an English one that has been checked, and is timed from that.
   */
  private async judgeOnce(): Promise<boolean> {
    const current = this.current;
    if (!this.backend || !current || !this.recogniser || !this.wantsWords() || current.borrowed?.state === "trusted") return false;
    if (this.heardWords < MIN_WORDS || this.heardSeconds < MIN_SECONDS || this.tests >= MAX_TESTS) return false;
    if (this.tests > 0 && this.heardWords < this.lastTestWords * RETEST_GROWTH) return false;
    // (A test that found too little to say anything is not made again until the recogniser has heard more.)
    if (this.heardSeconds === this.waitedAt) return false;
    return current.english ? this.judgeEnglish(current) : this.judgeOther(current);
  }

  /**
   * How well the words of a track fit what was heard, and what that says. The first test looks at the first minutes that were heard (where a
   * wrong track shows soonest); if they hold too few words to say anything, and never will (the recogniser has been through more than they
   * are, by a quiet opening or by hearing only some of the windows), the newest words are looked at instead.
   */
  private async fit(cues: Cue[], latest: boolean): Promise<{ share: number; state: Verdict; latest: boolean }> {
    const backend = this.backend as Backend;
    let score = await backend.score(cues, latest);
    let state = verdict(score.share, score.words, score.seconds);
    if (state === "waiting" && !latest && this.heardSeconds >= EVIDENCE_SECONDS) {
      latest = true;
      score = await backend.score(cues, true);
      state = verdict(score.share, score.words, score.seconds);
    }
    if (state === "waiting") this.waitedAt = this.heardSeconds;
    return { share: score.share, state, latest };
  }

  private async judgeEnglish(current: Followed): Promise<boolean> {
    const backend = this.backend as Backend;
    const { share, state, latest } = await this.fit(current.cues, this.tests > 0);
    if (this.current !== current) return true;
    if (state === "waiting") return false;
    this.noteTest(state, share);
    if (state === "right") {
      this.tests++;
      this.lastTestWords = this.heardWords;
      this.wrongRounds = 0;
      this.verify(current);
      this.releaseWanted();
      return true;
    }
    // Not right. A track the viewer chose themselves stays, whatever the words say (and no other is loaded to be tried).
    if (this.manual) return this.finishTest(state, undefined);
    // Otherwise the other English tracks, once they have loaded.
    if (this.wanted.size === 0) this.wantEnglish(MAX_CANDIDATES);
    if (this.wanted.size === 0) return this.finishTest(state, undefined);
    const loaded = this.loadedWanted();
    if (loaded.length < this.wanted.size && this.clock() - this.wantedSince < LOAD_WAIT_MS) return false;
    const others: Array<{ id: number; share: number }> = [];
    for (const follow of loaded) others.push({ id: this.idOf(follow.track) ?? follow.id, share: (await backend.score(follow.cues, latest)).share });
    if (this.current !== current) return true;
    return this.finishTest(state, bestAlternative(share, others));
  }

  private finishTest(state: "wrong" | "unsure", better: number | undefined): boolean {
    if (this.current) this.current.verified = false;
    this.tests++;
    this.lastTestWords = this.heardWords;
    this.releaseWanted();
    if (better !== undefined && !this.manual) {
      this.switchTo = { id: better, since: this.clock() };
      this.wrongRounds = 0;
    } else {
      this.wrongRounds = state === "wrong" ? this.wrongRounds + 1 : 0;
      this.stopIfUseless();
    }
    return true;
  }

  /** A track in another language: an English track that is right, and pairs with this one, times it. */
  private async judgeOther(current: Followed): Promise<boolean> {
    let latest = this.tests > 0;
    if (this.bridge) {
      // Checked again: the English track it is timed from must still be right.
      const checked = await this.fit(this.bridge.reference.cues, latest);
      if (this.current !== current) return true;
      const state = checked.state;
      if (state === "waiting") return false;
      this.noteTest(state, checked.share);
      this.tests++;
      this.lastTestWords = this.heardWords;
      if (state !== "right") {
        this.bridge = undefined;
        current.verified = false;
        this.noteLines();
        this.wantEnglish(1);
        this.catchUp(current);
      }
      return true;
    }
    if (this.wanted.size === 0) this.wantEnglish(1);
    if (this.wanted.size === 0) return false;
    const loaded = this.loadedWanted();
    if (loaded.length < this.wanted.size && this.clock() - this.wantedSince < LOAD_WAIT_MS) return false;
    let best: { follow: Followed; share: number } | undefined;
    for (const follow of loaded) {
      const scored = await this.fit(follow.cues, latest);
      latest = scored.latest;
      if (this.current !== current) return true;
      if (scored.state === "waiting") return false;
      if (scored.state === "right" && scored.share >= (best?.share ?? 0)) best = { follow, share: scored.share };
    }
    this.tests++;
    this.lastTestWords = this.heardWords;
    if (best) {
      this.bridgeTo(current, best.follow);
      this.releaseWanted();
    } else {
      this.wrongRounds++;
      this.wantEnglish(1);
      this.stopIfUseless();
    }
    return true;
  }

  /** What the last test of a track against the words found, for the debug panel. */
  private noteTest(state: string, share: number): void {
    stats.verdict = state;
    stats.share = share;
    stats.tests = this.tests + 1;
  }

  /** Nothing that is heard is in any track: it is not worth going on listening (the sound is probably not in English). */
  private stopIfUseless(): void {
    if (this.wrongRounds < 2) return;
    this.listeningUseless = true;
    stats.recogniser = "stopped";
    this.recogniser?.close();
    this.recogniser = undefined;
    this.deps.log?.("The words heard fit no track: not listening any more");
  }

  private loadedWanted(): Followed[] {
    const out: Followed[] = [];
    for (const track of this.wanted) {
      const follow = this.followed.get(track);
      if (follow) out.push(follow);
    }
    return out;
  }

  /** Times the track on screen from `reference`, an English track that was found right. */
  private bridgeTo(current: Followed, reference: Followed): void {
    const pairing = pairCaptions(
      current.cues.map((line) => line.start),
      reference.cues.map((line) => line.start),
    );
    if (!pairing) return;
    // For each line, the nearest one (either side) that has a pair.
    const nearest = new Int32Array(current.cues.length).fill(-1);
    let before = -1;
    for (let i = 0; i < nearest.length; i++) {
      if ((pairing.match[i] ?? -1) >= 0) before = i;
      nearest[i] = before;
    }
    let after = -1;
    for (let i = nearest.length - 1; i >= 0; i--) {
      if ((pairing.match[i] ?? -1) >= 0) after = i;
      const earlier = nearest[i] as number;
      if (after >= 0 && (earlier < 0 || after - i < i - earlier)) nearest[i] = after;
    }
    this.bridge = { reference, pairing, nearest };
    this.verify(current);
    stats.bridged = true;
    reference.solved.clear();
    reference.coverage = [];
    reference.registered = false;
    this.queued.delete(reference);
    this.jobs = this.jobs.filter((job) => job.follow !== current);
    void this.register(reference).then(() => this.catchUp(reference));
  }

  /* ------------------------------------ timings from other screens ------------------------------------ */

  /** Asks for the timing that another screen left for the track on screen, once, as soon as the film's length is known. */
  private borrow(follow: Followed): void {
    const shared = this.deps.shared;
    if (!shared || follow.asked !== "no") return;
    const { duration } = this.deps.video;
    const keys = timingKeys({ duration, audio: this.audioLanguage(), cues: follow.cues });
    if (!keys) {
      // (The film's length may not be known yet; if it is, it is the file that is no use for this.)
      if (Number.isFinite(duration) && duration > 0) follow.asked = "done";
      return;
    }
    follow.keys = keys;
    follow.asked = "looking";
    void this.ask(shared, follow, keys);
  }

  private async ask(shared: Shared, follow: Followed, keys: string[]): Promise<void> {
    let timing;
    let foundAs: string | undefined;
    for (const key of keys) {
      timing = await shared.get(key).catch(() => undefined);
      if (timing) foundAs = key;
      if (timing || this.closed || follow.keys !== keys) break;
    }
    // (The sound may have changed, or the track been replaced, while the server was asked.)
    if (this.closed || follow.keys !== keys || this.followed.get(follow.track) !== follow) return;
    follow.asked = "done";
    // (What this screen finds is left under the name a timing was found under, so that the file's timing is one, not two, for the screens either side of a length's edge.)
    follow.leaveAs = foundAs ?? keys[0];
    // (A timing is for one file: another number of lines is another file.)
    if (timing && timing.lines === follow.cues.length) follow.borrowed = new Borrowed(timing, follow.cues);
    this.noteLines();
  }

  /** The timing another screen left for the track has agreed with what this screen hears: its lines go in place, and the rest of the work on the file shrinks to what it leaves. */
  private believe(follow: Followed): void {
    const borrowed = follow.borrowed;
    if (!borrowed || borrowed.state !== "trusted" || follow.believed) return;
    follow.believed = true;
    const now = this.shownAt();
    for (const [index, line] of borrowed.placed()) {
      // (A line this screen has placed by words stays. One the voice detector alone placed goes: the timing was made with more to go by, and that line is not this screen's own work any more.)
      if (follow.worded.has(index)) continue;
      const cue = follow.cues[index];
      if (!cue) continue;
      follow.placed[index] = { start: line.start, end: line.end, text: cue.text };
      follow.solved.add(index);
      follow.lent.drop(index);
      if (follow === this.current) follow.editor.place(index, line.start, line.end, now);
    }
    follow.coverage = mergeRanges([...follow.coverage, ...borrowed.ranges()]);
    if (follow.offset === null) follow.offset = borrowed.shift();
    follow.trusted = true;
    this.verify(follow);
    this.carryShift(follow);
    if (borrowed.complete() && this.recogniser) {
      this.recogniser.close();
      this.recogniser = undefined;
      stats.recogniser = "not needed";
    }
    this.noteLines();
  }

  /** The track is known to be this film's: what this screen places of it may be left for the others. */
  private verify(follow: Followed): void {
    if (follow.verified) return;
    follow.verified = true;
    follow.lentAt = this.clock();
  }

  /** Leaves what this screen has placed of the track on screen for the screens that play the same file: every few minutes, and (`last`) as the page closes. */
  private lend(last: boolean): void {
    const shared = this.deps.shared;
    const follow = this.current;
    // (Nothing before the answer to the question whether there is a timing already: it says which name this goes under.)
    if (!shared || !follow?.verified || !follow.leaveAs || follow.refused) return;
    if (!last && this.clock() - follow.lentAt < LEND_EVERY_MS) return;
    if (follow.lent.pending() < (last ? LEND_MIN_LAST : LEND_MIN)) return;
    const timing = follow.lent.take(follow.cues.length, last ? LEND_MAX_LAST : undefined);
    if (!timing) return;
    follow.lentAt = this.clock();
    const keys = follow.keys;
    void shared.put(follow.leaveAs, timing, last).catch((): Sent => "failed").then((sent) => {
      // (The sound may have changed meanwhile: what was sent was of the one before.)
      if (follow.keys !== keys) return;
      // The server will not have it under this name, ever (a timing for another file is kept there): sending the same again every few minutes would only be refused again.
      if (sent === "refused") follow.refused = true;
      if (sent !== "taken") return;
      follow.lent.confirm(timing);
      stats.sent += timing.placed.length;
    });
  }

  /** The page is closing: whatever has been found and not yet left is left now. */
  flush(): void {
    this.lend(true);
  }

  /* ------------------------------------ changing the track ------------------------------------ */

  /** Puts the better track on screen, in a gap between two lines. */
  private maybeSwitch(): void {
    const pending = this.switchTo;
    const current = this.current;
    if (!pending || !current) return;
    const now = this.shownAt();
    const reading = current.cues.some((_, index) => {
      const at = current.editor.current(index);
      return at.start - 0.3 <= now && now < at.end + 0.3;
    });
    if (reading && this.clock() - pending.since < SWITCH_WAIT_MS) return;
    this.switchTo = undefined;
    this.expected = pending.id;
    stats.switches++;
    this.deps.show(pending.id);
  }

  private shownAt(): number {
    return this.deps.video.currentTime - (this.deps.delay?.() ?? 0);
  }

  /* ------------------------------------ status ------------------------------------ */

  status(): SyncStatus {
    if (this.unavailable) return "unavailable";
    const current = this.current;
    if (this.closed || !current) return "ready";
    const at = this.deps.video.currentTime;
    return current.coverage.some((range) => range.from - 5 <= at && range.to + 5 >= at) ? "synced" : "syncing";
  }

  private report(): void {
    const status = this.status();
    if (status === this.lastStatus) return;
    this.lastStatus = status;
    stats.status = status;
    this.deps.report(status);
  }

  private giveUp(reason: string): void {
    // (Work that fails because the aligner was closed under it - the viewer turned it off - is not the aligner failing.)
    if (this.unavailable || this.closed) return;
    this.deps.log?.(reason);
    this.unavailable = true;
    stats.gaveUp = reason;
    stats.status = "unavailable";
    this.close();
    this.lastStatus = "unavailable";
    this.deps.report("unavailable");
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
