import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  CAPTION_LABELS,
  CAPTION_SETTINGS,
  CAPTION_TITLES,
  CAPTION_VALUES,
  DEFAULT_CAPTION_STYLE,
  describeStatus,
  episodeName,
  episodeStatus,
  groupBySeason,
  isCurrentEpisode,
  MAX_FOLLOWERS,
  PLAYBACK_SPEEDS,
  resolveCaptionStyle,
  trackLabel,
  type CaptionStyle,
  type PartyTv,
  type PlayerState,
  type SeriesInfo,
  type WatchedEntry,
} from "../../shared";
import { captionBottom, captionTextStyle } from "../shared/captionCss";
import { CheckIcon } from "../shared/icons";
import { RoleSwitch } from "../shared/RoleSwitch";
import { ChoiceList, Sheet, type Choice } from "./Sheet";

interface Close {
  onClose: () => void;
}

export function SpeedSheet({ player, onPick, onClose }: Close & { player: PlayerState; onPick: (rate: number) => void }) {
  const rate = player.playbackRate ?? 1;
  const choices: Choice[] = PLAYBACK_SPEEDS.map((value) => ({
    key: value,
    label: value === 1 ? "Normal" : `${value}×`,
    active: Math.abs(rate - value) < 0.01,
    testId: `speed-${value}`,
    pick: () => onPick(value),
  }));
  return (
    <Sheet title="Playback speed" onClose={onClose} testId="speed-sheet">
      <ChoiceList choices={choices} />
    </Sheet>
  );
}

export function QualitySheet({ player, onPick, onClose }: Close & { player: PlayerState; onPick: (level: number) => void }) {
  const quality = player.quality;
  const levels = [...(quality?.levels ?? [])].sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  const choices: Choice[] = [
    { key: -1, label: "Auto", active: quality?.current === -1, testId: "quality--1", pick: () => onPick(-1) },
    ...levels.map((level) => ({
      key: level.id,
      label: level.label,
      active: quality?.current === level.id,
      testId: `quality-${level.id}`,
      pick: () => onPick(level.id),
    })),
  ];
  return (
    <Sheet title="Quality" onClose={onClose} testId="quality-sheet">
      <ChoiceList choices={choices} />
    </Sheet>
  );
}

export function SourcesSheet({ player, onPick, onClose }: Close & { player: PlayerState; onPick: (index: number) => void }) {
  const sources = player.sources;
  const choices: Choice[] = (sources?.labels ?? []).map((label, index) => ({
    key: index,
    label,
    active: sources?.current === index,
    testId: `source-${index}`,
    pick: () => onPick(index),
  }));
  return (
    <Sheet title="Source" onClose={onClose} testId="source-sheet">
      <ChoiceList choices={choices} />
      <p className="muted small">If a source doesn't play, the TV tries the next one by itself. Pick one to play from where you are.</p>
    </Sheet>
  );
}

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
  const subtitles = player.subtitles;
  const audio = player.audio;
  const currentDelay = player.subtitleDelay ?? 0;
  const [selectedLang, setSelectedLang] = useState<string>("all");

  const languages = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of subtitles?.tracks ?? []) {
      const code = (t.lang || "und").toLowerCase();
      if (!map.has(code)) {
        map.set(code, trackLabel(t.lang, t.lang, code.toUpperCase()));
      }
    }
    return Array.from(map.entries());
  }, [subtitles?.tracks]);

  const filteredTracks = useMemo(() => {
    const all = subtitles?.tracks ?? [];
    if (selectedLang === "all") return all;
    return all.filter((t) => (t.lang || "und").toLowerCase() === selectedLang);
  }, [subtitles?.tracks, selectedLang]);

  const subtitleChoices: Choice[] = [
    { key: -1, label: "Off", active: (subtitles?.current ?? -1) === -1, testId: "subtitle--1", pick: () => onSubtitle(-1) },
    ...filteredTracks.map((track) => ({
      key: track.id,
      label: track.label,
      active: subtitles?.current === track.id,
      testId: `subtitle-${track.id}`,
      pick: () => onSubtitle(track.id),
    })),
  ];
  const audioChoices: Choice[] = (audio?.tracks ?? []).map((track) => ({
    key: track.id,
    label: track.label,
    active: audio?.current === track.id,
    testId: `audio-${track.id}`,
    pick: () => onAudio(track.id),
  }));

  return (
    <Sheet title="Audio & subtitles" onClose={onClose} testId="tracks-sheet">
      {audioChoices.length > 1 && (
        <>
          <h3 className="sheet-section">Audio</h3>
          <ChoiceList choices={audioChoices} />
        </>
      )}
      <h3 className="sheet-section">Subtitles</h3>
      {onDelay && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "rgba(255,255,255,0.06)", borderRadius: "8px", margin: "8px 0 14px" }}>
          <span style={{ fontSize: "14px", fontWeight: 500 }}>
            Delay: {currentDelay > 0 ? `+${currentDelay.toFixed(1)}s` : `${currentDelay.toFixed(1)}s`}
          </span>
          <div style={{ display: "flex", gap: "6px" }}>
            <button type="button" className="btn btn-sm" onClick={() => onDelay(Math.round((currentDelay - 0.5) * 10) / 10)} title="Earlier">
              −0.5s
            </button>
            <button type="button" className="btn btn-sm" onClick={() => onDelay(0)} title="Reset">
              0.0s
            </button>
            <button type="button" className="btn btn-sm" onClick={() => onDelay(Math.round((currentDelay + 0.5) * 10) / 10)} title="Later">
              +0.5s
            </button>
          </div>
        </div>
      )}
      {languages.length > 1 && (
        <div style={{ margin: "10px 0 8px" }}>
          <label style={{ display: "block", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#8a8a93", marginBottom: "6px" }}>
            Search by language
          </label>
          <select
            className="field-input"
            value={selectedLang}
            onChange={(e) => setSelectedLang(e.target.value)}
            style={{ width: "100%", padding: "8px 12px", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "6px", color: "#fff", fontSize: "14px" }}
          >
            <option value="all">All Languages ({subtitles?.tracks.length ?? 0})</option>
            {languages.map(([code, name]) => (
              <option key={code} value={code} style={{ background: "#1f1f23", color: "#fff" }}>
                {name}
              </option>
            ))}
          </select>
        </div>
      )}
      <ChoiceList choices={subtitleChoices} />
      <button className="btn btn-block" data-testid="open-caption-style" onClick={onStyle}>
        Subtitle style…
      </button>
      <p className="muted small">The TV remembers your choices for the next video.</p>
    </Sheet>
  );
}

/** How subtitles look: a small picture of the TV with a sample line that follows every change, then one row of choices per setting. */
export function CaptionStyleSheet({
  style,
  onChange,
  onClose,
}: Close & { style: CaptionStyle | undefined; onChange: (changes: Partial<CaptionStyle>) => void }) {
  const current = resolveCaptionStyle(style);
  return (
    <Sheet title="Subtitle style" onClose={onClose} testId="captions-sheet">
      <div className="cap-frame" aria-hidden="true" data-testid="caption-preview">
        <span className="cap-sample" style={{ ...captionTextStyle(current, "cqh"), bottom: captionBottom(current, "cqh") }}>
          This is how your subtitles will look
        </span>
      </div>
      {CAPTION_SETTINGS.map((setting) => (
        <section key={setting} className="cap-setting">
          <h3 className="sheet-section">{CAPTION_TITLES[setting]}</h3>
          <div className="cap-choices" role="radiogroup" aria-label={CAPTION_TITLES[setting]}>
            {CAPTION_VALUES[setting].map((value) => (
              <button
                key={value}
                role="radio"
                aria-checked={current[setting] === value}
                className={`cap-choice ${current[setting] === value ? "active" : ""}`}
                data-testid={`caption-${setting}-${value}`}
                onClick={() => onChange({ [setting]: value })}
              >
                {(CAPTION_LABELS[setting] as Record<string, string>)[value]}
              </button>
            ))}
          </div>
        </section>
      ))}
      <button className="btn btn-block" data-testid="caption-reset" onClick={() => onChange(DEFAULT_CAPTION_STYLE)}>
        Back to the default look
      </button>
    </Sheet>
  );
}

/** Every episode the source knows about, by season. The one playing is marked; tap any other to jump there. */
export function EpisodesSheet({
  series,
  show,
  watched,
  onPlay,
  onClose,
}: Close & { series: SeriesInfo; show: string | undefined; watched: readonly WatchedEntry[]; onPlay: (url: string) => void }) {
  const groups = useMemo(() => groupBySeason(series.episodes ?? []), [series.episodes]);
  const [season, setSeason] = useState(() => (groups.some((g) => g.season === series.season) ? series.season : groups[0]?.season));
  const shown = groups.find((group) => group.season === season) ?? groups[0];
  const listRef = useRef<HTMLUListElement>(null);

  // Open on the episode you're watching, not at the top of a 24-episode season.
  useEffect(() => {
    listRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "center" });
  }, [season]);

  return (
    <Sheet title="Episodes" onClose={onClose} testId="episodes-sheet">
      {groups.length > 1 && (
        <div className="seasons" role="tablist" aria-label="Seasons">
          {groups.map((group) => (
            <button
              key={group.season}
              role="tab"
              aria-selected={group.season === shown?.season}
              className={`season ${group.season === shown?.season ? "active" : ""}`}
              data-testid={`season-${group.season}`}
              onClick={() => setSeason(group.season)}
            >
              Season {group.season}
            </button>
          ))}
        </div>
      )}
      {groups.length === 1 && shown && <h3 className="sheet-section">Season {shown.season}</h3>}
      <ul className="episodes" ref={listRef}>
        {shown?.episodes.map((episode) => {
          const now = isCurrentEpisode(series, episode);
          const status = episodeStatus(watched, show, episode.season, episode.episode);
          const note = describeStatus(status);
          return (
            <li key={`${episode.season}-${episode.episode}`}>
              <button
                className={`episode ${now ? "now" : ""}`}
                aria-current={now}
                data-testid="episode"
                data-season={episode.season}
                data-episode={episode.episode}
                data-status={status.kind}
                onClick={() => !now && onPlay(episode.url)}
              >
                <span className="episode-no">{episode.episode}</span>
                <span className="episode-title">{episodeName(episode)}</span>
                {now ? (
                  <span className="episode-now">
                    <CheckIcon /> Now playing
                  </span>
                ) : (
                  note && <span className={`episode-note ${status.kind}`}>{status.kind === "watched" && <CheckIcon />} {note}</span>
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
  return (
    <Sheet title={tvName} onClose={onClose} testId="menu-sheet">
      <p className="muted">{online ? "Connected" : "This TV is offline right now."}</p>
      {controlCode && (
        <div style={{ background: "var(--surface-2)", padding: "12px 14px", borderRadius: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: "0.82rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
            Control with more phones ({controllerCount ?? 1} connected)
          </span>
          <span style={{ fontSize: "1.4rem", fontWeight: 800, letterSpacing: "0.15em", color: "var(--text)" }}>
            {controlCode}
          </span>
          <span className="muted small">
            Open <b>{location.host}</b> on another phone and enter this code to control together.
          </span>
        </div>
      )}
      <button className="btn btn-block" data-testid="party-open" onClick={onParty}>
        {partySize === 0 ? "Watch together on more TVs" : `Watching together on ${partySize + 1} TVs`}
      </button>
      <button className="btn btn-danger btn-block" data-testid="disconnect" onClick={onDisconnect}>
        Disconnect from this TV
      </button>
      <p className="muted small">
        The TV shows a new code so you (or someone else) can connect again. Your recently played list stays on this phone.
      </p>
      <RoleSwitch to="tv" />
    </Sheet>
  );
}

/** More TVs that play along with this one: each shows a code, and typing it here makes that TV follow. */
export function PartySheet({
  tvName,
  party,
  error,
  onAdd,
  onRemove,
  onClose,
}: Close & { tvName: string; party: PartyTv[]; error: string | null; onAdd: (code: string) => void; onRemove: (id: string) => void }) {
  const [code, setCode] = useState("");
  const full = party.length >= MAX_FOLLOWERS;

  // A TV that joined (or a code that was refused) has used the code up.
  useEffect(() => setCode(""), [party.length, error]);

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
    <Sheet title="Watch together" onClose={onClose} testId="party-sheet">
      <p className="muted">What plays on {tvName} plays on the others too, in step. This remote controls all of them.</p>
      {party.length > 0 && (
        <ul className="party-list" data-testid="party-list">
          {party.map((tv) => (
            <li className="choice" key={tv.id} data-testid="party-tv">
              <span>
                {tv.name}
                <span className={`party-state ${tv.online ? "ok" : "bad"}`}>{tv.online ? "Watching" : "Offline"}</span>
              </span>
              <button className="btn btn-danger" data-testid="party-remove" onClick={() => onRemove(tv.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {full ? (
        <p className="muted small">That is as many TVs as can watch together.</p>
      ) : (
        <form onSubmit={submit}>
          <p className="muted small">
            On the other TV, open <b>{location.host}</b> and press OK, then type the code it shows.
          </p>
          <input
            data-testid="party-code"
            className="code-input"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            placeholder="••••••"
            aria-label="6-digit code from the other TV"
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
    </Sheet>
  );
}
