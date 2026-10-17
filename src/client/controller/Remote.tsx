import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { episodeLabel, previousEpisode, type Command, type NormalizedMedia, type PlayerState, type TvInfo } from "../../shared";
import { Rich } from "../i18n/Rich";
import { t, useT } from "../i18n";
import { hostOf } from "../shared/format";
import {
  Back10Icon,
  ChevronIcon,
  Forward10Icon,
  FullscreenIcon,
  LinkIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PreviousIcon,
  StopIcon,
  SubtitlesIcon,
} from "../shared/icons";
import { friendlyError, qualityName, trackName } from "../shared/words";
import { SeekBar } from "./SeekBar";

export type SheetKind = "link" | "menu" | "tracks" | "captions" | "speed" | "quality" | "sources" | "episodes" | "party" | "tvs";

interface RemoteProps {
  tv: TvInfo;
  /** The phone is connected to the server and the TV is connected to the server. */
  online: boolean;
  media: NormalizedMedia;
  player: PlayerState;
  send: (command: Command) => void;
  onStop: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onOpen: (sheet: SheetKind) => void;
}

/** What the title is called on the remote (a show without the episode, which has a line of its own). */
export function mediaTitle(media: NormalizedMedia): string {
  const raw = media.title ?? hostOf(media.stream.url) ?? media.stream.url;
  return media.series && raw.includes("·") ? raw.split("·")[0]!.trim() : raw;
}

export function stateLabel(player: PlayerState, tvName: string): string {
  if (player.state === "error") return friendlyError(player.error);
  if (player.state === "loading") return t("common.loading");
  if (player.buffering) return t("remote.buffering");
  if (player.upNext && player.upNext.seconds !== null) return t("remote.upNextIn", { seconds: player.upNext.seconds }); // the TV's Up Next card, counting down
  if (player.state === "playing") return t("remote.playingOn", { tv: tvName });
  if (player.ended) return t("end.finished");
  if (player.state === "paused") return t("remote.paused");
  return "";
}

export function Chip({ icon, label, value, onClick, testId }: { icon?: ReactNode; label: string; value: string; onClick: () => void; testId: string }) {
  return (
    <button className="chip" onClick={onClick} data-testid={testId}>
      {icon}
      <span className="chip-text">
        <small>{label}</small>
        <b>{value}</b>
      </span>
      <ChevronIcon />
    </button>
  );
}

/** The remote: what's playing, a seek bar, transport buttons, and the extras that apply to this video. */
export function Remote({ tv, online, media, player, send, onStop, onNext, onPrevious, onOpen }: RemoteProps) {
  useT();
  // It takes the place of the library, which may have been scrolled far down: it starts at its own top (the title, and the TV's menu, are there).
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  const series = media.series;
  const title = mediaTitle(media);
  const playing = player.state === "playing";
  // A TV can't be sent into full screen without a press on the TV itself; if it hasn't gone in shortly after the tap, say so.
  const [fsHint, setFsHint] = useState(false);
  const fullscreenRef = useRef(player.fullscreen);
  fullscreenRef.current = player.fullscreen;
  useEffect(() => {
    if (player.fullscreen) setFsHint(false);
  }, [player.fullscreen]);
  useEffect(() => {
    if (!fsHint) return;
    const timer = setTimeout(() => setFsHint(false), 8000);
    return () => clearTimeout(timer);
  }, [fsHint]);
  const toggleFullscreen = () => {
    send({ type: "TOGGLE_FULLSCREEN" });
    if (!player.fullscreen) setTimeout(() => setFsHint(!fullscreenRef.current), 800);
  };
  const busy = player.state === "loading" || (player.state !== "error" && Boolean(player.buffering));

  const playingSubtitle = player.subtitles?.tracks.find((track) => track.id === player.subtitles?.current);
  const subtitleName = player.subtitles ? (playingSubtitle ? trackName(playingSubtitle) : t("common.off")) : "";
  const hasTracks = Boolean(player.subtitles?.tracks.length) || (player.audio?.tracks.length ?? 0) > 1;
  const qualityLabel = qualityName(player.quality);
  const next = series?.next;
  const previous = previousEpisode(series);

  return (
    <div className="remote">
      <section className="now-playing">
        {series && (
          <div className="episode-line">
            <span className="badge">
              S{series.season}:E{series.episode}
            </span>
            <span>{t("player.seasonEpisode", { season: series.season, episode: series.episode })}</span>
          </div>
        )}
        <h2 data-testid="media-title">{title}</h2>
        <div className="state-line">
          <p className={`state ${player.state === "error" ? "bad" : ""}`} data-testid="player-state" data-state={player.state} data-error={player.state === "error" ? player.error : undefined}>
            {busy && <span className="spinner" />}
            {stateLabel(player, tv.name)}
          </p>
          {/* The TV is about to start the next episode by itself: the way to say no is here too, not only on the TV's remote. */}
          {player.upNext && player.upNext.seconds !== null && (
            <button className="state-action" data-testid="upnext-cancel" onClick={() => send({ type: "DISMISS_UP_NEXT" })} disabled={!online}>
              {t("common.cancel")}
            </button>
          )}
        </div>
      </section>

      <div className="remote-controls">
        <SeekBar
          currentTime={player.currentTime}
          duration={player.duration}
          buffered={player.bufferedEnd}
          onSeek={(time) => send({ type: "SEEK", time })}
        />

        <div className="transport">
          <button
            className="round"
            onClick={() => send({ type: "SKIP", seconds: -10 })}
            disabled={!online}
            aria-label={t("hud.back", { n: 10 })}
          >
            <Back10Icon />
          </button>
          {playing ? (
            <button className="round big" data-testid="pause" onClick={() => send({ type: "PAUSE" })} disabled={!online} aria-label={t("hud.pause")}>
              <PauseIcon />
            </button>
          ) : (
            <button className="round big" data-testid="play" onClick={() => send({ type: "PLAY" })} disabled={!online} aria-label={t("hud.play")}>
              <PlayIcon />
            </button>
          )}
          <button
            className="round"
            onClick={() => send({ type: "SKIP", seconds: 10 })}
            disabled={!online}
            aria-label={t("hud.forward", { n: 10 })}
          >
            <Forward10Icon />
          </button>
        </div>

        {(previous || next) && (
          <div className="episode-nav">
            {previous && (
              <button className="btn" data-testid="previous-episode" onClick={onPrevious} disabled={!online}>
                <PreviousIcon /> {t("remote.previous")}
                <small>{episodeLabel(previous)}</small>
              </button>
            )}
            {next && (
              <button className="btn btn-red" data-testid="next-episode" onClick={onNext} disabled={!online}>
                <NextIcon /> {t("remote.next")}
                <small>{episodeLabel(next)}</small>
              </button>
            )}
          </div>
        )}
      </div>

      <div className="remote-extras">
        <div className="chips">
          {series?.episodes && series.episodes.length > 1 && (
            <Chip
              testId="chip-episodes"
              label={t("player.episodes")}
              value={t("remote.inList", { count: series.episodes.length })}
              onClick={() => onOpen("episodes")}
            />
          )}
          {hasTracks && (
            <Chip
              testId="chip-tracks"
              icon={<SubtitlesIcon />}
              label={t("player.subtitles")}
              value={subtitleName || t("player.audio")}
              onClick={() => onOpen("tracks")}
            />
          )}
          {player.sources && (
            <Chip
              testId="chip-source"
              label={t("player.source")}
              value={player.sources.labels[player.sources.current] ?? t("player.source")}
              onClick={() => onOpen("sources")}
            />
          )}
          <Chip testId="chip-speed" label={t("player.speedShort")} value={`${player.playbackRate ?? 1}×`} onClick={() => onOpen("speed")} />
          {player.quality && player.quality.levels.length > 1 && (
            <Chip testId="chip-quality" label={t("player.quality")} value={qualityLabel} onClick={() => onOpen("quality")} />
          )}
        </div>

        {fsHint && (
          <p className="banner" data-testid="fs-hint" role="status">
            <Rich k="remote.fsHint" parts={{ ok: <b>OK</b> }} />
          </p>
        )}

        <div className="actions">
          <button className="btn btn-danger" data-testid="stop" onClick={onStop}>
            <StopIcon /> {t("remote.stop")}
          </button>
          <button className="btn" data-testid="fullscreen" onClick={toggleFullscreen} disabled={!online}>
            <FullscreenIcon /> {player.fullscreen ? t("remote.exitFullscreen") : t("remote.fullscreen")}
          </button>
          <button className="btn" data-testid="change-video" onClick={() => onOpen("link")}>
            <LinkIcon /> {t("remote.changeVideo")}
          </button>
        </div>
      </div>
    </div>
  );
}
