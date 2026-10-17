import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  CAPTION_SETTINGS,
  CAPTION_VALUES,
  DEFAULT_CAPTION_STYLE,
  defaultTrack,
  describeStatus,
  episodeName,
  episodeStatus,
  formatDelay,
  groupBySeason,
  groupOf,
  isCurrentEpisode,
  MAX_FOLLOWERS,
  MAX_PHONE_TVS,
  PLAYBACK_SPEEDS,
  resolveCaptionStyle,
  tagLabel,
  versionLabel,
  type CaptionStyle,
  type PartyProfile,
  type PartyTv,
  type PhoneTv,
  type PlayerState,
  type PlayerTrack,
  type SeriesInfo,
  type WatchedEntry,
} from "../../shared";
import { languageNames, useSubtitleLists } from "../account/subtitles";
import { useAddable, useAddFromParty } from "../friends/useRequests";
import { t, useT } from "../i18n";
import { Rich } from "../i18n/Rich";
import { captionBottom, captionTextStyle } from "../shared/captionCss";
import { CopyLink } from "../shared/CopyLink";
import { useEpisodeDetails } from "../shared/episodeDetails";
import { formatCode, formatLeft } from "../shared/format";
import { CheckIcon, ChevronIcon, PlusIcon, ScanIcon, TvIcon, UsersIcon } from "../shared/icons";
import { controlLink, partyLink } from "../shared/launch";
import { comesIn, hueOf } from "../shared/Poster";
import { QrCode } from "../shared/QrCode";
import { FullscreenToggle } from "../shared/FullscreenToggle";
import { RoleSwitch } from "../shared/RoleSwitch";
import { captionLabel, captionTitle, statusWords, syncWords, trackName } from "../shared/words";
import { Rows, Switch } from "./AccountPages";
import { InviteFriendsButton } from "./Friends";
import { codeFromScan } from "./scan";
import { cameraAvailable, Scanner } from "./Scanner";
import { ChoiceList, Sheet, type Choice } from "./Sheet";

interface Close {
  onClose: () => void;
}

export function SpeedSheet({ player, onPick, onClose }: Close & { player: PlayerState; onPick: (rate: number) => void }) {
  useT();
  const rate = player.playbackRate ?? 1;
  const choices: Choice[] = PLAYBACK_SPEEDS.map((value) => ({
    key: value,
    label: value === 1 ? t("player.normal") : `${value}×`,
    active: Math.abs(rate - value) < 0.01,
    testId: `speed-${value}`,
    pick: () => onPick(value),
  }));
  return (
    <Sheet title={t("player.speed")} onClose={onClose} testId="speed-sheet">
      <ChoiceList choices={choices} />
    </Sheet>
  );
}

export function QualitySheet({ player, onPick, onClose }: Close & { player: PlayerState; onPick: (level: number) => void }) {
  useT();
  const quality = player.quality;
  const levels = [...(quality?.levels ?? [])].sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  const choices: Choice[] = [
    { key: -1, label: t("player.auto"), active: quality?.current === -1, testId: "quality--1", pick: () => onPick(-1) },
    ...levels.map((level) => ({
      key: level.id,
      label: level.label,
      active: quality?.current === level.id,
      testId: `quality-${level.id}`,
      pick: () => onPick(level.id),
    })),
  ];
  return (
    <Sheet title={t("player.quality")} onClose={onClose} testId="quality-sheet">
      <ChoiceList choices={choices} />
    </Sheet>
  );
}

export function SourcesSheet({ player, onPick, onClose }: Close & { player: PlayerState; onPick: (index: number) => void }) {
  useT();
  const sources = player.sources;
  const choices: Choice[] = (sources?.labels ?? []).map((label, index) => ({
    key: index,
    label,
    active: sources?.current === index,
    testId: `source-${index}`,
    pick: () => onPick(index),
  }));
  return (
    <Sheet title={t("player.source")} onClose={onClose} testId="source-sheet">
      <ChoiceList choices={choices} />
      <p className="muted small">{t("player.sourceHelp")}</p>
    </Sheet>
  );
}

const NO_TRACKS: PlayerTrack[] = [];

export function TracksSheet({
  player,
  onSubtitle,
  onAudio,
  onStyle,
  onDelay,
  onSync,
  onClose,
}: Close & {
  player: PlayerState;
  onSubtitle: (track: number) => void;
  onAudio: (track: number) => void;
  onStyle: () => void;
  onDelay?: (delay: number) => void;
  /** Turn the timing of the subtitles to the sound, by itself, on or off. */
  onSync?: (on: boolean) => void;
}) {
  useT();
  const subtitles = player.subtitles;
  const audio = player.audio;
  const delay = player.subtitleDelay ?? 0;
  const nudge = (by: number) => onDelay?.(Math.round((delay + by) * 10) / 10);
  // A TV without the aligner reports nothing about it, and then there is nothing to switch. While it is on, the line under the switch says how it is going.
  const sync = player.subtitleSync;
  const syncHint = sync === undefined || sync === "off" || sync === "ready" ? t("player.autoSyncHelp") : syncWords(sync);

  // The profile's own languages first; the rest are one tap away, and "Show all" lifts a profile's "only these".
  const tracks = subtitles?.tracks ?? NO_TRACKS;
  const [all, setAll] = useState(false);
  const [opened, setOpened] = useState(false);
  const { pinned, more, hidden } = useSubtitleLists(tracks, subtitles?.current, all);
  const visible = useMemo(() => [...pinned, ...more], [pinned, more]);
  const playing = groupOf(visible, subtitles?.current);
  const [language, setLanguage] = useState<string | undefined>(undefined);
  const shown = visible.find((group) => group.key === language) ?? playing ?? visible[0];
  // One list while every language has a single track; otherwise the languages as chips and the releases of one below them.
  const flat = visible.every((group) => group.tracks.length === 1);
  // With nothing of the profile's own to show first, the others are not "more" and need no tap; the language on now is never hidden away.
  const moreOpen = opened || pinned.length === 0 || more.some((group) => group.key === playing?.key || group.key === language);

  const off: Choice = { key: -1, label: t("common.off"), active: (subtitles?.current ?? -1) === -1, testId: "subtitle--1", pick: () => onSubtitle(-1) };
  const trackChoice = (track: PlayerTrack): Choice => ({
    key: track.id,
    label: trackName(track),
    active: subtitles?.current === track.id,
    testId: `subtitle-${track.id}`,
    pick: () => onSubtitle(track.id),
  });
  const releases: Choice[] = (shown?.tracks ?? []).map((track, index) => ({
    key: track.id,
    label: versionLabel(track, languageNames(shown!), index, t("player.version", { n: index + 1 })),
    active: subtitles?.current === track.id,
    testId: `subtitle-${track.id}`,
    pick: () => onSubtitle(track.id),
  }));
  const audioChoices: Choice[] = (audio?.tracks ?? []).map((track) => ({
    key: track.id,
    label: trackName(track),
    active: audio?.current === track.id,
    testId: `audio-${track.id}`,
    pick: () => onAudio(track.id),
  }));

  const languageChip = (group: (typeof visible)[number]) => {
    const active = playing?.key === group.key;
    return (
      <button
        key={group.key}
        type="button"
        role="option"
        aria-selected={active}
        className={`cap-choice ${active ? "active" : ""}`}
        data-testid={`subtitle-lang-${group.key}`}
        onClick={() => {
          setLanguage(group.key);
          if (!active) onSubtitle((defaultTrack(group.tracks) ?? group.tracks[0]!).id); // the best-fitting release of it
        }}
      >
        {group.name}
        {group.tracks.length > 1 && <small className="cap-count">{group.tracks.length}</small>}
      </button>
    );
  };
  const moreChip = (
    <button type="button" className="cap-choice more" data-testid="subtitle-more" onClick={() => setOpened(true)}>
      {t("player.moreLanguages")}
      <small className="cap-count">{more.length}</small>
    </button>
  );
  const showAllChip = hidden > 0 && (
    <button type="button" className="cap-choice more" data-testid="subtitle-show-all" onClick={() => setAll(true)}>
      {t("player.showAll")}
    </button>
  );
  const moreLabel = pinned.length > 0 && (
    <span key="more-label" className="cap-label" role="presentation">
      {t("player.moreLanguages")}
    </span>
  );

  return (
    <Sheet title={t("player.audioSubtitles")} onClose={onClose} testId="tracks-sheet">
      {audioChoices.length > 1 && (
        <>
          <h3 className="sheet-section">{t("player.audio")}</h3>
          <ChoiceList choices={audioChoices} />
        </>
      )}
      <h3 className="sheet-section">{t("player.subtitles")}</h3>
      {flat ? (
        <>
          <ChoiceList choices={[off, ...pinned.flatMap((group) => group.tracks.map(trackChoice))]} />
          {more.length > 0 &&
            (moreOpen ? (
              <>
                {moreLabel}
                <ChoiceList choices={more.flatMap((group) => group.tracks.map(trackChoice))} />
              </>
            ) : (
              <div className="cap-choices">{moreChip}</div>
            ))}
          {showAllChip && <div className="cap-choices">{showAllChip}</div>}
        </>
      ) : (
        <>
          <div className="cap-choices" role="listbox" aria-label={t("player.subtitleLanguage")} data-testid="subtitle-languages">
            <button type="button" role="option" aria-selected={off.active} className={`cap-choice ${off.active ? "active" : ""}`} data-testid={off.testId} onClick={off.pick}>
              {t("common.off")}
            </button>
            {pinned.map(languageChip)}
            {more.length > 0 && (moreOpen ? [moreLabel, ...more.map(languageChip)] : moreChip)}
            {showAllChip}
          </div>
          <ChoiceList choices={releases} />
        </>
      )}
      {onSync && sync !== undefined && (
        <Rows>
          <Switch label={t("player.autoSyncLabel")} hint={syncHint} checked={sync !== "off"} onChange={onSync} testId="subtitle-sync" />
        </Rows>
      )}
      {onDelay && (subtitles?.current ?? -1) !== -1 && (
        <div className="delay-row" data-testid="subtitle-delay">
          <span>
            {t("player.delay")} <b data-testid="subtitle-delay-value">{formatDelay(delay)}</b>
          </span>
          <div className="delay-buttons">
            <button type="button" className="btn btn-sm" onClick={() => nudge(-0.5)} aria-label={t("player.earlierLabel")} data-testid="delay-earlier">
              −0.5s
            </button>
            <button type="button" className="btn btn-sm" onClick={() => onDelay(0)} aria-label={t("player.resetLabel")} data-testid="delay-reset">
              {t("player.reset")}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => nudge(0.5)} aria-label={t("player.laterLabel")} data-testid="delay-later">
              +0.5s
            </button>
          </div>
        </div>
      )}
      <button className="btn btn-block" data-testid="open-caption-style" onClick={onStyle}>
        {t("player.captionStyleMore")}
      </button>
      <p className="muted small">{t("player.remembers")}</p>
    </Sheet>
  );
}

/** How subtitles look: a small picture of the TV with a sample line that follows every change, then one row of choices per setting. */
export function CaptionStyleSheet({
  style,
  onChange,
  onClose,
}: Close & { style: CaptionStyle | undefined; onChange: (changes: Partial<CaptionStyle>) => void }) {
  useT();
  const current = resolveCaptionStyle(style);
  return (
    <Sheet title={t("player.captionStyle")} onClose={onClose} testId="captions-sheet">
      {/* (held sideways, the picture stays on one side while the choices scroll on the other: see the style sheets) */}
      <div className="cap-layout">
        <div className="cap-frame" aria-hidden="true" data-testid="caption-preview">
          <span className="cap-sample" style={{ ...captionTextStyle(current, "cqh"), bottom: captionBottom(current, "cqh") }}>
            {t("player.sample")}
          </span>
        </div>
        <div className="cap-controls">
          {CAPTION_SETTINGS.map((setting) => (
            <section key={setting} className="cap-setting">
              <h3 className="sheet-section">{captionTitle(setting)}</h3>
              <div className="cap-choices" role="radiogroup" aria-label={captionTitle(setting)}>
                {CAPTION_VALUES[setting].map((value) => (
                  <button
                    key={value}
                    role="radio"
                    aria-checked={current[setting] === value}
                    className={`cap-choice ${current[setting] === value ? "active" : ""}`}
                    data-testid={`caption-${setting}-${value}`}
                    onClick={() => onChange({ [setting]: value })}
                  >
                    {captionLabel(setting, value as never)}
                  </button>
                ))}
              </div>
            </section>
          ))}
          <button className="btn btn-block" data-testid="caption-reset" onClick={() => onChange(DEFAULT_CAPTION_STYLE)}>
            {t("player.styleDefault")}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/** A picture from an episode; without one (or when it does not load) a colour made from its name. */
export function Still({ src, name }: { src: string | undefined; name: string }) {
  const [broken, setBroken] = useState(false);
  const hue = hueOf(name);
  return (
    <span className="episode-still" style={{ background: `linear-gradient(135deg, hsl(${hue} 40% 26%), hsl(${(hue + 40) % 360} 45% 12%))` }}>
      {src && !broken && <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} {...comesIn} />}
    </span>
  );
}

/**
 * Every episode the source knows about, by season. The one playing is marked; tap any other to jump there. When the library knows more
 * about the season (a picture, a line, how long each runs) each episode is a card, the way the TV lists them; otherwise a plain row.
 */
export function EpisodesSheet({
  series,
  show,
  watched,
  onPlay,
  onClose,
}: Close & { series: SeriesInfo; show: string | undefined; watched: readonly WatchedEntry[]; onPlay: (url: string) => void }) {
  useT();
  const groups = useMemo(() => groupBySeason(series.episodes ?? []), [series.episodes]);
  const [season, setSeason] = useState(() => (groups.some((g) => g.season === series.season) ? series.season : groups[0]?.season));
  const shown = groups.find((group) => group.season === season) ?? groups[0];
  const listRef = useRef<HTMLUListElement>(null);
  const details = useEpisodeDetails(shown?.episodes[0]?.url, shown?.season);
  // Nothing known beyond the names: the plain list. While it is being asked the cards are already there, so the list does not change shape.
  const rich = details !== null;

  // Open on the episode you're watching, not at the top of a 24-episode season.
  useEffect(() => {
    listRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "center" });
  }, [season]);

  return (
    <Sheet title={t("player.episodes")} onClose={onClose} testId="episodes-sheet">
      {groups.length > 1 && (
        <div className="seasons" role="tablist" aria-label={t("player.seasons")}>
          {groups.map((group) => (
            <button
              key={group.season}
              role="tab"
              aria-selected={group.season === shown?.season}
              className={`season ${group.season === shown?.season ? "active" : ""}`}
              data-testid={`season-${group.season}`}
              onClick={() => setSeason(group.season)}
            >
              {t("player.season", { n: group.season })}
            </button>
          ))}
        </div>
      )}
      {groups.length === 1 && shown && <h3 className="sheet-section">{t("player.season", { n: shown.season })}</h3>}
      <ul className="episodes" ref={listRef}>
        {shown?.episodes.map((episode) => {
          const now = isCurrentEpisode(series, episode);
          const status = episodeStatus(watched, show, episode.season, episode.episode);
          const note = describeStatus(status, statusWords());
          const known = details?.get(episode.episode);
          const name = episodeName(known?.title ? { ...episode, title: known.title } : episode, t("player.episodeN", { n: episode.episode }));
          const runtime = known?.runtime ? formatLeft(known.runtime * 60) : undefined;
          const marked = now ? (
            <span className="episode-now">
              <CheckIcon /> {t("player.nowPlaying")}
            </span>
          ) : note ? (
            <span className={`episode-note ${status.kind}`}>{status.kind === "watched" && <CheckIcon />} {note}</span>
          ) : null;
          return (
            <li key={`${episode.season}-${episode.episode}`}>
              <button
                className={`episode${rich ? " rich" : ""}${now ? " now" : ""}`}
                aria-current={now}
                data-testid="episode"
                data-season={episode.season}
                data-episode={episode.episode}
                data-status={status.kind}
                onClick={() => !now && onPlay(episode.url)}
              >
                <span className="episode-no">{episode.episode}</span>
                {rich ? (
                  <>
                    <Still src={known?.still} name={name} />
                    <span className="episode-text">
                      <span className="episode-title">{name}</span>
                      {(marked ?? runtime) && <span className="episode-meta">{marked ?? <span className="episode-note">{runtime}</span>}</span>}
                      {known?.overview && <span className="episode-about">{known.overview}</span>}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="episode-title">{name}</span>
                    {marked}
                  </>
                )}
                {status.kind === "started" && (
                  <span className="episode-progress" aria-hidden="true">
                    <i style={{ width: `${Math.round(status.fraction * 100)}%` }} />
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

export function MenuSheet({
  tvName,
  online,
  partySize,
  tvCount,
  controlCode,
  controllerCount,
  linkBox,
  onLinkBox,
  onParty,
  onTvs,
  onDisconnect,
  onClose,
}: Close & {
  tvName: string;
  online: boolean;
  partySize: number;
  /** How many TVs this phone has on its list (this one included). */
  tvCount: number;
  controlCode?: string;
  controllerCount?: number;
  /** Whether the home screen has the box for pasting a link, and a way to turn it on or off. */
  linkBox: boolean;
  onLinkBox: (on: boolean) => void;
  onParty: () => void;
  onTvs: () => void;
  onDisconnect: () => void;
}) {
  useT();
  return (
    <Sheet title={tvName} onClose={onClose} testId="menu-sheet">
      <p className="muted">{online ? t("menu.connected") : t("menu.offline")}</p>
      {controlCode && (
        <div className="code-card" data-testid="control-card">
          <span className="code-card-title">{t("menu.controlWith", { count: controllerCount ?? 1 })}</span>
          <div className="code-card-top">
            <span className="code-card-code" data-testid="control-code">
              {formatCode(controlCode)}
            </span>
            <QrCode value={controlLink(controlCode)} label={t("menu.controlQr")} />
          </div>
          <span className="muted small">
            <Rich k="menu.controlHelp" parts={{ host: <b>{location.host}</b> }} />
          </span>
        </div>
      )}
      <nav className="menu">
        <button className="menu-row" data-testid="party-open" onClick={onParty}>
          <span className="menu-icon">
            <UsersIcon />
          </span>
          <span className="menu-label">{partySize === 0 ? t("menu.partyOpen") : t("menu.partyActive", { count: partySize + 1 })}</span>
          <ChevronIcon />
        </button>
        <button className="menu-row" data-testid="tvs-open" onClick={onTvs}>
          <span className="menu-icon">
            <TvIcon />
          </span>
          <span className="menu-label">{tvCount > 1 ? t("menu.tvsCount", { count: tvCount }) : t("menu.tvs")}</span>
          <ChevronIcon />
        </button>
      </nav>
      <Rows>
        <FullscreenToggle className="menu-row" labels={{ enter: t("phone.fullscreen"), exit: t("phone.exitFullscreen") }} />
        <Switch label={t("menu.linkBox")} hint={t("menu.linkBoxHelp", { tv: tvName })} checked={linkBox} onChange={onLinkBox} testId="link-box-toggle" />
      </Rows>
      <button className="btn btn-danger btn-block" data-testid="disconnect" onClick={onDisconnect}>
        {t("menu.disconnect")}
      </button>
      <p className="muted small">{t("menu.disconnectHelp")}</p>
      <RoleSwitch to="tv" />
    </Sheet>
  );
}

/**
 * The TVs this phone has connected to: choose the one to control (the others carry on as they were, still paired), forget one, name
 * the one in use, and connect another by its code. A TV can only be got back to from here if it was connected to before, with its code.
 */
export function TvsSheet({
  tvs,
  error,
  onSwitch,
  onForget,
  onName,
  onAdd,
  onClose,
}: Close & {
  tvs: PhoneTv[];
  error: string | null;
  onSwitch: (id: string) => void;
  onForget: (id: string) => void;
  /** Name the TV in use; empty gives it its own name back. */
  onName: (name: string) => void;
  /** The code of another TV, typed or scanned. */
  onAdd: (code: string) => void;
}) {
  useT();
  const current = tvs.find((tv) => tv.current);
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [name, setName] = useState(current?.name ?? "");
  /** The TV that Forget was pressed for, and that is being asked about. */
  const [asking, setAsking] = useState<string | null>(null);
  const full = tvs.length >= MAX_PHONE_TVS;

  // A code that was refused has been used up; a TV that was named (or switched to) shows its name.
  useEffect(() => setCode(""), [error, tvs.length]);
  useEffect(() => setName(current?.name ?? ""), [current?.id, current?.name]);

  const change = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    if (digits.length === 6) onAdd(digits);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (code.length === 6) onAdd(code);
  };
  const rename = () => {
    if (current && name.trim() !== current.name) onName(name);
  };

  return (
    <Sheet title={t("tvs.title")} onClose={onClose} testId="tvs-sheet">
      {tvs.length > 0 && <p className="muted">{t("tvs.intro")}</p>}
      <ul className="party-list" data-testid="tv-list">
        {tvs.map((tv) => (
          <li className="tv-row" key={tv.id} data-testid="tv-row" data-current={tv.current} data-online={tv.online}>
            {asking === tv.id ? (
              <div className="editor-confirm" role="alert" data-testid="tv-forget-ask">
                <p>{t("tvs.forgetAsk", { tv: tv.name })}</p>
                <div className="editor-actions">
                  <button
                    className="btn btn-danger"
                    data-testid="tv-forget-yes"
                    onClick={() => {
                      setAsking(null);
                      onForget(tv.id);
                    }}
                  >
                    {t("tvs.forget")}
                  </button>
                  <button className="btn" data-testid="tv-forget-no" autoFocus onClick={() => setAsking(null)}>
                    {t("common.cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button className={`choice${tv.current ? " active" : ""}`} data-testid="tv-switch" aria-current={tv.current} onClick={() => !tv.current && onSwitch(tv.id)}>
                  <span>
                    {tv.name}
                    <span className={`party-state ${tv.online ? "ok" : "bad"}`}>
                      {tv.current ? `${t("tvs.current")} · ` : ""}
                      {tv.label ? `${tv.label} · ` : ""}
                      {tv.online ? t("tvs.online") : t("tvs.offline")}
                    </span>
                  </span>
                </button>
                <button className="btn btn-danger" data-testid="tv-forget" aria-label={t("tvs.forgetLabel", { tv: tv.name })} onClick={() => setAsking(tv.id)}>
                  {t("tvs.forget")}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>

      {current && (
        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            rename();
          }}
        >
          <label className="auth-field">
            <span>{t("tvs.nameTitle")}</span>
            <input data-testid="tv-rename" autoComplete="off" maxLength={40} value={name} onChange={(event) => setName(event.target.value)} onBlur={rename} />
            <small>{t("tvs.nameHelp")}</small>
          </label>
        </form>
      )}

      {full ? (
        <p className="muted small" data-testid="tvs-full">
          {t("tvs.full")}
        </p>
      ) : (
        <form onSubmit={submit}>
          <h3 className="sheet-section">{t("tvs.addTitle")}</h3>
          <p className="muted small">
            <Rich k="tvs.help" parts={{ host: <b>{location.host}</b>, connect: <b>{t("tv.connectPhone")}</b> }} />
          </p>
          {cameraAvailable() && (
            <button type="button" className="btn btn-block" data-testid="tvs-scan" onClick={() => setScanning(true)}>
              <ScanIcon /> {t("pair.scan")}
            </button>
          )}
          <input
            data-testid="tvs-code"
            className="code-input"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            placeholder="••••••"
            aria-label={t("pair.codeLabel")}
            value={code}
            onChange={(event) => change(event.target.value)}
          />
        </form>
      )}
      {error && (
        <p className="error" data-testid="tvs-error" role="alert">
          {error}
        </p>
      )}
      {scanning && (
        <Scanner
          onCode={(digits) => {
            setScanning(false);
            onAdd(digits);
          }}
          onClose={() => setScanning(false)}
        />
      )}
    </Sheet>
  );
}

/** The code that brings another screen into this phone's party, and when it runs out: "asking" until the TV has answered, null when none is open. */
export type PartyInvite = { code: string; endsAt: number } | "asking" | null;

/** The code and link that let a screen in: a TV types the code, a phone or computer scans it or opens the link, which can be copied into a chat (or shared, where the phone has a share sheet). */
function Invite({ code, endsAt }: { code: string; endsAt: number }) {
  useT();
  const link = partyLink(code);
  const canShare = typeof navigator.share === "function";
  const share = () => navigator.share({ title: t("party.title"), url: link }).catch(() => undefined); // (a share sheet that was closed is no error)

  return (
    <div className="code-card" data-testid="party-invite">
      <div className="code-card-top">
        <span className="code-card-code" data-testid="party-join-code">
          {formatCode(code)}
        </span>
        <QrCode value={link} label={t("party.qrLabel")} />
      </div>
      <p className="muted small">
        <Rich k="party.inviteHelp" parts={{ host: <b>{location.host}</b> }} />
      </p>
      <CopyLink link={link} testId="party-link" buttonClass={canShare ? "btn" : "btn btn-red"} />
      {canShare && (
        <button className="btn btn-red btn-block" data-testid="party-share" onClick={share}>
          {t("party.share")}
        </button>
      )}
      <InviteFriendsButton code={code} endsAt={endsAt} />
    </div>
  );
}

/** The short button beside a guest who is signed in as a profile: asks them to be friends (they have to say yes). Nothing for a friend already. */
function PartyAdd({ profile }: { profile: PartyProfile | undefined }) {
  const t = useT();
  const addable = useAddable(profile);
  const addFromParty = useAddFromParty();
  if (!profile || !addable) return null;
  return (
    <button
      className="btn"
      data-testid="party-add"
      data-state={addable}
      disabled={addable === "asked"}
      aria-label={t("friends.partyAddAria", { name: tagLabel(profile.name, profile.tag) })}
      onClick={() => void addFromParty(profile)}
    >
      {addable === "asked" ? (
        <>
          <CheckIcon /> {t("friends.partyRequested")}
        </>
      ) : (
        <>
          <PlusIcon /> {t("friends.partyAdd")}
        </>
      )}
    </button>
  );
}

/**
 * The watch party of this phone's TV: how to bring another screen in (the code and link of the party, or typing the code that a
 * TV shows), who is in, and a way to send a screen away. What plays here plays on all of them.
 */
export function PartySheet({
  tvName,
  party,
  invite,
  error,
  onInvite,
  onAdd,
  onRemove,
  onAdmin,
  onEnd,
  onClose,
}: Close & {
  tvName: string;
  party: PartyTv[];
  invite: PartyInvite;
  error: string | null;
  /** Ask the TV for the party's code (that opens the party when there is none). */
  onInvite: () => void;
  onAdd: (code: string) => void;
  onRemove: (id: string) => void;
  /** Make a screen of the party an admin (it can then play, pause, move and stop the film for everyone), or take that back. */
  onAdmin: (id: string, admin: boolean) => void;
  /** End the party for everyone: the code stops working too. */
  onEnd: () => void;
}) {
  useT();
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const full = party.length >= MAX_FOLLOWERS;
  const endsAt = typeof invite === "object" && invite ? invite.endsAt : null;

  // A TV that joined (or a code that was refused) has used the code up.
  useEffect(() => setCode(""), [party.length, error]);
  // Opening the sheet asks for the code; one that has run out is asked for again while the sheet is still open.
  useEffect(() => onInvite(), []);
  useEffect(() => {
    if (endsAt === null) return;
    const timer = setTimeout(onInvite, Math.max(500, endsAt - Date.now() + 200));
    return () => clearTimeout(timer);
  }, [endsAt]);

  const change = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    if (digits.length === 6) onAdd(digits);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (code.length === 6) onAdd(code);
  };

  return (
    <Sheet title={t("party.title")} onClose={onClose} testId="party-sheet">
      <p className="muted">{t("party.intro", { tv: tvName })}</p>

      {full ? (
        <p className="muted small">{t("party.full")}</p>
      ) : invite === "asking" ? (
        <div className="code-card code-card-wait">
          <span className="spinner" />
        </div>
      ) : invite ? (
        <Invite code={invite.code} endsAt={invite.endsAt} />
      ) : (
        <button className="btn btn-block" data-testid="party-invite-open" onClick={onInvite}>
          {t("party.invite")}
        </button>
      )}

      <h3 className="sheet-section">{t("party.members")}</h3>
      <ul className="party-list" data-testid="party-list">
        <li className="choice" data-testid="party-host">
          <span>
            {tvName}
            <span className="party-state ok">{t("party.host")}</span>
          </span>
        </li>
        {party.map((tv) => (
          <li className="choice party-row" key={tv.id} data-testid="party-tv" data-admin={tv.admin || undefined}>
            <span className="party-who">
              {tv.name}
              <span className={`party-state ${tv.online ? "ok" : "bad"}`}>
                {tv.online ? t("party.watching") : t("party.offline")}
                {tv.admin && ` · ${t("party.admin")}`}
              </span>
            </span>
            <span className="party-actions">
              <PartyAdd profile={tv.profile} />
              <button className="btn" data-testid="party-admin" onClick={() => onAdmin(tv.id, !tv.admin)}>
                {t(tv.admin ? "party.removeAdmin" : "party.makeAdmin")}
              </button>
              <button className="btn btn-danger" data-testid="party-remove" onClick={() => onRemove(tv.id)}>
                {t("party.remove")}
              </button>
            </span>
          </li>
        ))}
      </ul>
      {party.length > 0 && (
        <button className="btn btn-danger btn-block" data-testid="party-end" onClick={onEnd}>
          {t("party.end")}
        </button>
      )}

      {!full && (
        <form onSubmit={submit}>
          <h3 className="sheet-section">{t("party.addTitle")}</h3>
          <p className="muted small">
            <Rich k="party.help" parts={{ host: <b>{location.host}</b>, connect: <b>{t("tv.connectPhone")}</b> }} />
          </p>
          {cameraAvailable() && (
            <button type="button" className="btn btn-block" data-testid="party-scan" onClick={() => setScanning(true)}>
              <ScanIcon /> {t("pair.scan")}
            </button>
          )}
          <input
            data-testid="party-code"
            className="code-input"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            placeholder="••••••"
            aria-label={t("party.codeLabel")}
            value={code}
            onChange={(event) => change(event.target.value)}
          />
        </form>
      )}
      {error && (
        <p className="error" data-testid="party-error" role="alert">
          {error}
        </p>
      )}
      {scanning && (
        <Scanner
          read={(text) => codeFromScan(text, ["code"])} // the code of a TV that has a phone already cannot join a party
          onCode={(digits) => {
            setScanning(false);
            onAdd(digits);
          }}
          onClose={() => setScanning(false)}
        />
      )}
    </Sheet>
  );
}

/** A phone that has a TV scanned the code of another one: that TV joins the watch party, or the phone moves over to it (the first stays on its list). */
export function OtherTvSheet({
  tvName,
  canAdd,
  onAdd,
  onSwitch,
  onClose,
}: Close & { tvName: string; canAdd: boolean; onAdd: () => void; onSwitch: () => void }) {
  useT();
  return (
    <Sheet title={t("other.title")} onClose={onClose} testId="other-tv-sheet">
      <p className="muted">{t("other.help", { tv: tvName })}</p>
      {/* A TV that already has a phone has nothing to join a party with: only moving over to it is offered. */}
      {canAdd && (
        <>
          <button className="btn btn-red btn-block" data-testid="other-add" onClick={onAdd}>
            {t("other.add")}
          </button>
          <p className="muted small">{t("other.addHelp", { tv: tvName })}</p>
        </>
      )}
      <button className={`btn btn-block${canAdd ? "" : " btn-red"}`} data-testid="other-switch" onClick={onSwitch}>
        {t("other.switch", { tv: tvName })}
      </button>
      <p className="muted small">{t("other.switchHelp", { tv: tvName })}</p>
      <button className="btn btn-block" data-testid="other-cancel" onClick={onClose}>
        {t("common.cancel")}
      </button>
    </Sheet>
  );
}
