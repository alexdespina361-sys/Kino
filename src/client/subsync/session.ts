import { byRelease, normalizeLang, OFFICIAL_MIN_PLACED, type OfficialOfferLine } from "../../shared";
import { CueEditor, type EditableCue } from "./apply";
import { AHEAD_S, AudioFeed } from "./audio";
import type { Backend } from "./backend";
import { pairCaptions, timeFromEnglish } from "./bridge";
import type { Cue } from "./cues";
import { hasNoLanguage, hold, isHeld, release } from "./hold";
import { offerLines } from "./official";
import { bestAlternative, EVIDENCE_SECONDS, MAX_TESTS, MIN_HEARD_RATE, MIN_SECONDS, MIN_WORDS, RETEST_GROWTH, verdict, type Verdict } from "./pick";
import { nextWindow, rest, WINDOW } from "./schedule";
import { Borrowed, Lent, timingKeys, type Sent, type Shared } from "./share";
import { mergeRanges, SAMPLE_RATE, type Range } from "./signals";
import type { Outcome } from "./solve";
import { spans, alignerStats as stats, resetAlignerStats } from "./stats";
import type { HlsEvents, SoundTap } from "./tap";
import type { Recogniser } from "./whistle";

export type SyncStatus = "off" | "ready" | "syncing" | "synced" | "unavailable";

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
  readonly duration: number;
  readonly playbackRate: number;
  readonly textTracks: ArrayLike<TrackLike>;
}
interface AudioInfo {
  lang?: string;
  name?: string;
}
export interface HlsLike extends HlsEvents {
  readonly audioTracks?: ReadonlyArray<AudioInfo>;
  readonly audioTrack?: number;
  readonly subtitleTracks?: ReadonlyArray<unknown>;
}

export interface SessionDeps {
  video: VideoLike;
  hls: HlsLike;
  events: { audioSwitching: string };
  tap: SoundTap;
  live?: boolean;
  show(id: number): void;
  backend(): Promise<Backend>;
  recogniser(): Promise<Recogniser>;
  decode(bytes: Uint8Array): Promise<Float32Array>;
  report(status: SyncStatus, moved?: number): void;
  delay?(): number;
  shared?: Shared;
  offer?(id: number, offer: { duration: number; lines: OfficialOfferLine[] }, last: boolean): void;
  cores?: number;
  light?(): boolean;
  now?(): number;
  log?(message: string): void;
}

const SOLVE_AHEAD = 12;
const SOLVE_STEP = 15;
const CATCH_UP = 90;
const MAX_CANDIDATES = 4;
const LOAD_WAIT_MS = 15_000;
const SWITCH_WAIT_MS = 30_000;
const IDLE_MS = 500;
const MAX_AHEAD_S = 600;
const LIGHT_EVERY = 3;
const TICK_MS = 500;
const QUIET_AROUND = 10;
const MAX_BUSY_SHARE = 0.8;
const STABLE_LOOKS = 2;
const BORROW_WAIT_MS = 45_000;
const LEND_EVERY_MS = 180_000;
const LEND_MIN = 10;
const LEND_MIN_LAST = 3;
const LEND_MAX_LAST = 1500;

interface Followed {
  key: string;
  track: TrackLike;
  id: number;
  english: boolean;
  editor: CueEditor<CueLike>;
  cues: Cue[];
  placed: Cue[];
  solved: Set<number>;
  coverage: Range[];
  offset: number | null;
  trusted: boolean;
  agreed: number;
  appliedOffset: number;
  registered: boolean;
  worded: Set<number>;
  keys: string[] | undefined;
  asked: "no" | "looking" | "done";
  seenAt: number;
  borrowed: Borrowed | undefined;
  believed: boolean;
  lent: Lent;
  verified: boolean;
  lentAt: number;
  leaveAs: string | undefined;
  refused: boolean;
  borrowedWords: Set<number>;
  offered: number;
  offerSent: boolean;
}

interface Job {
  follow: Followed;
  end: number;
}

interface Bridge {
  reference: Followed;
  pairing: { match: Int32Array; share: number };
  nearest: Int32Array;
}

const isEnglish = (track: TrackLike): boolean => normalizeLang(track.language) === "en" && !hasNoLanguage(track);

const audioKey = (info: AudioInfo | undefined): string | undefined => (info && (info.lang !== undefined || info.name !== undefined) ? `${info.lang ?? ""}|${info.name ?? ""}` : undefined);

export class SyncSession {
  private readonly feed: AudioFeed;
  private backend: Backend | undefined;
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
  private lastMoved: number | undefined;
  private audioId: string | undefined;
  private epoch = 0;

  private audioSeconds = 0;
  private audioMs = 0;

  private heard: Range[] = [];
  private heardEnds: number[] = [];
  private heardWords = 0;
  private heardSeconds = 0;
  private speed = 1;
  private listeningUseless = false;

  private readonly followed = new Map<TrackLike, Followed>();
  private readonly seen = new Map<TrackLike, { count: number; looks: number }>();
  private nextKey = 1;
  private shown: TrackLike | undefined;
  private everShown = false;
  private current: Followed | undefined;
  private bridge: Bridge | undefined;
  private readonly wanted = new Set<TrackLike>();
  private wantedSince = 0;

  private jobs: Job[] = [];
  private queued = new Map<Followed, number>();

  private manual = false;
  private expected: number | undefined;
  private switchTo: { id: number; since: number } | undefined;
  private tests = 0;
  private lastTestWords = 0;
  private waitedAt = -1;
  private wrongRounds = 0;
  private dubbedWith = -1;
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
      ahead: () => Math.min(MAX_AHEAD_S, Math.max(AHEAD_S, (3 * WINDOW) / Math.max(0.05, this.speed))),
      unreadable: () => this.giveUp("The sound of this film cannot be read here"),
    });
    this.feed.pause(true);
    deps.tap.wanted?.(false);
    this.audioId = audioKey(deps.hls.audioTracks?.[deps.hls.audioTrack ?? 0]);
    deps.tap.connect((piece) => this.feed.push(piece));
    deps.hls.on(deps.events.audioSwitching, this.audioListener);
  }

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

  start(): void {
    this.timer = setInterval(() => this.guarded(() => this.tick()), TICK_MS);
    void this.loop();
  }

  async settle(): Promise<void> {
    await this.ready;
    await this.feed.idle();
  }

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

  tick(): void {
    if (this.closed) return;
    this.syncTracks();
    if (this.current) {
      this.borrow(this.current);
      this.lend(false);
    }
    this.current?.editor.flush(this.shownAt());
    this.maybeSwitch();
    this.feed.advance();
    this.report();
  }

  async work(): Promise<boolean> {
    if (this.closed || this.unavailable || !this.ready) return false;
    await this.ready;
    if (!this.backend || this.closed) return false;
    this.kickRecogniser();
    if (await this.solveOnce()) return true;
    if (await this.listenOnce()) return true;
    return this.judgeOnce();
  }

  private readonly audioListener = (_event: string, data: never): void => {
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
    this.dubbedWith = -1;
    this.listeningUseless = false;
    this.bridge = undefined;
    for (const follow of this.followed.values()) {
      follow.solved.clear();
      follow.coverage = [];
      follow.offset = null;
      follow.trusted = false;
      follow.agreed = 0;
      follow.registered = false;
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
    if (this.current) void this.registerQuietly(this.current);
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

  private noteSound(): void {
    if (this.listening() && (this.wordsKeepUp() || this.lightAndSure())) return;
    const end = this.coveredEnd();
    for (const follow of this.solving()) {
      if (end - (this.queued.get(follow) ?? -Infinity) >= SOLVE_STEP) this.queue(follow, end);
    }
  }

  private wordsKeepUp(): boolean {
    const at = this.deps.video.currentTime;
    const reach = this.deps.live ? at - WINDOW : at + WINDOW;
    return this.solving().every((follow) => follow.coverage.some((range) => range.from - 5 <= at && range.to >= reach));
  }

  private lightAndSure(): boolean {
    return this.listenEvery() > 1 && this.heardWords > 0;
  }

  private listenEvery(): number {
    return this.deps.light?.() && !this.deps.live && this.current?.trusted ? LIGHT_EVERY : 1;
  }

  private coveredEnd(): number {
    const covered = this.feed.ranges();
    const at = this.deps.video.currentTime;
    const around = covered.find((r) => r.from <= at + 1 && r.to >= at - 1) ?? covered[covered.length - 1];
    return around?.to ?? 0;
  }

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
      stats.hearMs += busy;
      if (this.closed || epoch !== this.epoch) return true;
      this.recogniserErrors = 0;
      const absolute = words.map((word) => ({ ...word, start: word.start + from, end: word.end + from }));
      await backend.addWords(absolute, from, from + WINDOW);
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
      const near = !this.deps.live && from - playhead < 30;
      const duty = (this.deps.cores ?? 4) <= 2 ? (near ? 0.5 : 0.3) : near ? 0.8 : 0.5;
      this.restUntil = this.clock() + rest(busy, duty);
    } catch (error) {
      if (this.closed || epoch !== this.epoch) return true;
      this.deps.log?.(`hear: ${describe(error)}`);
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

  private nextToHear(): number | undefined {
    const done = this.current?.borrowed?.state === "trusted" ? mergeRanges([...this.heard, ...this.current.borrowed.ranges()]) : this.heard;
    return nextWindow({ playhead: this.deps.video.currentTime, rate: this.deps.video.playbackRate || 1, covered: this.feed.ranges(), heard: done, speed: this.speed, every: this.listenEvery(), ...(this.deps.live ? { live: true } : {}) });
  }

  private clock(): number {
    return this.deps.now ? this.deps.now() : performance.now();
  }

  private englishTracks(): Array<{ track: TrackLike; id: number }> {
    const out: Array<{ track: TrackLike; id: number; label: string }> = [];
    const list = this.deps.video.textTracks;
    for (let id = 0; id < list.length; id++) {
      const track = list[id] as TrackLike;
      if (track.kind === "subtitles" && isEnglish(track)) out.push({ track, id, label: track.label });
    }
    return byRelease(out);
  }

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

  private take(track: TrackLike, id: number): Followed | undefined {
    const cues = track.cues;
    const count = cues?.length ?? 0;
    const known = this.followed.get(track);
    if (known) {
      known.id = id;
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
      borrowedWords: new Set(),
      offered: 0,
      offerSent: false,
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

  private chosen(track: TrackLike, id: number, first: boolean): void {
    const automatic = this.expected === id;
    this.expected = undefined;
    this.switchTo = undefined;
    this.current = undefined;
    this.bridge = undefined;
    this.releaseWanted();
    if (!automatic && !first) this.manual = true;
    this.verifiedNext = automatic;
    this.tests = automatic ? 1 : 0;
    this.lastTestWords = automatic ? this.heardWords : 0;
    this.waitedAt = -1;
    this.wrongRounds = 0;
    this.dubbedWith = -1;
    if (!isEnglish(track)) this.wantEnglish(1);
    void this.awake();
    this.feed.pause(false);
    this.deps.tap.wanted?.(true);
  }

  private lost(): void {
    this.current = undefined;
    this.bridge = undefined;
    this.switchTo = undefined;
    this.releaseWanted();
    this.feed.pause(true);
    this.deps.tap.wanted?.(false);
  }

  private adopt(follow: Followed): void {
    this.current = follow;
    this.queued.delete(follow);
    if (this.verifiedNext) this.verify(follow);
    this.paint(follow);
    this.noteLines();
    void this.registerQuietly(follow).then(() => {
      if (this.current === follow && !this.closed) this.catchUp(follow);
    });
  }

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

  private noteLines(): void {
    stats.lines = this.current?.cues.length ?? 0;
    stats.placed = this.current?.solved.size ?? 0;
    stats.bridged = this.bridge !== undefined;
    stats.shared = this.sharedState(this.current);
  }

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

  private registerQuietly(follow: Followed): Promise<void> {
    return this.register(follow).catch((error: unknown) => this.giveUp(`The aligner failed: ${describe(error)}`));
  }

  private solving(): Followed[] {
    if (!this.current) return [];
    return this.bridge ? [this.bridge.reference] : [this.current];
  }

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

  private letGo(track: TrackLike): void {
    if (!isHeld(track)) return;
    release(track);
    if (track !== this.shown) track.mode = "disabled";
  }

  private async solveOnce(): Promise<boolean> {
    const backend = this.backend;
    if (!backend) return false;
    this.jobs.sort((a, b) => a.end - b.end);
    const job = this.jobs.shift();
    if (!job) return false;
    if (this.followed.get(job.follow.track) !== job.follow) return true;
    const end = this.reachable(job.end);
    if (end === undefined) return true;
    const epoch = this.epoch;
    await this.register(job.follow);
    const started = this.clock();
    const outcome = await backend.solve(job.follow.key, end);
    stats.solveMs += this.clock() - started;
    if (outcome && !this.closed && epoch === this.epoch && this.followed.get(job.follow.track) === job.follow) this.absorb(job.follow, outcome);
    return true;
  }

  private reachable(end: number): number | undefined {
    let reach: number | undefined;
    for (const range of this.feed.ranges()) if (range.from <= end && (reach === undefined || range.to > reach)) reach = range.to;
    return reach === undefined ? undefined : Math.min(end, reach);
  }

  private absorb(follow: Followed, outcome: Outcome): void {
    if (outcome.method !== "none") stats.methods[outcome.method] = (stats.methods[outcome.method] ?? 0) + 1;
    if (outcome.method === "whistle+silero") follow.trusted = true;
    else if ((outcome.method === "silero" || outcome.method === "dub") && outcome.shift !== null) {
      follow.agreed = follow.offset !== null && Math.abs(outcome.shift - follow.offset) < 0.5 ? follow.agreed + 1 : 0;
      if (follow.agreed >= 3) follow.trusted = true;
    }
    follow.offset = outcome.shift;
    const words = outcome.method === "whistle+silero";
    follow.borrowed?.check(outcome.updates);
    this.believe(follow);
    const kept = !words && follow.borrowed?.state === "trusted" && follow.borrowed.agrees(outcome.updates) !== false ? follow.borrowed : undefined;
    const now = this.shownAt();
    const onScreen = follow === this.current && !this.bridge;
    let from = Infinity;
    let to = -Infinity;
    for (const update of outcome.updates) {
      const line = follow.cues[update.index];
      if (!line) continue;
      if (kept?.at(update.index)) continue;
      if (outcome.method === "silero" && follow.worded.has(update.index)) continue;
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
    if (moves.length > 0) follow.offset = moves.sort((a, b) => a - b)[moves.length >> 1] as number;
    follow.trusted = follow.trusted || bridge.reference.trusted;
    this.carryShift(follow);
  }

  private async judgeOnce(): Promise<boolean> {
    const current = this.current;
    if (!this.backend || !current || !this.recogniser || !this.wantsWords() || current.borrowed?.state === "trusted") return false;
    if (this.heardWords < MIN_WORDS || this.heardSeconds < MIN_SECONDS || this.tests >= MAX_TESTS) return false;
    if (this.tests > 0 && this.heardWords < this.lastTestWords * RETEST_GROWTH) return false;
    if (this.dubbedWith === this.englishTracks().length) return false;
    if (this.heardSeconds === this.waitedAt) return false;
    return current.english ? this.judgeEnglish(current) : this.judgeOther(current);
  }

  private async fit(cues: Cue[], latest: boolean): Promise<{ share: number; state: Verdict; latest: boolean; rate: number }> {
    const backend = this.backend as Backend;
    let score = await backend.score(cues, latest);
    let state = verdict(score.share, score.words, score.seconds);
    if (state === "waiting" && !latest && this.heardSeconds >= EVIDENCE_SECONDS) {
      latest = true;
      score = await backend.score(cues, true);
      state = verdict(score.share, score.words, score.seconds);
    }
    if (state === "waiting") this.waitedAt = this.heardSeconds;
    return { share: score.share, state, latest, rate: score.rate };
  }

  private async judgeEnglish(current: Followed): Promise<boolean> {
    const backend = this.backend as Backend;
    const { share, state, latest, rate } = await this.fit(current.cues, this.tests > 0);
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
    if (this.manual) return this.finishTest(state, undefined, rate);
    if (this.wanted.size === 0) this.wantEnglish(MAX_CANDIDATES);
    if (this.wanted.size === 0) return this.finishTest(state, undefined, rate);
    const loaded = this.loadedWanted();
    if (loaded.length < this.wanted.size && this.clock() - this.wantedSince < LOAD_WAIT_MS) return false;
    const others: Array<{ id: number; share: number }> = [];
    for (const follow of loaded) others.push({ id: this.idOf(follow.track) ?? follow.id, share: (await backend.score(follow.cues, latest)).share });
    if (this.current !== current) return true;
    return this.finishTest(state, bestAlternative(share, others), rate);
  }

  private finishTest(state: "wrong" | "unsure", better: number | undefined, rate: number): boolean {
    if (this.current) this.current.verified = false;
    this.tests++;
    this.lastTestWords = this.heardWords;
    this.releaseWanted();
    if (better !== undefined && !this.manual) {
      this.switchTo = { id: better, since: this.clock() };
      this.wrongRounds = 0;
    } else if (state === "wrong" && rate >= MIN_HEARD_RATE) {
      this.wrongRounds = 0;
      this.dubbedWith = this.englishTracks().length;
      stats.verdict = "dub";
    } else {
      this.wrongRounds = state === "wrong" ? this.wrongRounds + 1 : 0;
      this.stopIfUseless();
    }
    return true;
  }

  private async judgeOther(current: Followed): Promise<boolean> {
    let latest = this.tests > 0;
    if (this.bridge) {
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

  private noteTest(state: string, share: number): void {
    stats.verdict = state;
    stats.share = share;
    stats.tests = this.tests + 1;
  }

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

  private bridgeTo(current: Followed, reference: Followed): void {
    const pairing = pairCaptions(
      current.cues.map((line) => line.start),
      reference.cues.map((line) => line.start),
    );
    if (!pairing) return;
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
    void this.registerQuietly(reference).then(() => this.catchUp(reference));
  }

  private borrow(follow: Followed): void {
    const shared = this.deps.shared;
    if (!shared || follow.asked !== "no") return;
    const { duration } = this.deps.video;
    const keys = timingKeys({ duration, audio: this.audioLanguage(), cues: follow.cues });
    if (!keys) {
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
    if (this.closed || follow.keys !== keys || this.followed.get(follow.track) !== follow) return;
    follow.asked = "done";
    follow.leaveAs = foundAs ?? keys[0];
    if (timing && timing.lines === follow.cues.length) follow.borrowed = new Borrowed(timing, follow.cues);
    this.noteLines();
  }

  private believe(follow: Followed): void {
    const borrowed = follow.borrowed;
    if (!borrowed || borrowed.state !== "trusted" || follow.believed) return;
    follow.believed = true;
    const now = this.shownAt();
    for (const [index, line] of borrowed.placed()) {
      if (follow.worded.has(index)) continue;
      const cue = follow.cues[index];
      if (!cue) continue;
      follow.placed[index] = { start: line.start, end: line.end, text: cue.text };
      follow.solved.add(index);
      if (line.words) follow.borrowedWords.add(index);
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

  private verify(follow: Followed): void {
    if (follow.verified) return;
    follow.verified = true;
    follow.lentAt = this.clock();
  }

  private lend(last: boolean): void {
    this.offerOfficial(last);
    const shared = this.deps.shared;
    const follow = this.current;
    if (!shared || !follow?.verified || !follow.leaveAs || follow.refused) return;
    if (!last && this.clock() - follow.lentAt < LEND_EVERY_MS) return;
    if (follow.lent.pending() < (last ? LEND_MIN_LAST : LEND_MIN)) return;
    const timing = follow.lent.take(follow.cues.length, last ? LEND_MAX_LAST : undefined);
    if (!timing) return;
    follow.lentAt = this.clock();
    const keys = follow.keys;
    void shared.put(follow.leaveAs, timing, last).catch((): Sent => "failed").then((sent) => {
      if (follow.keys !== keys) return;
      if (sent === "refused") follow.refused = true;
      if (sent !== "taken") return;
      follow.lent.confirm(timing);
      stats.sent += timing.placed.length;
    });
  }

  private offerOfficial(last: boolean): void {
    const offer = this.deps.offer;
    const follow = this.current;
    if (!offer || !follow?.verified) return;
    const count = follow.cues.length;
    if (follow.solved.size < OFFICIAL_MIN_PLACED * count) return;
    if (follow.offerSent && !last) return;
    if (follow.offered > 0 && follow.solved.size < follow.offered + 0.05 * count) return;
    const { duration } = this.deps.video;
    if (!Number.isFinite(duration) || duration <= 0) return;
    const worded = follow.borrowedWords.size > 0 ? new Set([...follow.worded, ...follow.borrowedWords]) : follow.worded;
    const lines = offerLines({ cues: follow.cues, placed: follow.placed, solved: follow.solved, worded });
    follow.offered = follow.solved.size;
    if (!lines) return;
    follow.offerSent = true;
    stats.offered++;
    offer(this.idOf(follow.track) ?? follow.id, { duration, lines }, last);
  }

  flush(): void {
    this.lend(true);
  }

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

  status(): SyncStatus {
    if (this.unavailable) return "unavailable";
    const current = this.current;
    if (this.closed || !current) return "ready";
    const at = this.deps.video.currentTime;
    if (current.coverage.length === 0) return "syncing";
    const behind = this.deps.live ? WINDOW + SOLVE_STEP + 5 : 5;
    if (current.coverage.some((range) => range.from - 5 <= at && range.to + behind >= at)) return "synced";
    const quiet = !current.cues.some((_, index) => {
      const line = current.editor.current(index);
      return line.end > at - QUIET_AROUND && line.start < at + QUIET_AROUND;
    });
    return quiet ? "synced" : "syncing";
  }

  moved(): number | undefined {
    const current = this.current;
    if (!current?.trusted || current.offset === null) return undefined;
    return Math.round(current.offset * 10) / 10 || 0;
  }

  private report(): void {
    stats.sound = spans(this.feed.ranges());
    const lost = this.feed.counts;
    stats.lost = lost.droppedPaused + lost.dropped + lost.droppedDecoded + lost.failed > 0 ? `${lost.pushed} in, let go ${lost.droppedPaused} before the subtitles + ${lost.dropped} after + ${lost.droppedDecoded} decoded, ${lost.failed} unreadable` : "";
    stats.heard = spans(this.heard);
    stats.covered = spans(this.current?.coverage ?? []);
    const status = this.status();
    const moved = status === "synced" ? this.moved() : undefined;
    if (status === this.lastStatus && moved === this.lastMoved) return;
    this.lastStatus = status;
    this.lastMoved = moved;
    stats.status = status;
    this.deps.report(status, moved);
  }

  private giveUp(reason: string): void {
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
