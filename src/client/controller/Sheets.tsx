import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  CAPTION_SETTINGS,
  CAPTION_VALUES,
  DEFAULT_CAPTION_STYLE,
  describeStatus,
  episodeName,
  episodeStatus,
  formatDelay,
  groupBySeason,
  groupOf,
  isCurrentEpisode,
  MAX_FOLLOWERS,
  PLAYBACK_SPEEDS,
  resolveCaptionStyle,
  versionLabel,
  type CaptionStyle,
  type PartyTv,
  type PlayerState,
  type PlayerTrack,
  type SeriesInfo,
  type WatchedEntry,
} from "../../shared";
import { languageNames, useSubtitleLists } from "../account/subtitles";
import { t, useT } from "../i18n";
import { Rich } from "../i18n/Rich";
import { captionBottom, captionTextStyle } from "../shared/captionCss";
import { useEpisodeDetails } from "../shared/episodeDetails";
import { formatCode, formatLeft } from "../shared/format";
import { CheckIcon, ScanIcon } from "../shared/icons";
import { controlLink, partyLink } from "../shared/launch";
import { hueOf } from "../shared/Poster";
import { QrCode } from "../shared/QrCode";
import { RoleSwitch } from "../shared/RoleSwitch";
import { captionLabel, captionTitle, statusWords, trackName } from "../shared/words";
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
  onClose,
}: Close & {
  player: PlayerState;
  onSubtitle: (track: number) => void;
  onAudio: (track: number) => void;
  onStyle: () => void;
  onDelay?: (delay: number) => void;
}) {
  useT();
  const subtitles = player.subtitles;
  const audio = player.audio;
  const delay = player.subtitleDelay ?? 0;
  const nudge = (by: number) => onDelay?.(Math.round((delay + by) * 10) / 10);

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
          if (!active) onSubtitle(group.tracks[0]!.id);
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
      {onDelay && (
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
      <div className="cap-frame" aria-hidden="true" data-testid="caption-preview">
        <span className="cap-sample" style={{ ...captionTextStyle(current, "cqh"), bottom: captionBottom(current, "cqh") }}>
          {t("player.sample")}
        </span>
      </div>
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
    </Sheet>
  );
}

/** A picture from an episode; without one (or when it does not load) a colour made from its name. */
function Still({ src, name }: { src: string | undefined; name: string }) {
  const [broken, setBroken] = useState(false);
  const hue = hueOf(name);
  return (
    <span className="episode-still" style={{ background: `linear-gradient(135deg, hsl(${hue} 40% 26%), hsl(${(hue + 40) % 360} 45% 12%))` }}>
      {src && !broken && <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} />}
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
  controlCode,
  controllerCount,
  onParty,
  onDisconnect,
  onClose,
}: Close & {
  tvName: string;
  online: boolean;
  partySize: number;
  controlCode?: string;
  controllerCount?: number;
  onParty: () => void;
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
      <button className="btn btn-block" data-testid="party-open" onClick={onParty}>
        {partySize === 0 ? t("menu.partyOpen") : t("menu.partyActive", { count: partySize + 1 })}
      </button>
      <button className="btn btn-danger btn-block" data-testid="disconnect" onClick={onDisconnect}>
        {t("menu.disconnect")}
      </button>
      <p className="muted small">{t("menu.disconnectHelp")}</p>
      <RoleSwitch to="tv" />
    </Sheet>
  );
}

/** The code that brings another screen into this phone's party, and when it runs out: "asking" until the TV has answered, null when none is open. */
export type PartyInvite = { code: string; endsAt: number } | "asking" | null;

/** The code and link that let a screen in: a TV types the code, a phone or computer scans it or opens the link. */
function Invite({ code }: { code: string }) {
  useT();
  const link = partyLink(code);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: t("party.title"), url: link });
      else {
        await navigator.clipboard.writeText(link);
        setCopied(true);
      }
    } catch {
      /* the share sheet was closed, or this page may not copy here */
    }
  };

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
      <button className="btn btn-red btn-block" data-testid="party-share" onClick={share}>
        {copied ? t("party.copied") : t("party.share")}
      </button>
    </div>
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
        <Invite code={invite.code} />
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
          <li className="choice" key={tv.id} data-testid="party-tv">
            <span>
              {tv.name}
              <span className={`party-state ${tv.online ? "ok" : "bad"}`}>{tv.online ? t("party.watching") : t("party.offline")}</span>
            </span>
            <button className="btn btn-danger" data-testid="party-remove" onClick={() => onRemove(tv.id)}>
              {t("party.remove")}
            </button>
          </li>
        ))}
      </ul>

      {!full && (
        <form onSubmit={submit}>
          <h3 className="sheet-section">{t("party.addTitle")}</h3>
          <p className="muted small">
            <Rich k="party.help" parts={{ host: <b>{location.host}</b> }} />
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

/** A phone that has a TV scanned the code of another one: that TV joins the watch party, or the phone moves over to it. */
export function OtherTvSheet({
  tvName,
  guests,
  phones,
  canAdd,
  onAdd,
  onSwitch,
  onClose,
}: Close & { tvName: string; guests: number; phones: number; canAdd: boolean; onAdd: () => void; onSwitch: () => void }) {
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
      <p className="muted small">{t(phones > 1 ? "other.switchOthersHelp" : guests > 0 ? "other.switchPartyHelp" : "other.switchHelp", { tv: tvName })}</p>
      <button className="btn btn-block" data-testid="other-cancel" onClick={onClose}>
        {t("common.cancel")}
      </button>
    </Sheet>
  );
}
