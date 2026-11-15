import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  goodEnoughToOffer,
  isOfficialLang,
  normalizeLang,
  offerShares,
  OFFICIAL_LANGS,
  OFFICIAL_NAME,
  OFFICIAL_PATH,
  type OfficialLang,
  type OfficialOffer,
  type SubtitleTrack,
  SUBSYNC_MAX_MOVE,
} from "../../shared";
import { PostgresPersistence, type Persistence, type SqlClient } from "../accounts/persistence";
import { playKeyOf, type PlayKey } from "../library/unavailable";
import type { ResolveResult } from "../resolvers";
import { cleanCues, CLEAN_RULES } from "./clean";
import { inCueOrder, parseVtt, toVtt, type VttCue } from "./vtt";

/**
 * Kino Official subtitles: for each film and episode of the library, one subtitle file for each language (English and Romanian), the best the
 * site has. Its text is a subtitle site's file, tidied (`clean.ts`) and, once the team has been over it, corrected; its times are the ones a
 * screen's aligner found for that file on the film's sound, which a screen sends once it has timed most of the file by the words it heard (an
 * offer: `shared/official.ts`). The screens list it first of its language, and it is aligned on each screen like any other file, so a film of
 * another cut (a logo more or less at the start) is put right there as well. See docs/official-subtitles.md.
 */

/** How many are kept. A film's file is some tens of kilobytes; this is a few tens of megabytes of the free Postgres the accounts share. */
export const OFFICIAL_MAX = 800;
/** A newer offer for a title replaces the kept one only if it placed clearly more of the file (shares 0 to 1). */
export const BETTER_BY = 0.03;
/** The most subtitle tracks a screen is sent (the adapters cap their lists at the same). */
const MAX_TRACKS = 40;
/** How long the tracks of a title that was played are remembered, to know an offer is for a file that was listed for that title. */
const LISTED_MS = 12 * 3600 * 1000;
const LISTED_MAX = 20_000;
/** Files kept ready to send (each some tens of kilobytes). */
const SERVED_MAX = 40;

const LANGUAGE_NAMES: Record<OfficialLang, string> = { en: "English", ro: "Română" };
const OFFICIAL_LABEL = /kino\s*official/i;
const OFFICIAL_LABEL_ALL = /kino\s*official/gi;

export interface OfficialMeta {
  v: 1;
  id: string;
  /** Changes with every change of the text or the times: the file's link has it, so a screen never shows an old one it kept. */
  rev: string;
  play: string;
  titleId: string;
  title?: string | undefined;
  kind?: string | undefined;
  season?: number | undefined;
  episode?: number | undefined;
  lang: OfficialLang;
  /** The file it was made from (the link it was listed under and the name it had) and the length of the film it was timed on. */
  from: { track: string; label: string };
  duration: number;
  lines: number;
  /** How much of the file the screen placed, and by words (see `offerShares`). */
  shares: { placed: number; words: number };
  cleaned: { rules: number; removed: number; changed: number };
  /** The team has been over it: an offer never replaces it. */
  team?: { at: number; note?: string | undefined } | undefined;
  created: number;
  updated: number;
}

/** `[start, end, text]`, start and end in centiseconds. */
export type OfficialLine = [number, number, string];

export interface OfficialRecord {
  meta: OfficialMeta;
  lines: OfficialLine[];
  /** The text each line had in the file, where the tidying or the team changed it: `[line, text]`. */
  source: Array<[number, string]>;
  /** The lines of the file the tidying left out: `[where the file starts it (centiseconds), text]`. */
  dropped?: Array<[number, string]>;
}

/** Where they are kept. Read one at a time; only the `meta` of all of them is held in memory. */
export interface OfficialStore {
  metas(): Promise<OfficialMeta[]>;
  get(id: string): Promise<OfficialRecord | undefined>;
  put(record: OfficialRecord): Promise<void>;
  remove(id: string): Promise<void>;
}

const ID = /^[0-9a-f]{20}$/;

export class MemoryOfficialStore implements OfficialStore {
  readonly records = new Map<string, OfficialRecord>();
  async metas() {
    return [...this.records.values()].map((record) => record.meta);
  }
  async get(id: string) {
    const record = this.records.get(id);
    return record && (JSON.parse(JSON.stringify(record)) as OfficialRecord);
  }
  async put(record: OfficialRecord) {
    this.records.set(record.meta.id, JSON.parse(JSON.stringify(record)) as OfficialRecord);
  }
  async remove(id: string) {
    this.records.delete(id);
  }
}

/** One file to a title and language, in a folder next to the accounts' file. */
export class FileOfficialStore implements OfficialStore {
  constructor(private readonly dir: string) {}
  private file(id: string): string {
    if (!ID.test(id)) throw new Error("not an id");
    return path.join(this.dir, `${id}.json`);
  }
  async metas() {
    const names = await readdir(this.dir).catch(() => [] as string[]);
    const metas: OfficialMeta[] = [];
    for (const name of names.filter((each) => /^[0-9a-f]{20}\.json$/.test(each))) {
      const record = await this.get(name.slice(0, 20));
      if (record) metas.push(record.meta);
    }
    return metas;
  }
  async get(id: string) {
    try {
      return JSON.parse(await readFile(this.file(id), "utf8")) as OfficialRecord;
    } catch {
      return undefined;
    }
  }
  async put(record: OfficialRecord) {
    await mkdir(this.dir, { recursive: true });
    const file = this.file(record.meta.id);
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(record));
    await rename(temporary, file);
  }
  async remove(id: string) {
    await unlink(this.file(id)).catch(() => {});
  }
}

/** A table in the accounts' Postgres: a row to a title and language. */
export class PostgresOfficialStore implements OfficialStore {
  private ready: Promise<unknown> | undefined;
  constructor(private readonly db: SqlClient) {}
  private table(): Promise<unknown> {
    this.ready ??= this.db
      .query("create table if not exists kino_official (id text primary key, meta jsonb not null, body jsonb not null, updated timestamptz not null default now())")
      .catch((error: unknown) => {
        this.ready = undefined;
        throw error;
      });
    return this.ready;
  }
  async metas() {
    await this.table();
    const { rows } = await this.db.query("select meta from kino_official");
    return rows.map((row) => row.meta as OfficialMeta);
  }
  async get(id: string) {
    await this.table();
    const { rows } = await this.db.query("select meta, body from kino_official where id = $1", [id]);
    const row = rows[0];
    if (!row) return undefined;
    const body = row.body as Pick<OfficialRecord, "lines" | "source" | "dropped">;
    return { meta: row.meta as OfficialMeta, lines: body.lines, source: body.source, ...(body.dropped ? { dropped: body.dropped } : {}) };
  }
  async put(record: OfficialRecord) {
    await this.table();
    await this.db.query("insert into kino_official (id, meta, body) values ($1, $2::jsonb, $3::jsonb) on conflict (id) do update set meta = excluded.meta, body = excluded.body, updated = now()", [
      record.meta.id,
      JSON.stringify(record.meta),
      JSON.stringify({ lines: record.lines, source: record.source, ...(record.dropped ? { dropped: record.dropped } : {}) }),
    ]);
  }
  async remove(id: string) {
    await this.table();
    await this.db.query("delete from kino_official where id = $1", [id]);
  }
}

/** Where they are kept, to match the accounts: Postgres, a folder (`official` next to the accounts' file), or nowhere. */
export function officialStoreFor(persistence: Persistence, kind: "postgres" | "file" | "memory", env: NodeJS.ProcessEnv = process.env): OfficialStore {
  if (kind === "postgres" && persistence instanceof PostgresPersistence) return new PostgresOfficialStore(persistence.db);
  if (kind === "file") return new FileOfficialStore(path.resolve(env.DATA_DIR ?? "data", "official"));
  return new MemoryOfficialStore();
}

/** The id of the Kino Official file of a film or an episode in a language. */
export const officialId = (play: string, lang: OfficialLang): string => createHash("sha256").update(`${play}|${lang}`).digest("hex").slice(0, 20);

/**
 * Whether a track's file may be the text of a Kino Official one: a file of the Romanian subtitle sites (kept by the server) or of OpenSubtitles
 * (through the proxy). Not the captions a video's own player lists: what the server fetches to make one is fetched from a subtitle site only.
 */
export function fromSubtitleSite(track: string): boolean {
  if (/^\/api\/subtitles\/ro\/[A-Za-z0-9_.-]{1,200}\.vtt$/.test(track)) return true;
  if (!track.startsWith("/api/proxy?")) return false;
  try {
    const target = new URL(new URLSearchParams(track.slice("/api/proxy?".length)).get("url") ?? "");
    return target.protocol === "https:" && /(^|\.)(strem\.io|opensubtitles\.(org|com))$/i.test(target.hostname);
  } catch {
    return false;
  }
}

/** What became of an offer. */
export type OfferOutcome =
  /** Made into the title's Kino Official file, or made it better. */
  | "taken"
  /** The title has one that is as good, or one the team has been over. */
  | "kept"
  /** Placed too little of the file, or too little of it by words. */
  | "not_good_enough"
  /** Not a track the server listed for a title of the library lately (or not of a subtitle site, or in another language). */
  | "unknown_track"
  /** The screen's lines are not the file's (another file, or one read differently). */
  | "different_file"
  /** The file could not be had just now. */
  | "unavailable";

interface Listed {
  play: PlayKey;
  lang: OfficialLang;
  label: string;
  about?: { title?: string | undefined; kind?: string | undefined } | undefined;
  at: number;
}

/** One at a time for each title and language: two offers that come together are not both written over each other. */
class Turns {
  private readonly busy = new Map<string, Promise<unknown>>();
  run<T>(key: string, job: () => Promise<T>): Promise<T> {
    const turn = (this.busy.get(key) ?? Promise.resolve()).catch(() => {}).then(job);
    this.busy.set(key, turn);
    const done = () => this.busy.get(key) === turn && this.busy.delete(key);
    void turn.then(done, done);
    return turn;
  }
}

const cs = (seconds: number) => Math.max(0, Math.round(seconds * 100));

/**
 * The film's times of a file's lines from an offer: each placed line where the screen put it, a line it did not place moved as much as the
 * placed lines either side of it were (their average; the nearer one alone at either end of the file).
 */
export function timesFromOffer(file: readonly VttCue[], offer: OfficialOffer): VttCue[] {
  const shift: Array<number | undefined> = offer.lines.map((line, index) => (line ? line[1] - cs(file[index]!.start) : undefined));
  const before: Array<number | undefined> = [];
  let last: number | undefined;
  for (let i = 0; i < shift.length; i++) {
    if (shift[i] !== undefined) last = shift[i];
    before.push(last);
  }
  const after: Array<number | undefined> = new Array(shift.length);
  last = undefined;
  for (let i = shift.length - 1; i >= 0; i--) {
    if (shift[i] !== undefined) last = shift[i];
    after[i] = last;
  }
  return file.map((cue, index) => {
    const line = offer.lines[index];
    if (line) return { start: line[1] / 100, end: Math.max(line[2], line[1] + 20) / 100, text: cue.text };
    const a = before[index];
    const b = after[index];
    const moved = a !== undefined && b !== undefined ? (a + b) / 2 : (a ?? b ?? 0);
    const start = Math.max(0, cs(cue.start) + moved);
    return { start: start / 100, end: Math.max(start + 20, cs(cue.end) + moved) / 100, text: cue.text };
  });
}

/** What became of the offers since the server started, for `/api/health`: a parser that reads files otherwise than the screens shows as `different_file`. */
export type OfferCounts = Record<OfferOutcome, number>;

export interface OfficialsOptions {
  store: OfficialStore;
  now?: () => number;
  log?: { warn(message: string): void; info?(message: string): void };
  max?: number;
}

/** The Kino Official files: what the screens are offered and sent, what they offer, and the team's side. */
export class Officials {
  private readonly metas = new Map<string, OfficialMeta>();
  /** play key -> language -> id. */
  private readonly byPlay = new Map<string, Map<OfficialLang, string>>();
  private readonly listed = new Map<string, Listed>();
  private readonly served = new Map<string, string>();
  private readonly turns = new Turns();
  private readonly now: () => number;
  private readonly max: number;
  /** Whether what is kept has been read: until it is, no offer is taken (it could write over a file the team has been over). */
  private loaded = false;
  private lastLoad = 0;
  readonly counts: OfferCounts = { taken: 0, kept: 0, not_good_enough: 0, unknown_track: 0, different_file: 0, unavailable: 0 };

  private constructor(
    private readonly store: OfficialStore,
    private readonly log: OfficialsOptions["log"],
    now: (() => number) | undefined,
    max: number | undefined,
  ) {
    this.now = now ?? Date.now;
    this.max = max ?? OFFICIAL_MAX;
  }

  /** Learns what is kept. A store that cannot be read gives none for now (the site works the same without them). */
  static async open(options: OfficialsOptions): Promise<Officials> {
    const officials = new Officials(options.store, options.log, options.now, options.max);
    await officials.load();
    return officials;
  }

  /** Reads what is kept (again, at most once a minute, after it could not be). */
  private async load(): Promise<boolean> {
    if (this.loaded) return true;
    if (this.lastLoad > 0 && this.now() - this.lastLoad < 60_000) return false;
    this.lastLoad = this.now();
    try {
      for (const meta of await this.store.metas()) this.index(meta);
      this.loaded = true;
    } catch (error) {
      this.log?.warn(`Kino Official subtitles could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
    return this.loaded;
  }

  private index(meta: OfficialMeta): void {
    this.metas.set(meta.id, meta);
    let langs = this.byPlay.get(meta.play);
    if (!langs) this.byPlay.set(meta.play, (langs = new Map()));
    langs.set(meta.lang, meta.id);
  }

  private unindex(id: string): void {
    const meta = this.metas.get(id);
    if (!meta) return;
    this.metas.delete(id);
    const langs = this.byPlay.get(meta.play);
    langs?.delete(meta.lang);
    if (langs?.size === 0) this.byPlay.delete(meta.play);
  }

  get size(): number {
    return this.metas.size;
  }

  /**
   * A title of the library was played: its English and Romanian tracks from the subtitle sites are remembered for a while, as the ones an offer
   * for it may be about.
   */
  heard(url: string, result: ResolveResult, about?: Listed["about"]): void {
    if (result.status !== "success") return;
    const play = playKeyOf(url);
    if (!play) return;
    const at = this.now();
    const remember = (tracks: readonly SubtitleTrack[] | undefined) => {
      for (const track of tracks ?? []) {
        const lang = normalizeLang(track.lang);
        if (!isOfficialLang(lang) || !fromSubtitleSite(track.url)) continue;
        this.listed.delete(track.url);
        this.listed.set(track.url, { play, lang, label: track.label, about, at });
      }
    };
    remember(result.media.subtitles);
    for (const alternate of result.media.alternates ?? []) remember(alternate.subtitles);
    while (this.listed.size > LISTED_MAX) this.listed.delete(this.listed.keys().next().value as string);
  }

  /** The track of a Kino Official file, as the screens list it. */
  private track(meta: OfficialMeta): SubtitleTrack {
    return { id: 0, url: `${OFFICIAL_PATH}${meta.id}-${meta.rev}.vtt`, label: `${LANGUAGE_NAMES[meta.lang]} · ${OFFICIAL_NAME}`, lang: meta.lang };
  }

  /**
   * The answer of a look-up with the title's Kino Official files added to its subtitles (and to those of each other source that has its own):
   * first of their language, English and Romanian where the list has them (the adapters put English first, then Romanian). A new answer: the one
   * that came in may be the resolver's own kept one. Nothing is asked of the store, so a look-up is never slower for it.
   */
  withOfficial(url: string, result: ResolveResult): ResolveResult {
    if (result.status !== "success") return result;
    const play = playKeyOf(url);
    const langs = play ? this.byPlay.get(play.key) : undefined;
    const ours = OFFICIAL_LANGS.flatMap((lang) => {
      const id = langs?.get(lang);
      const meta = id ? this.metas.get(id) : undefined;
      return meta ? [this.track(meta)] : [];
    });
    // (The name is the site's own: a file somebody called so on a subtitle site is not listed as one.)
    const posing = (tracks: readonly SubtitleTrack[] | undefined) => tracks?.some((track) => OFFICIAL_LABEL.test(track.label)) ?? false;
    if (ours.length === 0 && !posing(result.media.subtitles) && !result.media.alternates?.some((alternate) => posing(alternate.subtitles))) return result;
    const add = (tracks: readonly SubtitleTrack[] | undefined): SubtitleTrack[] => {
      const list = (tracks ?? [])
        .filter((track) => !track.url.startsWith(OFFICIAL_PATH))
        .map((track) => (OFFICIAL_LABEL.test(track.label) ? { ...track, label: track.label.replace(OFFICIAL_LABEL_ALL, "").replace(/\s*·\s*$/, "").trim() || "Subtitle" } : track));
      for (const track of ours) {
        const first = list.findIndex((each) => normalizeLang(each.lang) === track.lang);
        if (first >= 0) list.splice(first, 0, track);
        else if (track.lang === "en") list.unshift(track);
        else {
          // (Romanian with no Romanian track: after the English ones, where the adapters would have put it.)
          let at = 0;
          while (at < list.length && normalizeLang(list[at]!.lang) === "en") at++;
          list.splice(at, 0, track);
        }
      }
      return list.slice(0, MAX_TRACKS).map((track, id) => ({ ...track, id }));
    };
    const media = { ...result.media, subtitles: add(result.media.subtitles) };
    if (result.media.alternates) media.alternates = result.media.alternates.map((alternate) => (alternate.subtitles ? { ...alternate, subtitles: add(alternate.subtitles) } : alternate));
    return { ...result, media };
  }

  /**
   * An offer from a screen: the times it found for a file it played. `fetchFile` gets the file as the screen got it (the server's own answer for
   * the track's link). The text is the file's, never the screen's.
   */
  async offer(offer: OfficialOffer, fetchFile: (track: string) => Promise<string | undefined>): Promise<OfferOutcome> {
    const outcome = await this.weigh(offer, fetchFile);
    this.counts[outcome]++;
    return outcome;
  }

  private async weigh(offer: OfficialOffer, fetchFile: (track: string) => Promise<string | undefined>): Promise<OfferOutcome> {
    if (!(await this.load())) return "unavailable";
    // (No line is moved further than a shared timing may move one: a file for another cut is more than that off.)
    if (offer.lines.some((line) => line && Math.abs(line[1] - line[0]) > SUBSYNC_MAX_MOVE * 100)) return "different_file";
    const listed = this.listed.get(offer.track);
    if (!listed || this.now() - listed.at > LISTED_MS) return "unknown_track";
    if (!goodEnoughToOffer(offer.lines)) return "not_good_enough";
    const id = officialId(listed.play.key, listed.lang);
    return this.turns.run(id, async () => {
      const kept = this.metas.get(id);
      const shares = offerShares(offer.lines);
      if (kept?.team) return "kept";
      // (One made by older tidying rules is made again by the new ones.)
      if (kept && kept.cleaned.rules >= CLEAN_RULES && shares.words < kept.shares.words + BETTER_BY && shares.placed < kept.shares.placed + BETTER_BY) return "kept";
      const text = await fetchFile(offer.track).catch(() => undefined);
      if (!text) return "unavailable";
      // (In the order the screen's browser numbered the lines in.)
      const file = inCueOrder(parseVtt(text));
      // The same file, read the same way: as many lines, each starting where the screen says the file starts it.
      if (file.length !== offer.lines.length) return "different_file";
      let same = 0;
      offer.lines.forEach((line, index) => {
        if (!line || Math.abs(line[0] - cs(file[index]!.start)) <= 1) same++;
      });
      if (same < 0.98 * file.length) return "different_file";
      const timed = timesFromOffer(file, offer);
      const cleaned = cleanCues(timed, listed.lang);
      const lines: OfficialLine[] = cleaned.cues.map((cue) => [cs(cue.start), cs(cue.end), cue.text]);
      const source: Array<[number, string]> = [];
      cleaned.from.forEach((index, line) => {
        const before = file[index]!.text;
        if (before !== lines[line]![2]) source.push([line, before]);
      });
      const at = this.now();
      const meta: OfficialMeta = {
        v: 1,
        id,
        rev: at.toString(36),
        play: listed.play.key,
        titleId: listed.play.titleId,
        ...(listed.about?.title ? { title: listed.about.title } : {}),
        ...(listed.about?.kind ? { kind: listed.about.kind } : {}),
        ...(listed.play.season !== undefined ? { season: listed.play.season } : {}),
        ...(listed.play.episode !== undefined ? { episode: listed.play.episode } : {}),
        lang: listed.lang,
        from: { track: offer.track, label: listed.label },
        duration: Math.round(offer.duration),
        lines: lines.length,
        shares: { placed: round(shares.placed), words: round(shares.words) },
        cleaned: { rules: CLEAN_RULES, removed: cleaned.removed, changed: cleaned.changed },
        created: kept?.created ?? at,
        updated: at,
      };
      const dropped: Array<[number, string]> = cleaned.dropped.map((index) => [cs(file[index]!.start), file[index]!.text]);
      await this.store.put({ meta, lines, source, ...(dropped.length > 0 ? { dropped } : {}) });
      this.index(meta);
      this.log?.info?.(`Kino Official subtitles: ${describe(meta)} ${kept ? "made better" : "made"} (${Math.round(shares.words * 100)} % by words).`);
      await this.makeRoom();
      return "taken";
    });
  }

  /** Lets the ones changed longest ago go (never one the team has been over) while there are more than the most kept. */
  private async makeRoom(): Promise<void> {
    if (this.metas.size <= this.max) return;
    const candidates = [...this.metas.values()].filter((meta) => !meta.team).sort((a, b) => a.updated - b.updated);
    for (const meta of candidates.slice(0, this.metas.size - this.max)) await this.remove(meta.id);
  }

  /** The file of a Kino Official track, and whether it is the one the link names (else it is the newer one). */
  async vtt(id: string, rev: string): Promise<{ vtt: string; current: boolean } | undefined> {
    const meta = this.metas.get(id);
    if (!meta) return undefined;
    const key = `${id}-${meta.rev}`;
    let vtt = this.served.get(key);
    if (vtt === undefined) {
      const record = await this.store.get(id);
      if (!record) return undefined;
      vtt = toVtt(
        record.lines.map(([start, end, text]) => ({ start: start / 100, end: end / 100, text })),
        `${OFFICIAL_NAME} (${LANGUAGE_NAMES[meta.lang]}): ${describe(meta)}`,
      );
      this.served.set(key, vtt);
      while (this.served.size > SERVED_MAX) this.served.delete(this.served.keys().next().value as string);
    }
    return { vtt, current: rev === meta.rev };
  }

  /* ------------------------------------ the team's side ------------------------------------ */

  list(): OfficialMeta[] {
    return [...this.metas.values()].sort((a, b) => b.updated - a.updated);
  }

  get(id: string): Promise<OfficialRecord | undefined> {
    return this.metas.has(id) ? this.store.get(id) : Promise.resolve(undefined);
  }

  /**
   * The team's text (and, if given, times) for a file: as many lines as it has, each in its place. From then on no offer replaces it. The text
   * the file first had stays in `source`, for what the team changed as well.
   */
  async edit(id: string, edited: { lines: OfficialLine[]; note?: string | undefined }): Promise<OfficialMeta | "not_found" | "different_lines"> {
    return this.turns.run(id, async () => {
      const record = await this.get(id);
      if (!record) return "not_found";
      if (edited.lines.length !== record.lines.length) return "different_lines";
      const source = new Map(record.source);
      edited.lines.forEach(([, , text], line) => {
        const before = record.lines[line]![2];
        if (text !== before && !source.has(line)) source.set(line, before);
      });
      const at = this.now();
      const meta: OfficialMeta = { ...record.meta, rev: at.toString(36), updated: at, team: { at, ...(edited.note ? { note: edited.note } : {}) } };
      await this.store.put({ meta, lines: edited.lines, source: [...source].sort((a, b) => a[0] - b[0]), ...(record.dropped ? { dropped: record.dropped } : {}) });
      this.index(meta);
      return meta;
    });
  }

  async remove(id: string): Promise<boolean> {
    if (!this.metas.has(id)) return false;
    await this.store.remove(id);
    this.unindex(id);
    return true;
  }
}

const round = (share: number) => Math.round(share * 1000) / 1000;

function describe(meta: OfficialMeta): string {
  const episode = meta.season !== undefined && meta.episode !== undefined ? ` S${String(meta.season).padStart(2, "0")}E${String(meta.episode).padStart(2, "0")}` : "";
  return `${meta.title ?? meta.titleId}${episode}`;
}
